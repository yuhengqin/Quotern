/**
 * Grok Build passive reader (source `grok`, collector `grok-build`).
 *
 * Reads ~/.grok/sessions/<encoded>/<sessionId>/updates.jsonl high-watermark
 * totalTokens diffs plus signals.json fallbacks. NEVER treat contextTokensUsed
 * alone as cumulative (PR#74).
 */
import {
  closeSync,
  createReadStream,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { stat } from 'node:fs/promises';

import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import {
  accumulateBucket,
  bucketsFromState,
  type BucketAccumulator,
} from './shared.js';

export const GROK_COLLECTOR = 'grok-build';

const GROK_ESTIMATED_INPUT_RATIO = 0.8;
const GROK_CURSOR_VERSION = 3;

export interface GrokBuildSession {
  sessionDir: string;
  updatesPath: string;
  signalsPath: string;
  summaryPath: string;
  sessionId: string;
  encodedCwd: string;
}

type GrokSessionSnapshot = {
  totalTokens: number;
  messageCount: number;
  model: string | null;
  source?: string | null;
  lastEventId?: string | null;
  lastEventTimestamp?: string | null;
  updatedAt?: string | null;
  legacySeen?: boolean;
};

type GrokExtCursors = CursorsFile & {
  grok?: {
    version?: number;
    sessionSnapshots?: Record<string, GrokSessionSnapshot>;
    seenSessions?: string[];
    updateOffsets?: Record<string, { size: number; mtimeMs: number; ino: number }>;
    updatedAt?: string;
  };
};

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export function resolveGrokBuildHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AI_USAGE_GROK_HOME?.trim() || env.GROK_HOME?.trim();
  if (override) return expandHome(override);
  return join(homedir(), '.grok');
}

export function resolveGrokBuildSessions(env: NodeJS.ProcessEnv = process.env): GrokBuildSession[] {
  const home = resolveGrokBuildHome(env);
  const sessionsRoot = join(home, 'sessions');
  if (!existsSync(sessionsRoot)) return [];

  const results: GrokBuildSession[] = [];
  let cwdDirs: string[];
  try {
    cwdDirs = readdirSync(sessionsRoot);
  } catch {
    return [];
  }

  for (const cwdDir of cwdDirs) {
    const cwdPath = join(sessionsRoot, cwdDir);
    let cwdStat;
    try {
      cwdStat = statSync(cwdPath);
    } catch {
      continue;
    }
    if (!cwdStat.isDirectory()) continue;

    let sessionIds: string[];
    try {
      sessionIds = readdirSync(cwdPath);
    } catch {
      continue;
    }

    for (const sid of sessionIds) {
      const sessionDir = join(cwdPath, sid);
      const signalsPath = join(sessionDir, 'signals.json');
      const updatesPath = join(sessionDir, 'updates.jsonl');
      if (existsSync(signalsPath) || existsSync(updatesPath)) {
        results.push({
          sessionDir,
          updatesPath,
          signalsPath,
          summaryPath: join(sessionDir, 'summary.json'),
          sessionId: sid,
          encodedCwd: cwdDir,
        });
      }
    }
  }
  return results;
}

function normalizeModel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function toNonNeg(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.trunc(v);
}

function readGrokJsonFile(filePath: string | undefined): Record<string, unknown> | null {
  if (!filePath) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeGrokSessionSnapshots(grokState: GrokExtCursors['grok']): Record<string, GrokSessionSnapshot> {
  const snapshots: Record<string, GrokSessionSnapshot> = {};
  if (grokState?.sessionSnapshots && typeof grokState.sessionSnapshots === 'object') {
    for (const [sessionId, snapshot] of Object.entries(grokState.sessionSnapshots)) {
      const safeSessionId = normalizeModel(sessionId);
      if (!safeSessionId || !snapshot || typeof snapshot !== 'object') continue;
      snapshots[safeSessionId] = {
        totalTokens: toNonNeg(snapshot.totalTokens),
        messageCount: toNonNeg(snapshot.messageCount),
        model: normalizeModel(snapshot.model),
        source: normalizeModel(snapshot.source),
        lastEventId: normalizeModel(snapshot.lastEventId),
        lastEventTimestamp: normalizeModel(snapshot.lastEventTimestamp),
        updatedAt: normalizeModel(snapshot.updatedAt),
        legacySeen: snapshot.legacySeen === true,
      };
    }
  }
  if (Array.isArray(grokState?.seenSessions)) {
    for (const sessionId of grokState.seenSessions) {
      const safeSessionId = normalizeModel(sessionId);
      if (!safeSessionId || snapshots[safeSessionId]) continue;
      snapshots[safeSessionId] = {
        totalTokens: 0,
        messageCount: 0,
        model: null,
        updatedAt: normalizeModel(grokState.updatedAt),
        legacySeen: true,
      };
    }
  }
  return snapshots;
}

function capGrokSessionSnapshots(
  sessionSnapshots: Record<string, GrokSessionSnapshot>,
): Record<string, GrokSessionSnapshot> {
  const entries = Object.entries(sessionSnapshots);
  if (entries.length <= 10_000) return sessionSnapshots;
  return Object.fromEntries(entries.slice(entries.length - 10_000));
}

function grokUpdatesPathForSession(sess: GrokBuildSession): string | null {
  if (typeof sess.updatesPath === 'string' && sess.updatesPath.trim()) return sess.updatesPath;
  if (typeof sess.sessionDir === 'string' && sess.sessionDir.trim()) {
    return join(sess.sessionDir, 'updates.jsonl');
  }
  return null;
}

function grokSessionIdFor(sess: GrokBuildSession): string | null {
  return normalizeModel(sess.sessionId) || normalizeModel(basename(sess.sessionDir));
}

function grokModelFromSignals(signals: Record<string, unknown>): string {
  const modelsUsed = signals.modelsUsed;
  const firstModel = Array.isArray(modelsUsed) ? modelsUsed[0] : null;
  return (
    normalizeModel(signals.primaryModelId) ||
    normalizeModel(firstModel) ||
    normalizeModel(signals.model) ||
    'grok-build'
  );
}

function grokLastActiveFromSignals(
  signals: Record<string, unknown>,
  summary: Record<string, unknown> | null,
): string {
  return (
    normalizeModel(signals.lastActiveAt) ||
    normalizeModel(signals.updatedAt) ||
    normalizeModel(signals.lastActive) ||
    normalizeModel(summary?.updated_at) ||
    normalizeModel(summary?.updatedAt) ||
    new Date().toISOString()
  );
}

function grokMessageCountFromSignals(signals: Record<string, unknown>): number {
  return toNonNeg(
    signals.assistantMessageCount ??
      signals.turnCount ??
      signals.num_chat_messages ??
      signals.messageCount,
  );
}

/** contextTokensUsed alone is NOT cumulative — see grokEffectiveTotalFromSignals. */
function grokEffectiveTotalFromSignals(signals: Record<string, unknown>): number {
  const beforeCompaction = toNonNeg(signals.totalTokensBeforeCompaction);
  const totalTokens = toNonNeg(signals.totalTokens);
  if (signals.contextTokensUsed == null) {
    return beforeCompaction + totalTokens;
  }
  return Math.max(
    totalTokens,
    beforeCompaction + toNonNeg(signals.contextTokensUsed),
  );
}

function grokTimestampToIso(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    const dt = new Date(millis);
    return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^[0-9]+(?:\.[0-9]+)?$/.test(trimmed)) {
      return grokTimestampToIso(Number(trimmed));
    }
    const dt = new Date(trimmed);
    return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
  }
  return null;
}

function grokTimestampFromUpdate(
  meta: Record<string, unknown>,
  record: Record<string, unknown>,
  fallback: string,
): string {
  return (
    grokTimestampToIso(meta.agentTimestampMs) ||
    grokTimestampToIso(meta.timestampMs) ||
    grokTimestampToIso(record.timestamp_ms) ||
    grokTimestampToIso(record.timestamp) ||
    grokTimestampToIso(record.time) ||
    fallback
  );
}

function grokEventId(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function grokFileEndsWithNewline(filePath: string, size: number): boolean {
  if (!(size > 0)) return false;
  let fd: number | undefined;
  try {
    fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(1);
    const read = readSync(fd, buf, 0, 1, size - 1);
    return read === 1 && buf[0] === 0x0a;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

interface GrokUpdateEvent {
  totalTokens: number;
  timestamp: string;
  eventId: string;
}

async function readGrokUpdateTokenEvents(
  updatesPath: string | null,
  fallbackTimestamp: string,
  prevOffsetEntry: { size?: number; ino?: number } | null | undefined,
): Promise<{
  events: GrokUpdateEvent[];
  offsetEntry: { size: number; mtimeMs: number; ino: number } | null;
}> {
  if (!updatesPath) return { events: [], offsetEntry: null };
  const st = await stat(updatesPath).catch(() => null);
  if (!st?.isFile()) return { events: [], offsetEntry: null };

  const prevSize = prevOffsetEntry?.size ?? 0;
  const prevIno = prevOffsetEntry?.ino;
  const inodeChanged = typeof prevIno === 'number' && prevIno !== st.ino;
  const startOffset = st.size < prevSize || inodeChanged ? 0 : prevSize;
  const baseOffset = { mtimeMs: st.mtimeMs, ino: st.ino };
  if (st.size <= startOffset) {
    return { events: [], offsetEntry: { size: startOffset, ...baseOffset } };
  }

  const endsWithNewline = grokFileEndsWithNewline(updatesPath, st.size);
  const events: GrokUpdateEvent[] = [];
  let lineIndex = 0;
  let lastLine = '';

  try {
    const input = createReadStream(updatesPath, {
      start: startOffset,
      end: st.size - 1,
    });
    const rl = createInterface({ input, crlfDelay: Infinity });

    for await (const line of rl) {
      lineIndex += 1;
      lastLine = line;
      if (!line.trim()) continue;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const params = record.params && typeof record.params === 'object'
        ? (record.params as Record<string, unknown>)
        : null;
      const meta =
        (params?._meta && typeof params._meta === 'object'
          ? (params._meta as Record<string, unknown>)
          : null) ??
        (record._meta && typeof record._meta === 'object'
          ? (record._meta as Record<string, unknown>)
          : null);
      if (!meta) continue;
      const totalTokens = toNonNeg(meta.totalTokens);
      if (totalTokens <= 0) continue;
      const timestamp = grokTimestampFromUpdate(meta, record, fallbackTimestamp);
      events.push({
        totalTokens,
        timestamp,
        eventId: grokEventId(meta.eventId ?? record.eventId ?? record.id, String(lineIndex)),
      });
    }
  } catch {
    return { events, offsetEntry: prevOffsetEntry ? { size: prevOffsetEntry.size ?? 0, mtimeMs: st.mtimeMs, ino: st.ino } : null };
  }

  const trailingPartialBytes = endsWithNewline ? 0 : Buffer.byteLength(lastLine, 'utf8');
  const committedSize = Math.max(startOffset, st.size - trailingPartialBytes);
  return { events, offsetEntry: { size: committedSize, ...baseOffset } };
}

function estimateGrokTokenDelta(
  totalTokens: number,
  conversationCount: number,
  options: { allowZeroConversationCount?: boolean } = {},
): TokenTotals {
  const total = toNonNeg(totalTokens);
  const inputTokens = Math.round(total * GROK_ESTIMATED_INPUT_RATIO);
  const outputTokens = Math.max(0, total - inputTokens);
  const rawConversations = toNonNeg(conversationCount);
  const conversations = options.allowZeroConversationCount
    ? rawConversations
    : Math.max(1, rawConversations);

  return {
    input_tokens: inputTokens,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: outputTokens,
    reasoning_output_tokens: 0,
    total_tokens: total,
    conversation_count: conversations,
  };
}

export interface ParseGrokResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parseGrokBuildIncremental(
  cursors: CursorsFile,
  statsSince: string,
  opts?: { env?: NodeJS.ProcessEnv; sessions?: GrokBuildSession[] },
): Promise<{ result: ParseGrokResult; cursors: CursorsFile }> {
  const env = opts?.env ?? process.env;
  const sinceMs = new Date(statsSince).getTime();
  const ext = cursors as GrokExtCursors;
  if (!ext.grok) ext.grok = {};
  let sessionSnapshots = normalizeGrokSessionSnapshots(ext.grok);
  const prevUpdateOffsets = ext.grok.updateOffsets ?? {};
  const updateOffsets: Record<string, { size: number; mtimeMs: number; ino: number }> = {};
  const bucketState: BucketAccumulator = new Map();
  const sessionList = opts?.sessions ?? resolveGrokBuildSessions(env);

  let eventsParsed = 0;
  let filesProcessed = 0;

  for (const sess of sessionList) {
    const sessionId = grokSessionIdFor(sess);
    if (!sessionId) continue;

    const signals = readGrokJsonFile(sess.signalsPath) ?? {};
    const summary = readGrokJsonFile(sess.summaryPath) ?? {};
    const previous = sessionSnapshots[sessionId] ?? {
      totalTokens: 0,
      messageCount: 0,
      model: null,
    };
    const previousTotal = toNonNeg(previous.totalTokens);
    const previousMessageCount = toNonNeg(previous.messageCount);
    const messageCount = grokMessageCountFromSignals(signals);
    const model = grokModelFromSignals(signals);
    const lastActive = grokLastActiveFromSignals(signals, summary);
    const project = sess.encodedCwd || 'unknown';

    let highWatermark = previousTotal;
    let observedTotal = previousTotal;
    let tokenDeltaForSession = 0;
    let finalTouchedHourStart: string | null = null;
    let source = previous.source ?? null;
    let lastEventId = previous.lastEventId ?? null;
    let lastEventTimestamp = previous.lastEventTimestamp ?? null;
    const pendingTokenDeltas: Array<{ deltaTokens: number; hourStartStr: string }> = [];

    const recordTokenDelta = (deltaTokens: number, timestamp: string, deltaSource: string): boolean => {
      const hourStartStr =
        toUtcHalfHourStart(timestamp) || toUtcHalfHourStart(new Date().toISOString());
      if (!hourStartStr) return false;
      pendingTokenDeltas.push({ deltaTokens, hourStartStr });
      tokenDeltaForSession += deltaTokens;
      finalTouchedHourStart = hourStartStr;
      source = deltaSource;
      lastEventTimestamp = timestamp || lastEventTimestamp;
      return true;
    };

    const updatesPath = grokUpdatesPathForSession(sess);
    const updates = await readGrokUpdateTokenEvents(
      updatesPath,
      lastActive,
      updatesPath ? prevUpdateOffsets[updatesPath] : null,
    );
    if (updatesPath && updates.offsetEntry) {
      updateOffsets[updatesPath] = updates.offsetEntry;
      filesProcessed += 1;
    }

    for (const event of updates.events) {
      observedTotal = Math.max(observedTotal, event.totalTokens);
      lastEventId = event.eventId || lastEventId;
      lastEventTimestamp = event.timestamp || lastEventTimestamp;
      if (event.totalTokens <= highWatermark) continue;
      const deltaTokens = event.totalTokens - highWatermark;
      highWatermark = event.totalTokens;
      recordTokenDelta(deltaTokens, event.timestamp || lastActive, 'updates');
    }

    const effectiveSignalTotal = grokEffectiveTotalFromSignals(signals);
    observedTotal = Math.max(observedTotal, effectiveSignalTotal);
    if (effectiveSignalTotal > highWatermark) {
      const deltaTokens = effectiveSignalTotal - highWatermark;
      highWatermark = effectiveSignalTotal;
      recordTokenDelta(deltaTokens, lastActive, 'signals');
    }

    const finalTotal = Math.max(previousTotal, highWatermark, observedTotal);
    const legacyBaselineOnly = previous.legacySeen === true && previousTotal === 0 && finalTotal > 0;

    if (!legacyBaselineOnly) {
      for (const pending of pendingTokenDeltas) {
        if (new Date(pending.hourStartStr).getTime() < sinceMs) continue;
        const delta = estimateGrokTokenDelta(pending.deltaTokens, 0, {
          allowZeroConversationCount: true,
        });
        accumulateBucket(
          bucketState,
          'grok',
          model,
          project,
          pending.hourStartStr,
          delta,
          GROK_COLLECTOR,
        );
        eventsParsed += 1;
      }
    }

    if (!legacyBaselineOnly && tokenDeltaForSession > 0 && finalTouchedHourStart) {
      if (new Date(finalTouchedHourStart).getTime() >= sinceMs) {
        const deltaMessageCount =
          messageCount > previousMessageCount ? messageCount - previousMessageCount : 1;
        accumulateBucket(
          bucketState,
          'grok',
          model,
          project,
          finalTouchedHourStart,
          {
            input_tokens: 0,
            output_tokens: 0,
            cached_input_tokens: 0,
            cache_creation_input_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: 0,
            conversation_count: deltaMessageCount,
          },
          GROK_COLLECTOR,
        );
      }
    }

    if (finalTotal > 0 && (tokenDeltaForSession > 0 || previousTotal > 0 || legacyBaselineOnly)) {
      sessionSnapshots[sessionId] = {
        totalTokens: finalTotal,
        messageCount: Math.max(previousMessageCount, messageCount),
        model,
        source: source || previous.source || null,
        lastEventId,
        lastEventTimestamp,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  sessionSnapshots = capGrokSessionSnapshots(sessionSnapshots);
  ext.grok = {
    ...ext.grok,
    version: GROK_CURSOR_VERSION,
    sessionSnapshots,
    seenSessions: Object.keys(sessionSnapshots),
    updateOffsets,
    updatedAt: new Date().toISOString(),
  };

  return {
    result: {
      buckets: bucketsFromState(bucketState, 'grok'),
      eventsParsed,
      filesProcessed,
    },
    cursors,
  };
}
