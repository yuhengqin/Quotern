import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import { resolveProjectName } from '../project-name.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import {
  accumulateBucket,
  bucketsFromState,
  type BucketAccumulator,
} from './shared.js';
import { queryDbJson, readSqliteWithSnapshot } from './sqlite.js';
import { diffGeminiTotals, sameGeminiTotals } from './gemini.js';
import { deriveOpencodeMessageKey, normalizeOpencodeTokens } from './opencode.js';

export const MIMO_COLLECTOR = 'mimocode';

type MimoTotals = Omit<TokenTotals, 'conversation_count'>;

/** Allowlist only Mimo-native provider rows; drop Claude mirror (anthropic). */
export function isMimoNativeMessage(
  data: Record<string, unknown> | null | undefined,
): boolean {
  if (!data || typeof data !== 'object') return false;
  const provider = String(data.providerID ?? '').toLowerCase();
  return provider === 'mimo' || provider === 'xiaomi';
}

function coerceEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
    const d = Date.parse(value);
    if (!Number.isNaN(d)) return d;
  }
  return null;
}

function projectFromMessage(data: Record<string, unknown>): string {
  const pathObj = data.path as { root?: string; cwd?: string } | undefined;
  const root = pathObj?.root ?? pathObj?.cwd;
  if (typeof root === 'string' && root.trim()) {
    return resolveProjectName(root);
  }
  return 'unknown';
}

function mimoDataDir(): string {
  const mimoHome = process.env.MIMO_HOME?.trim();
  if (mimoHome) {
    return mimoHome.startsWith('~') ? join(homedir(), mimoHome.slice(1)) : mimoHome;
  }
  const xdg = process.env.XDG_DATA_HOME?.trim();
  if (xdg) {
    return join(xdg.startsWith('~') ? join(homedir(), xdg.slice(1)) : xdg, 'mimocode');
  }
  return join(homedir(), '.local', 'share', 'mimocode');
}

/** Mimo SQLite DB path (MIMO_DB_PATH override for tests). */
export function mimoDbPath(): string {
  const explicit = process.env.MIMO_DB_PATH?.trim();
  if (explicit) {
    return explicit.startsWith('~') ? join(homedir(), explicit.slice(1)) : explicit;
  }
  return join(mimoDataDir(), 'mimocode.db');
}

function ingestMessage(
  opts: {
    messageKey: string | null;
    currentTotals: MimoTotals;
    model: string;
    project: string;
    timestampMs: number | null;
    sinceMs: number;
    messageIndex: Record<string, { lastTotals: MimoTotals }>;
    bucketState: BucketAccumulator;
  },
): number {
  const {
    messageKey,
    currentTotals,
    model,
    project,
    timestampMs,
    sinceMs,
    messageIndex,
    bucketState,
  } = opts;

  const prev = messageKey ? messageIndex[messageKey]?.lastTotals : undefined;
  const delta = diffGeminiTotals(currentTotals, prev);
  if (messageKey && !sameGeminiTotals(currentTotals, prev)) {
    messageIndex[messageKey] = { lastTotals: currentTotals };
  }
  if (!delta) return 0;
  if (!timestampMs) return 0;

  const tsIso = new Date(timestampMs).toISOString();
  const hourStart = toUtcHalfHourStart(tsIso);
  if (!hourStart) return 0;
  if (new Date(hourStart).getTime() < sinceMs) return 0;

  accumulateBucket(
    bucketState,
    'mimo',
    model || 'unknown',
    project,
    hourStart,
    { ...delta, conversation_count: 1 },
    MIMO_COLLECTOR,
  );
  return 1;
}

function parseFromSqlite(
  dbPath: string,
  sinceMs: number,
  messageIndex: Record<string, { lastTotals: MimoTotals }>,
  bucketState: BucketAccumulator,
): { eventsParsed: number; filesProcessed: number } {
  const query = `SELECT
    id,
    session_id,
    json_extract(data, '$.role') as role,
    json_extract(data, '$.time.created') as created,
    json_extract(data, '$.time.completed') as completed,
    json_extract(data, '$.modelID') as modelID,
    json_extract(data, '$.model') as model,
    json_extract(data, '$.modelId') as modelId,
    json_extract(data, '$.providerID') as providerID,
    json_extract(data, '$.tokens') as tokens,
    json_extract(data, '$.path.root') as rootPath,
    json_extract(data, '$.path.cwd') as cwdPath,
    data
    FROM message
    WHERE json_extract(data, '$.role') = 'assistant'`;

  let rows: Record<string, unknown>[];
  try {
    rows = readSqliteWithSnapshot(dbPath, (snap) => queryDbJson(snap, query));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ENOENT|sqlite3 CLI not found/i.test(msg)) {
      throw new Error(
        'sqlite3 CLI not found. Install sqlite3 (or use Node >= 22.5) to sync Mimo data.',
      );
    }
    throw err;
  }

  let eventsParsed = 0;
  for (const row of rows) {
    let data: Record<string, unknown> | null = null;
    try {
      data =
        typeof row.data === 'string'
          ? (JSON.parse(row.data) as Record<string, unknown>)
          : (row.data as Record<string, unknown> | null);
    } catch {
      continue;
    }
    if (!data || !isMimoNativeMessage(data)) continue;

    let tokens: Record<string, unknown> | null = null;
    try {
      tokens =
        typeof row.tokens === 'string'
          ? (JSON.parse(row.tokens) as Record<string, unknown>)
          : (row.tokens as Record<string, unknown> | null);
    } catch {
      tokens = (data.tokens as Record<string, unknown> | undefined) ?? null;
    }

    const currentTotals = normalizeOpencodeTokens(tokens);
    if (!currentTotals) continue;

    const sessionId =
      (typeof row.session_id === 'string' && row.session_id) ||
      (typeof data.sessionID === 'string' && data.sessionID) ||
      null;
    const msgId = (typeof row.id === 'string' && row.id) || (typeof data.id === 'string' && data.id) || null;
    const messageKey = deriveOpencodeMessageKey(sessionId, msgId);
    const model =
      (typeof row.modelID === 'string' && row.modelID) ||
      (typeof row.model === 'string' && row.model) ||
      (typeof row.modelId === 'string' && row.modelId) ||
      (typeof data.modelID === 'string' && data.modelID) ||
      'unknown';
    const project = projectFromMessage(data);
    const timestampMs =
      coerceEpochMs(row.completed) ||
      coerceEpochMs(data.time && typeof data.time === 'object'
        ? (data.time as { completed?: unknown }).completed
        : null) ||
      coerceEpochMs(row.created) ||
      coerceEpochMs(data.time && typeof data.time === 'object'
        ? (data.time as { created?: unknown }).created
        : null);

    eventsParsed += ingestMessage({
      messageKey,
      currentTotals,
      model,
      project,
      timestampMs,
      sinceMs,
      messageIndex,
      bucketState,
    });
  }

  return { eventsParsed, filesProcessed: rows.length > 0 ? 1 : 0 };
}

export interface ParseMimoResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parseMimoIncremental(
  cursors: CursorsFile,
  statsSince: string,
): Promise<{ result: ParseMimoResult; cursors: CursorsFile }> {
  const sinceMs = new Date(statsSince).getTime();
  if (!cursors.mimo) {
    cursors.mimo = { messages: {} };
  }
  if (!cursors.mimo.messages) {
    cursors.mimo.messages = {};
  }
  const messageIndex = cursors.mimo.messages;
  const bucketState: BucketAccumulator = new Map();

  const dbPath = mimoDbPath();
  if (!existsSync(dbPath)) {
    return {
      result: { buckets: [], eventsParsed: 0, filesProcessed: 0 },
      cursors,
    };
  }

  try {
    const parsed = parseFromSqlite(dbPath, sinceMs, messageIndex, bucketState);
    return {
      result: {
        buckets: bucketsFromState(bucketState, 'mimo'),
        eventsParsed: parsed.eventsParsed,
        filesProcessed: parsed.filesProcessed,
      },
      cursors,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/sqlite3 CLI not found/i.test(msg)) {
      return {
        result: {
          buckets: [],
          eventsParsed: 0,
          filesProcessed: 0,
          skipped: true,
          error: msg,
        },
        cursors,
      };
    }
    throw err;
  }
}
