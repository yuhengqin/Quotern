import { createReadStream, type Stats } from 'node:fs';
import { createInterface } from 'node:readline';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

import type {
  CodexFileCursor,
  CodexSessionFileMeta,
  CursorsFile,
  QueueBucket,
  TokenTotals,
} from '../types.js';
import { resolveProjectName } from '../project-name.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import { createJsonlLineReader } from './jsonl-tail.js';
import {
  modelFromRolloutEvent,
  readModel,
  recoverLastModelBeforeOffset,
} from './rollout-model.js';
import {
  accumulateBucket,
  bucketsFromState,
  computeTotalTokens,
  findJsonlFiles,
  type BucketAccumulator,
} from './shared.js';

export const EVERY_CODE_COLLECTOR = 'every-code';

interface SessionMeta {
  id?: string;
  forked_from_id?: string | null;
  cwd?: string;
  git?: { repository_url?: string };
}

interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

function extractProject(meta: SessionMeta): string {
  const url = meta.git?.repository_url;
  if (url) {
    const match = url.match(/([^/]+\/[^/]+?)(?:\.git)?$/);
    if (match) return match[1]!;
  }
  if (meta.cwd) {
    return resolveProjectName(meta.cwd);
  }
  return 'unknown';
}

function extractTokenCount(obj: Record<string, unknown>): { info: Record<string, unknown> | null; timestamp: string | null } | null {
  const payload = obj.payload as Record<string, unknown> | undefined;
  if (!payload) return null;
  if (payload.type === 'token_count') {
    const info = payload.info;
    return {
      info: info && typeof info === 'object' ? (info as Record<string, unknown>) : null,
      timestamp: (obj.timestamp as string) ?? null,
    };
  }
  const msg = payload.msg as Record<string, unknown> | undefined;
  if (msg?.type === 'token_count') {
    const info = msg.info;
    return {
      info: info && typeof info === 'object' ? (info as Record<string, unknown>) : null,
      timestamp: (obj.timestamp as string) ?? null,
    };
  }
  return null;
}

function normalizeEveryCodeUsage(u: TokenUsage): TokenTotals | null {
  const cached = Math.max(0, u.cached_input_tokens ?? u.cache_read_input_tokens ?? 0);
  const reasoning = Math.max(0, u.reasoning_output_tokens ?? 0);
  const input = Math.max(0, (u.input_tokens ?? 0) - cached);
  const output = Math.max(0, (u.output_tokens ?? 0) - reasoning);
  const cacheCreation = Math.max(0, u.cache_creation_input_tokens ?? 0);
  const totals = {
    input_tokens: input,
    output_tokens: output,
    cached_input_tokens: cached,
    cache_creation_input_tokens: cacheCreation,
    reasoning_output_tokens: reasoning,
  };
  const total = computeTotalTokens(totals);
  if (total === 0) return null;
  return { ...totals, total_tokens: total, conversation_count: 1 };
}

function pickDelta(
  lastUsage: TokenUsage | undefined,
  totalUsage: TokenUsage | undefined,
  prevTotals: TokenUsage | undefined,
): TokenUsage | null {
  if (lastUsage && Object.keys(lastUsage).length > 0) return lastUsage;
  if (totalUsage && prevTotals) {
    const delta: TokenUsage = {};
    for (const k of [
      'input_tokens',
      'cached_input_tokens',
      'cache_creation_input_tokens',
      'output_tokens',
      'reasoning_output_tokens',
      'total_tokens',
    ] as const) {
      const a = Number(totalUsage[k]);
      const b = Number(prevTotals[k]);
      if (Number.isFinite(a) && Number.isFinite(b)) delta[k] = Math.max(0, a - b);
    }
    return delta;
  }
  if (totalUsage && Object.keys(totalUsage).length > 0) return totalUsage;
  return null;
}

async function indexSessionFile(filePath: string): Promise<{
  sessionId: string | null;
  forkedFromId: string | null;
  sessionProject: string;
  tokenCountRecords: number;
}> {
  let sessionId: string | null = null;
  let forkedFromId: string | null = null;
  let sessionProject = 'unknown';
  let tokenCountRecords = 0;

  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.type === 'session_meta') {
        const meta = obj.payload as SessionMeta;
        sessionId = meta.id ?? sessionId;
        forkedFromId = meta.forked_from_id ?? null;
        sessionProject = extractProject(meta);
      } else if (extractTokenCount(obj)) {
        tokenCountRecords += 1;
      }
    } catch {
      continue;
    }
  }

  return { sessionId, forkedFromId, sessionProject, tokenCountRecords };
}

/** Every Code home directory (CODE_HOME or ~/.code). */
export function everyCodeHome(): string {
  const env =
    process.env.AI_USAGE_EVERY_CODE_HOME?.trim() || process.env.CODE_HOME?.trim();
  if (env) {
    return env.startsWith('~') ? join(homedir(), env.slice(1)) : env;
  }
  return join(homedir(), '.code');
}

export function everyCodeSessionsDirs(): string[] {
  const home = everyCodeHome();
  return [join(home, 'sessions'), join(home, 'archived_sessions')];
}

export async function listEveryCodeRolloutFiles(): Promise<string[]> {
  const nested = await Promise.all(everyCodeSessionsDirs().map((dir) => findJsonlFiles(dir)));
  return [...new Set(nested.flat())].sort();
}

export interface ParseEveryCodeResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
}

export async function parseEveryCodeIncremental(
  cursors: CursorsFile,
  statsSince: string,
): Promise<{ result: ParseEveryCodeResult; cursors: CursorsFile }> {
  const files = await listEveryCodeRolloutFiles();
  const sinceMs = new Date(statsSince).getTime();

  if (!cursors.everyCode) {
    cursors.everyCode = { files: {}, sessionIndex: {}, seenHashes: [] };
  }
  const everyCodeCursor = cursors.everyCode;
  if (!everyCodeCursor.sessionIndex) everyCodeCursor.sessionIndex = {};
  if (!everyCodeCursor.files) everyCodeCursor.files = {};
  const seenHashes = new Set(everyCodeCursor.seenHashes ?? []);
  const bucketState: BucketAccumulator = new Map();

  const fileMeta = new Map<string, CodexSessionFileMeta>();
  const fileStats = new Map<string, Stats>();

  for (const filePath of files) {
    const st = await stat(filePath).catch(() => null);
    if (!st?.isFile()) continue;
    fileStats.set(filePath, st);

    // Unchanged file (same inode, same size): reuse cached meta instead of
    // re-reading the whole session file every poll round.
    const prev = everyCodeCursor.files[filePath];
    const cached = prev?.meta;
    const meta: CodexSessionFileMeta =
      cached && prev.inode === st.ino && cached.size === st.size
        ? cached
        : { ...(await indexSessionFile(filePath)), size: st.size };

    fileMeta.set(filePath, meta);
    if (prev && prev.inode === st.ino) prev.meta = meta;
    if (meta.sessionId) {
      everyCodeCursor.sessionIndex[meta.sessionId] = {
        tokenCount: meta.tokenCountRecords,
        forkedFrom: meta.forkedFromId,
      };
    }
  }

  let eventsParsed = 0;
  let filesProcessed = 0;

  for (const filePath of files) {
    const st = fileStats.get(filePath);
    if (!st) continue;

    const meta = fileMeta.get(filePath);
    if (!meta) continue;

    const prev = everyCodeCursor.files[filePath];
    const inode = st.ino;
    const sameInode = prev && prev.inode === inode;
    const truncated = sameInode && (prev.offset ?? 0) > st.size;
    const startOffset = sameInode && !truncated ? (prev.offset ?? 0) : 0;
    let tokenCountSeen = sameInode && !truncated ? (prev.tokenCountSeen ?? 0) : 0;
    const prevTotalMap = new Map<string, TokenUsage>(
      sameInode && !truncated && prev?.prevTotal
        ? Object.entries(prev.prevTotal).map(([k, v]) => [k, v as TokenUsage])
        : [],
    );

    if (sameInode && !truncated && startOffset >= st.size) continue;

    const replayTokenCountToSkip = meta.forkedFromId
      ? (everyCodeCursor.sessionIndex[meta.forkedFromId]?.tokenCount ?? 0)
      : 0;

    let turnContextModel =
      sameInode && !truncated ? (readModel(prev?.lastModel) ?? 'unknown') : 'unknown';
    if (sameInode && !truncated && startOffset > 0 && !readModel(prev?.lastModel)) {
      const recovered = await recoverLastModelBeforeOffset(filePath, startOffset);
      if (recovered) turnContextModel = recovered;
    }
    let sessionUuid: string | null = meta.sessionId;

    const reader = createJsonlLineReader(filePath, startOffset);

    for await (const line of reader) {
      if (!line.trim()) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (obj.type === 'session_meta') {
        const payload = obj.payload as SessionMeta;
        sessionUuid = payload.id ?? sessionUuid;
      }

      if (
        obj.type === 'turn_context' ||
        obj.type === 'thread_settings_applied' ||
        obj.type === 'world_state'
      ) {
        const model = modelFromRolloutEvent(obj);
        if (model) turnContextModel = model;
        continue;
      }

      const tokenEvent = extractTokenCount(obj);
      if (!tokenEvent?.info) continue;

      const info = tokenEvent.info;
      const lastUsage = info.last_token_usage as TokenUsage | undefined;
      const totalUsage = info.total_token_usage as TokenUsage | undefined;
      const modelKey = readModel(info.model) ?? turnContextModel;
      const prevTotals = prevTotalMap.get(modelKey);
      const rawUsage = pickDelta(lastUsage, totalUsage, prevTotals);
      if (totalUsage) prevTotalMap.set(modelKey, { ...totalUsage });

      const isReplayedHistory = tokenCountSeen < replayTokenCountToSkip;
      tokenCountSeen += 1;
      if (isReplayedHistory || !rawUsage) continue;

      const delta = normalizeEveryCodeUsage(rawUsage);
      if (!delta) continue;

      const ts = tokenEvent.timestamp;
      if (!ts) continue;
      const hourStart = toUtcHalfHourStart(ts);
      if (!hourStart || new Date(hourStart).getTime() < sinceMs) continue;

      const dedupKey = sessionUuid && ts ? `${sessionUuid}:${ts}` : null;
      if (dedupKey && seenHashes.has(dedupKey)) continue;
      if (dedupKey) seenHashes.add(dedupKey);

      const model = readModel(info.model) ?? turnContextModel;
      accumulateBucket(
        bucketState,
        'every-code',
        model,
        meta.sessionProject,
        hourStart,
        delta,
        EVERY_CODE_COLLECTOR,
      );
      eventsParsed += 1;
    }

    const prevTotalSave: CodexFileCursor['prevTotal'] = {};
    for (const [k, v] of prevTotalMap.entries()) {
      prevTotalSave[k] = { ...v };
    }

    everyCodeCursor.files[filePath] = {
      inode,
      offset: reader.nextOffset,
      tokenCountSeen,
      prevTotal: prevTotalSave,
      lastModel: turnContextModel,
      meta,
    };
    filesProcessed += 1;
  }

  everyCodeCursor.seenHashes = Array.from(seenHashes).slice(-50_000);

  const buckets = bucketsFromState(bucketState, 'every-code');
  return {
    result: { buckets, eventsParsed, filesProcessed },
    cursors,
  };
}
