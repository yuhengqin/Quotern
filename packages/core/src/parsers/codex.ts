import { localEvidence, validUsageFields } from '../local-metrics.js';
import { createHash } from 'node:crypto';
import { serviceTierFromEvent, type RequestPricingFact } from '../pricing/request-pricing.js';
import { type Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type {
  CodexFileCursor,
  CodexSessionFileMeta,
  CursorsFile,
  QueueBucket,
  TokenTotals,
} from '../types.js';
import { codexSessionsDirs } from '../paths.js';
import { resolveProjectName } from '../project-name.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import { createCodexLineReader, findCodexLogFiles, logicalCodexPath } from './codex-log-reader.js';
import { allocateLedgerCoverage, compactionLifetime, emptyCompactionState, sameUsage, settleCompaction, uncoveredUsage } from './codex-compaction.js';
import type { PendingCompaction } from './codex-compaction.js';
import {
  modelFromRolloutEvent,
  readModel,
} from './rollout-model.js';
import {
  accumulateBucket,
  bucketsFromState,
  computeTotalTokens,
  findJsonlFiles,
  type BucketAccumulator,
} from './shared.js';
import {
  applyCodexLedger,
  codexLedgerDbPaths,
  type CodexRolloutScan,
} from './codex-ledger.js';

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
  cache_write_input_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

function normalizeCacheWriteAlias(usage: TokenUsage | undefined): TokenUsage | undefined {
  // Codex includes cache writes in gross input; keep the normalized buckets disjoint.
  return usage && usage.cache_creation_input_tokens == null && usage.cache_write_input_tokens != null
    ? {
        ...usage,
        input_tokens: Math.max(0, (usage.input_tokens ?? 0) - Math.max(0, usage.cache_write_input_tokens)),
        cache_creation_input_tokens: usage.cache_write_input_tokens,
      }
    : usage;
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

export function normalizeCodexUsage(u: TokenUsage): TokenTotals | null {
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
  return { ...totals, total_tokens: total, conversation_count: 1, token_quality: 'recorded' };
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

  const rl = createCodexLineReader(filePath, 0);

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

export async function listCodexRolloutFiles(): Promise<string[]> {
  const nested = await Promise.all(codexSessionsDirs().map((dir) => findJsonlFiles(dir)));
  return [...new Set(nested.flat())].sort();
}

export interface ParseCodexResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
}

export async function parseCodexIncremental(
  cursors: CursorsFile,
  statsSince: string,
): Promise<{ result: ParseCodexResult; cursors: CursorsFile }> {
  // Session text export keeps its plain-only discovery; metering handles both encodings.
  const files = await findCodexLogFiles(codexSessionsDirs());
  const sinceMs = new Date(statsSince).getTime();

  // A failed decode must not publish a partially advanced cursor.
  const originalCursors = cursors;
  cursors = { ...cursors, codex: cursors.codex ? structuredClone(cursors.codex) : undefined };

  if (!cursors.codex) {
    cursors.codex = { files: {}, sessionIndex: {}, seenHashes: [] };
  }
  const codexCursor = cursors.codex;
  const upgrading = codexCursor.meteringVersion !== 2;
  if (!codexCursor.sessionIndex) codexCursor.sessionIndex = {};
  if (!codexCursor.files) codexCursor.files = {};
  const seenHashes = new Set(codexCursor.seenHashes ?? []);
  const compactions = codexCursor.compactions ?? emptyCompactionState();
  const bucketState: BucketAccumulator = new Map();
  // Basenames already counted before this round. A file scanned now is not
  // "already counted" — that would seed away a same-round ledger tail.
  const priorRolloutNames = new Set(Object.keys(codexCursor.files).map((p) => basename(p)));
  const rolloutScans = new Map<string, CodexRolloutScan>();

  const fileMeta = new Map<string, CodexSessionFileMeta>();
  const fileStats = new Map<string, Stats>();

  for (const filePath of files) {
    const st = await stat(filePath).catch(() => null);
    if (!st?.isFile()) continue;
    fileStats.set(filePath, st);

    // Unchanged file (same inode, same size): reuse cached meta instead of
    // re-reading the whole session file every poll round.
    const prev = codexCursor.files[logicalCodexPath(filePath)];
    const cached = prev?.meta;
    const meta: CodexSessionFileMeta =
      cached && prev.inode === st.ino && cached.size === st.size && (!filePath.endsWith('.zst') || prev.mtimeMs === st.mtimeMs)
        ? cached
        : { ...(await indexSessionFile(filePath)), size: st.size };

    fileMeta.set(filePath, meta);
    if (prev && prev.inode === st.ino) prev.meta = meta;
    if (meta.sessionId) {
      codexCursor.sessionIndex[meta.sessionId] = {
        tokenCount: meta.tokenCountRecords,
        forkedFrom: meta.forkedFromId,
      };
    }
  }

  let eventsParsed = 0;
  let filesProcessed = 0;

  // Process parents before fork copies so the original request supplies attribution.
  const depth = (path: string): number => {
    let parent = fileMeta.get(path)?.forkedFromId;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) { visited.add(parent); parent = codexCursor.sessionIndex?.[parent]?.forkedFrom; }
    return visited.size;
  };
  files.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));

  for (const filePath of files) {
    const st = fileStats.get(filePath);
    if (!st) continue;

    const meta = fileMeta.get(filePath);
    if (!meta) continue;

    const logicalPath = logicalCodexPath(filePath);
    const encoding = filePath.endsWith('.zst') ? 'zst' : 'jsonl';
    const prev = codexCursor.files[logicalPath];
    const inode = st.ino;
    const sameInode = prev && prev.inode === inode && (prev.encoding ?? 'jsonl') === encoding;
    if (!upgrading && encoding === 'zst' && sameInode && prev.physicalSize === st.size && prev.mtimeMs === st.mtimeMs) continue;
    const truncated = sameInode && (upgrading || encoding === 'zst' || (prev.offset ?? 0) > st.size);
    const startOffset = sameInode && !truncated ? (prev.offset ?? 0) : 0;
    let tokenCountSeen = sameInode && !truncated ? (prev.tokenCountSeen ?? 0) : 0;
    const prevTotalMap = new Map<string, TokenUsage>(
      sameInode && !truncated && prev?.prevTotal
        ? Object.entries(prev.prevTotal).map(([k, v]) => [k, v as TokenUsage])
        : [],
    );

    if (sameInode && !truncated && startOffset >= st.size) continue;

    const scan: CodexRolloutScan = {
      emitted: 0,
      lifetime: null,
      observed: 0,
      sessionId: meta.sessionId,
    };
    rolloutScans.set(basename(logicalPath), scan);

    const replayTokenCountToSkip = meta.forkedFromId
      ? (codexCursor.sessionIndex[meta.forkedFromId]?.tokenCount ?? 0)
      : 0;

    let lastUsageSnapshot =
      startOffset > 0 ? prev?.lastUsageSnapshot : undefined;

    let turnContextModel =
      sameInode && !truncated
        ? (readModel(prev?.lastModel) ?? 'unknown')
        : 'unknown';
    let serviceTier: RequestPricingFact['serviceTier'] = startOffset > 0 ? prev?.serviceTier : undefined;
    if (
      sameInode &&
      !truncated &&
      startOffset > 0 &&
      (!readModel(prev?.lastModel) || prev?.serviceTier === undefined)
    ) {
      const prefix = createCodexLineReader(filePath, 0);
      for await (const line of prefix) {
        if (prefix.nextOffset > startOffset) break;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          turnContextModel = modelFromRolloutEvent(event) ?? turnContextModel;
          serviceTier = serviceTierFromEvent(event, serviceTier);
        } catch { /* malformed row */ }
      }
      serviceTier ??= 'unknown';
    }
    let sessionUuid: string | null = meta.sessionId;
    // On replay reconstruct response ordering from the file, rather than
    // applying the last response from the previous scan to older events.
    let latestUsageResponseId = startOffset > 0 && sessionUuid ? compactions.latest[sessionUuid] : undefined;
    let legacyOrdinaryLifetime: number | null = null;
    let legacyOrdinaryObserved = 0;

    const reader = createCodexLineReader(filePath, startOffset);
    const pendingEmissions: Array<{ pending: PendingCompaction; legacy: boolean }> = [];

    const emitCompaction = (id: string) => {
      const pending = settleCompaction(compactions, id, true);
      if (!pending) return;
      scan.observed += pending.usage.total_tokens;
      pendingEmissions.push({ pending, legacy: upgrading && reader.nextOffset <= (prev?.offset ?? 0) });
    };

    for await (const line of reader) {
      if (!line.trim()) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      serviceTier = serviceTierFromEvent(obj, serviceTier);

      if (obj.type === 'session_meta') {
        const payload = obj.payload as SessionMeta;
        sessionUuid = payload.id ?? sessionUuid;
      }

      if (obj.type === 'compacted' || obj.type === 'token_usage_record') {
        const payload = obj.payload as Record<string, unknown> | undefined;
        const id = readModel(obj.type === 'compacted' ? payload?.compaction_response_id : payload?.response_id);
        if (!id || !sessionUuid) continue;
        const settled = compactions.settled[id];
        if (settled) {
          if (!settled.sessions.includes(sessionUuid)) { settled.sessions.push(sessionUuid); if (settled.standalone) scan.observed += settled.tokens; }
          continue;
        }
        if (obj.type === 'compacted') {
          if (!compactions.markers.includes(id)) compactions.markers.push(id);
          emitCompaction(id);
        } else {
          const raw = normalizeCacheWriteAlias(payload?.usage as TokenUsage | undefined);
          const timestamp = typeof obj.timestamp === 'string' ? obj.timestamp : '';
          if (!raw || !Number.isFinite(Date.parse(timestamp))) continue;
          const delta = normalizeCodexUsage(raw);
          if (!delta || !Number.isFinite(delta.total_tokens)) continue;
          delta.pricing_requests = [{ ...delta, id: createHash('sha256').update(id).digest('hex'), timestamp,
            requestInputTokens: delta.input_tokens + delta.cached_input_tokens + delta.cache_creation_input_tokens, serviceTier }];
          const validCache = validUsageFields([raw.input_tokens], [raw.cached_input_tokens, raw.cache_read_input_tokens, raw.cache_creation_input_tokens]);
          delta.local_metrics = localEvidence(1, true, validCache, validCache);
          compactions.latest[sessionUuid] = id;
          latestUsageResponseId = id;
          const threadUsage = normalizeCacheWriteAlias(payload?.thread_token_usage as TokenUsage | undefined);
          compactions.pending[id] ??= {
            sessionId: sessionUuid, model: readModel(payload?.model) ?? turnContextModel,
            project: meta.sessionProject, timestamp, usage: delta,
            threadUsage: threadUsage ? normalizeCodexUsage(threadUsage) : null,
          };
          if (compactions.markers.includes(id)) emitCompaction(id);
        }
        continue;
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
      const lastUsage = normalizeCacheWriteAlias(info.last_token_usage as TokenUsage | undefined);
      const totalUsage = normalizeCacheWriteAlias(info.total_token_usage as TokenUsage | undefined);
      const modelKey = readModel(info.model) ?? turnContextModel;
      const prevTotals = normalizeCacheWriteAlias(prevTotalMap.get(modelKey));
      const rawUsage = pickDelta(lastUsage, totalUsage, prevTotals);
      if (totalUsage) prevTotalMap.set(modelKey, { ...totalUsage });
      const cumulative = Number(totalUsage?.total_tokens);
      if (Number.isFinite(cumulative) && cumulative > 0) {
        scan.lifetime = scan.lifetime == null ? cumulative : Math.max(scan.lifetime, cumulative);
        if (upgrading && prev && reader.nextOffset <= prev.offset) legacyOrdinaryLifetime = Math.max(legacyOrdinaryLifetime ?? 0, cumulative);
      }

      const isReplayedHistory = tokenCountSeen < replayTokenCountToSkip;
      tokenCountSeen += 1;

      const snapshot = totalUsage
        ? [
            totalUsage.input_tokens,
            totalUsage.cached_input_tokens ??
              totalUsage.cache_read_input_tokens,
            totalUsage.cache_creation_input_tokens,
            totalUsage.output_tokens,
            totalUsage.reasoning_output_tokens,
            totalUsage.total_tokens,
          ]
            .map((value) => value ?? 0)
            .join('|') +
          ':' +
          modelKey
        : undefined;
      const repeated = snapshot !== undefined && snapshot === lastUsageSnapshot;
      lastUsageSnapshot = snapshot;
      if (isReplayedHistory || !rawUsage || repeated) {
        // Fork replay is the parent's usage. Count it as seen so the ledger
        // does not report it again, but do not emit it.
        if (isReplayedHistory && rawUsage) {
          const skipped = normalizeCodexUsage(rawUsage);
          if (skipped) scan.observed += skipped.total_tokens;
        }
        continue;
      }

      let delta = normalizeCodexUsage(rawUsage);
      if (!delta) continue;
      scan.observed += delta.total_tokens;
      if (upgrading && prev && reader.nextOffset <= prev.offset) legacyOrdinaryObserved += delta.total_tokens;

      const latest = latestUsageResponseId;
      const pending = latest ? compactions.pending[latest] : undefined;
      if (latest && pending && (sameUsage(pending.usage, delta) || sameUsage(pending.threadUsage, totalUsage ? normalizeCodexUsage(totalUsage) : null))) {
        settleCompaction(compactions, latest, false);
        delta = uncoveredUsage(delta, pending.ledgerCoveredTokens ?? 0);
        if (!delta) continue;
      }

      const ts = tokenEvent.timestamp;
      if (!ts) continue;
      const hourStart = toUtcHalfHourStart(ts);
      if (!hourStart || new Date(hourStart).getTime() < sinceMs) continue;

      const dedupKey =
        sessionUuid && ts ? `${sessionUuid}:event:${tokenCountSeen}` : null;
      if (
        dedupKey &&
        (seenHashes.has(dedupKey) ||
          (startOffset === 0 && seenHashes.has(`${sessionUuid}:${ts}`)))
      )
        continue;
      if (dedupKey) seenHashes.add(dedupKey);
      if (upgrading && prev && reader.nextOffset <= prev.offset && (sameInode || prev.meta?.sessionId === meta.sessionId)) continue;

      const identifiable =
        !!lastUsage && Object.keys(lastUsage).length > 0 && !!sessionUuid;
      const validCache =
        validUsageFields(
          [rawUsage.input_tokens],
          [
            rawUsage.cached_input_tokens,
            rawUsage.cache_read_input_tokens,
            rawUsage.cache_creation_input_tokens,
          ],
        ) &&
        (rawUsage.cached_input_tokens ??
          rawUsage.cache_read_input_tokens ??
          0) <= rawUsage.input_tokens!;
      if (delta.token_quality !== 'ledger') delta.local_metrics = localEvidence(
        identifiable ? 1 : 0,
        identifiable,
        validCache,
        validCache,
      );
      const model = readModel(info.model) ?? turnContextModel;
      if (delta.token_quality !== 'ledger') delta.pricing_requests = [{
        id: createHash('sha256').update(dedupKey ?? `${logicalPath}:${ts}:${tokenCountSeen}`).digest('hex'), timestamp: ts,
        input_tokens: delta.input_tokens, output_tokens: delta.output_tokens, cached_input_tokens: delta.cached_input_tokens,
        cache_creation_input_tokens: delta.cache_creation_input_tokens, reasoning_output_tokens: delta.reasoning_output_tokens,
        ...(identifiable ? { requestInputTokens: delta.input_tokens + delta.cached_input_tokens + delta.cache_creation_input_tokens } : {}), serviceTier,
      }];
      accumulateBucket(
        bucketState,
        'codex',
        model,
        meta.sessionProject,
        hourStart,
        delta,
        delta.token_quality === 'ledger' ? 'codex-ledger' : undefined,
      );
      scan.emitted += delta.total_tokens;
      eventsParsed += 1;
    }

    scan.sessionId = sessionUuid ?? scan.sessionId;
    const previousLifetime = Math.max(0, ...[...prevTotalMap.values()].map((usage) => Number(usage.total_tokens) || 0));
    if (previousLifetime > 0) scan.lifetime = Math.max(scan.lifetime ?? 0, previousLifetime);
    // An old ledger watermark may already include the newly recognized records.
    // Its excess over observed ordinary usage is overlap, not another charge.
    let legacyCredit = upgrading && sessionUuid && prev
      ? Math.max(0, (codexCursor.ledgerTotals?.[sessionUuid]?.tokens ?? 0) - (legacyOrdinaryLifetime ?? legacyOrdinaryObserved)) : 0;
    for (const { pending, legacy } of pendingEmissions) {
      const allocation = legacy ? Math.min(legacyCredit, pending.usage.total_tokens) : 0;
      legacyCredit -= allocation;
      const hour = toUtcHalfHourStart(pending.timestamp);
      if (!hour || new Date(hour).getTime() < sinceMs) continue;
      const delta = uncoveredUsage(pending.usage, Math.max(allocation, pending.ledgerCoveredTokens ?? 0));
      if (!delta) continue;
      accumulateBucket(bucketState, 'codex', pending.model, pending.project, hour, delta, delta.token_quality === 'ledger' ? 'codex-ledger' : undefined);
      scan.emitted += delta.total_tokens;
      eventsParsed++;
    }
    if (sessionUuid && scan.lifetime !== null) scan.lifetime += compactionLifetime(compactions, sessionUuid);

    const prevTotalSave: CodexFileCursor['prevTotal'] = {};
    for (const [k, v] of prevTotalMap.entries()) {
      prevTotalSave[k] = { ...v };
    }

    codexCursor.files[logicalPath] = {
      encoding,
      physicalSize: st.size,
      mtimeMs: st.mtimeMs,
      inode,
      offset: reader.nextOffset,
      tokenCountSeen,
      lastUsageSnapshot,
      prevTotal: prevTotalSave,
      lastModel: turnContextModel,
      ...(serviceTier !== undefined ? { serviceTier } : {}),
      meta,
    };
    filesProcessed += 1;
  }

  codexCursor.seenHashes = Array.from(seenHashes);
  codexCursor.meteringVersion = 2;
  if (Object.keys(compactions.pending).length || compactions.markers.length || Object.keys(compactions.settled).length) codexCursor.compactions = compactions;

  // No ledger file: leave the cursor untouched so existing JSONL syncs stay
  // byte-identical aside from the buckets they already produced.
  if (codexLedgerDbPaths().length > 0) {
    if (!codexCursor.ledgerTotals) codexCursor.ledgerTotals = {};
    if (!codexCursor.dbMtimes) codexCursor.dbMtimes = {};
    if (!codexCursor.ledgerReadings) codexCursor.ledgerReadings = {};
    const ledger = applyCodexLedger({
      dbMtimes: codexCursor.dbMtimes,
      ledgerTotals: codexCursor.ledgerTotals,
      ledgerReadings: codexCursor.ledgerReadings,
      onGap: (sessionId, gap) => allocateLedgerCoverage(compactions, sessionId, gap),
      priorRolloutNames,
      scans: rolloutScans,
      sinceMs,
      bucketState,
    });
    eventsParsed += ledger.eventsParsed;
    filesProcessed += ledger.filesProcessed;
  }

  const buckets = bucketsFromState(bucketState, 'codex');
  originalCursors.codex = codexCursor;
  return {
    result: { buckets, eventsParsed, filesProcessed },
    cursors: originalCursors,
  };
}
