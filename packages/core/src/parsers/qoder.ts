import { existsSync } from 'node:fs';
import { createJsonlLineReader } from './jsonl-tail.js';
import { stat } from 'node:fs/promises';
import { sep } from 'node:path';

import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import {
  qoderCliProjectsDirs,
  qoderIdeLocalDbEntries,
  qoderWorkProjectsDirs,
} from '../paths.js';
import { resolveProjectName } from '../project-name.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import {
  accumulateBucket,
  bucketsFromState,
  computeTotalTokens,
  findJsonlFiles,
  type BucketAccumulator,
} from './shared.js';
import { queryDbJson, readSqliteWithSnapshot } from './sqlite.js';

export const QODER_COLLECTOR_IDE = 'qoder-ide';
export const QODER_COLLECTOR_CN_IDE = 'qoder-cn-ide';
export const QODER_COLLECTOR_CLI = 'qoder-cli';
export const QODER_COLLECTOR_WORK = 'qoder-work';

interface IdeTokenInfo {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
}

interface IdeModelInfo {
  model_key?: string;
  model?: string;
  config_name?: string;
}

function normalizeIdeTokenInfo(info: IdeTokenInfo): TokenTotals | null {
  const prompt = Math.max(0, Number(info.prompt_tokens) || 0);
  const completion = Math.max(0, Number(info.completion_tokens) || 0);
  const cached = Math.max(0, Number(info.cached_tokens) || 0);
  const input = Math.max(0, prompt - cached);
  const delta = {
    input_tokens: input,
    output_tokens: completion,
    cached_input_tokens: cached,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
  };
  const total = computeTotalTokens(delta);
  if (total === 0) return null;
  return { ...delta, total_tokens: total, conversation_count: 1 };
}

function normalizeAnthropicUsage(u: Record<string, number>): TokenTotals | null {
  const input = Math.max(0, u.input_tokens ?? 0);
  const output = Math.max(0, u.output_tokens ?? 0);
  const cacheCreation = Math.max(0, u.cache_creation_input_tokens ?? 0);
  const cacheRead = Math.max(0, u.cache_read_input_tokens ?? 0);
  const delta = {
    input_tokens: input,
    output_tokens: output,
    cached_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreation,
    reasoning_output_tokens: 0,
  };
  const total = computeTotalTokens(delta);
  if (total === 0) return null;
  return { ...delta, total_tokens: total, conversation_count: 1 };
}

function parseModelInfo(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'unknown';
  try {
    const obj = JSON.parse(raw) as IdeModelInfo;
    return obj.model_key || obj.model || obj.config_name || 'unknown';
  } catch {
    return 'unknown';
  }
}

function gmtCreateToIso(gmt: unknown): string | null {
  const n = typeof gmt === 'number' ? gmt : Number(gmt);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Qoder uses unix ms; tolerate seconds.
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function extractProjectFromPath(filePath: string, projectsDir: string): string {
  const prefix = projectsDir.endsWith(sep) ? projectsDir : projectsDir + sep;
  const relative = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : '';
  const first = relative.split(sep)[0];
  if (!first) return 'unknown';
  const parts = first.split('-').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : first;
}

function parseIdeDb(
  dbPath: string,
  collector: string,
  sinceMs: number,
  seenHashes: Set<string>,
  bucketState: BucketAccumulator,
  watermark: number,
): { eventsParsed: number; nextWatermark: number } {
  let eventsParsed = 0;
  let nextWatermark = watermark;

  const sql = `
    SELECT
      m.id AS id,
      m.token_info AS token_info,
      m.model_info AS model_info,
      m.gmt_create AS gmt_create,
      s.project_name AS project_name,
      s.project_uri AS project_uri
    FROM chat_message m
    LEFT JOIN chat_session s ON m.session_id = s.session_id
    WHERE m.role = 'assistant'
      AND m.token_info IS NOT NULL
      AND length(m.token_info) > 2
      AND m.gmt_create > ${Math.max(0, Math.floor(watermark))}
    ORDER BY m.gmt_create ASC
  `;

  let rows: Record<string, unknown>[] = [];
  try {
    rows = readSqliteWithSnapshot(dbPath, (snap) => queryDbJson(snap, sql));
  } catch {
    return { eventsParsed: 0, nextWatermark };
  }

  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id : null;
    if (id && seenHashes.has(id)) continue;

    const tokenRaw = row.token_info;
    if (typeof tokenRaw !== 'string') continue;
    let tokenInfo: IdeTokenInfo;
    try {
      tokenInfo = JSON.parse(tokenRaw) as IdeTokenInfo;
    } catch {
      continue;
    }
    const delta = normalizeIdeTokenInfo(tokenInfo);
    if (!delta) continue;

    const iso = gmtCreateToIso(row.gmt_create);
    if (!iso) continue;
    const hourStart = toUtcHalfHourStart(iso);
    if (!hourStart) continue;
    if (new Date(hourStart).getTime() < sinceMs) continue;

    const model = parseModelInfo(row.model_info);
    const project =
      (typeof row.project_name === 'string' && row.project_name.trim()) ||
      (typeof row.project_uri === 'string' &&
        row.project_uri.trim() &&
        resolveProjectName(row.project_uri.trim())) ||
      'unknown';

    accumulateBucket(bucketState, 'qoder', model, project, hourStart, delta, collector);
    if (id) seenHashes.add(id);
    eventsParsed += 1;

    const gmt = typeof row.gmt_create === 'number' ? row.gmt_create : Number(row.gmt_create);
    if (Number.isFinite(gmt) && gmt > nextWatermark) nextWatermark = gmt;
  }

  return { eventsParsed, nextWatermark };
}

async function parseTranscriptFiles(
  roots: string[],
  collector: string,
  sinceMs: number,
  seenHashes: Set<string>,
  fileCursors: Record<string, { inode: number; offset: number }>,
  bucketState: BucketAccumulator,
): Promise<{ eventsParsed: number; filesProcessed: number }> {
  let eventsParsed = 0;
  let filesProcessed = 0;

  for (const projectsDir of roots) {
    if (!existsSync(projectsDir)) continue;
    const files = await findJsonlFiles(projectsDir);
    for (const filePath of files) {
      const st = await stat(filePath).catch(() => null);
      if (!st?.isFile()) continue;

      const project = extractProjectFromPath(filePath, projectsDir);
      const prev = fileCursors[filePath];
      const inode = st.ino;
      const sameInode = prev && prev.inode === inode;
      const truncated = sameInode && (prev.offset ?? 0) > st.size;
      const startOffset = sameInode && !truncated ? (prev.offset ?? 0) : 0;
      if (sameInode && !truncated && startOffset >= st.size) continue;

      const reader = createJsonlLineReader(filePath, startOffset);

      for await (const line of reader) {
        if (!line.includes('"usage"')) continue;
        let obj: {
          type?: string;
          timestamp?: string;
          requestId?: string;
          message?: {
            id?: string;
            model?: string;
            usage?: Record<string, number>;
          };
        };
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (obj.type !== 'assistant') continue;
        const usage = obj.message?.usage;
        if (!usage) continue;

        const msgId = obj.message?.id;
        const dedup = msgId
          ? obj.requestId
            ? `${collector}:${msgId}:${obj.requestId}`
            : `${collector}:${msgId}`
          : null;
        if (dedup && seenHashes.has(dedup)) continue;

        const ts = obj.timestamp;
        if (!ts) continue;
        const hourStart = toUtcHalfHourStart(ts);
        if (!hourStart) continue;
        if (new Date(hourStart).getTime() < sinceMs) continue;

        const delta = normalizeAnthropicUsage(usage);
        if (!delta) continue;

        if (dedup) seenHashes.add(dedup);
        const model = obj.message?.model ?? 'unknown';
        accumulateBucket(
          bucketState,
          'qoder',
          model,
          project,
          hourStart,
          delta,
          collector,
        );
        eventsParsed += 1;
      }

      fileCursors[filePath] = { inode, offset: reader.nextOffset };
      filesProcessed += 1;
    }
  }

  return { eventsParsed, filesProcessed };
}

export interface ParseQoderResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parseQoderIncremental(
  cursors: CursorsFile,
  statsSince: string,
): Promise<{ result: ParseQoderResult; cursors: CursorsFile }> {
  const sinceMs = new Date(statsSince).getTime();
  if (!cursors.qoder) {
    cursors.qoder = { seenHashes: [], files: {}, ideWatermarks: {} };
  }
  const qoder = cursors.qoder;
  if (!qoder.files) qoder.files = {};
  if (!qoder.ideWatermarks) qoder.ideWatermarks = {};
  const seenHashes = new Set(qoder.seenHashes ?? []);
  const bucketState: BucketAccumulator = new Map();

  let eventsParsed = 0;
  let filesProcessed = 0;

  for (const entry of qoderIdeLocalDbEntries()) {
    if (!existsSync(entry.dbPath)) continue;
    const watermark = qoder.ideWatermarks[entry.dbPath] ?? 0;
    const parsed = parseIdeDb(
      entry.dbPath,
      entry.collector,
      sinceMs,
      seenHashes,
      bucketState,
      watermark,
    );
    eventsParsed += parsed.eventsParsed;
    qoder.ideWatermarks[entry.dbPath] = parsed.nextWatermark;
    if (parsed.eventsParsed > 0 || watermark > 0) filesProcessed += 1;
    else if (existsSync(entry.dbPath)) filesProcessed += 1;
  }

  const cli = await parseTranscriptFiles(
    qoderCliProjectsDirs(),
    QODER_COLLECTOR_CLI,
    sinceMs,
    seenHashes,
    qoder.files,
    bucketState,
  );
  eventsParsed += cli.eventsParsed;
  filesProcessed += cli.filesProcessed;

  const work = await parseTranscriptFiles(
    qoderWorkProjectsDirs(),
    QODER_COLLECTOR_WORK,
    sinceMs,
    seenHashes,
    qoder.files,
    bucketState,
  );
  eventsParsed += work.eventsParsed;
  filesProcessed += work.filesProcessed;

  qoder.seenHashes = Array.from(seenHashes).slice(-50_000);

  return {
    result: {
      buckets: bucketsFromState(bucketState, 'qoder'),
      eventsParsed,
      filesProcessed,
    },
    cursors,
  };
}
