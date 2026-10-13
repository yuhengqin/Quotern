/**
 * Zed editor passive reader — source `zed`, collector `zed`.
 *
 * Reads cumulative token usage from threads.db BLOB payloads (json or zstd).
 */
import { statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import * as zlib from 'node:zlib';

import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import {
  accumulateBucket,
  bucketsFromState,
  computeTotalTokens,
  type BucketAccumulator,
} from './shared.js';
import { queryDbJson, readSqliteWithSnapshot } from './sqlite.js';

export const ZED_COLLECTOR = 'zed';

const MAX_THREAD_TOTALS = 10_000;
const MAX_ZED_THREAD_JSON_BYTES = 32 * 1024 * 1024;

type ZedThreadTotals = {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
};

type ZedUsageTuple = ZedThreadTotals;

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

/** Resolve Zed threads.db (env overrides first). */
export function zedDbPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.AI_USAGE_ZED_DB?.trim();
  if (explicit) return expandHome(explicit);

  const home = env.HOME?.trim() || homedir();
  const plat = platform();

  if (plat === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Zed', 'threads', 'threads.db');
  }
  if (plat === 'win32') {
    const local = env.LOCALAPPDATA?.trim() || join(home, 'AppData', 'Local');
    return join(local, 'Zed', 'threads', 'threads.db');
  }
  const xdg = env.XDG_DATA_HOME?.trim() || join(home, '.local', 'share');
  return join(xdg, 'zed', 'threads', 'threads.db');
}

/** Decode threads.data BLOB → UTF-8 JSON text (Node built-in zstd only). */
export function decodeZedThreadBlob(dataType: unknown, data: Buffer): string {
  const type = typeof dataType === 'string' ? dataType.trim().toLowerCase() : '';
  if (type === 'json') {
    if (data.length > MAX_ZED_THREAD_JSON_BYTES) {
      throw new Error(`json blob exceeds ${MAX_ZED_THREAD_JSON_BYTES} bytes`);
    }
    return data.toString('utf8');
  }
  if (type === 'zstd') {
    if (typeof zlib.zstdDecompressSync !== 'function') {
      throw new Error('zstdDecompressSync unavailable (Node >= 22.9 with zstd support required)');
    }
    const out = zlib.zstdDecompressSync(data);
    if (out.length > MAX_ZED_THREAD_JSON_BYTES) {
      throw new Error(`decoded zstd blob exceeds ${MAX_ZED_THREAD_JSON_BYTES} bytes`);
    }
    return out.toString('utf8');
  }
  throw new Error(`unsupported data_type: ${String(dataType)}`);
}

function readZedUsage(value: unknown): ZedUsageTuple | null {
  if (!value || typeof value !== 'object') return null;
  const coerce = (v: unknown): number => {
    if (typeof v === 'number') return Math.max(0, Math.floor(v));
    if (typeof v === 'string') {
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
    return 0;
  };
  const obj = value as Record<string, unknown>;
  return {
    input: coerce(obj.input_tokens),
    output: coerce(obj.output_tokens),
    cache_read: coerce(obj.cache_read_input_tokens),
    cache_write: coerce(obj.cache_creation_input_tokens),
  };
}

function sumZedRequestUsage(value: unknown): ZedUsageTuple {
  const total: ZedUsageTuple = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  if (!value) return total;
  const iter = Array.isArray(value) ? value : typeof value === 'object' ? Object.values(value) : [];
  for (const entry of iter) {
    const u = readZedUsage(entry);
    if (!u) continue;
    total.input += u.input;
    total.output += u.output;
    total.cache_read += u.cache_read;
    total.cache_write += u.cache_write;
  }
  return total;
}

function extractZedTotals(thread: Record<string, unknown>): { totals: ZedUsageTuple; model: string } | null {
  if (thread.imported === true) return null;
  const modelObj = thread.model;
  if (!modelObj || typeof modelObj !== 'object') return null;
  const modelId =
    typeof (modelObj as { model?: unknown }).model === 'string'
      ? (modelObj as { model: string }).model.trim()
      : '';
  if (!modelId) return null;

  const request = sumZedRequestUsage(thread.request_token_usage);
  if (request.input + request.output + request.cache_read + request.cache_write > 0) {
    return { totals: request, model: modelId };
  }
  const cumulative = readZedUsage(thread.cumulative_token_usage);
  if (
    cumulative &&
    cumulative.input + cumulative.output + cumulative.cache_read + cumulative.cache_write > 0
  ) {
    return { totals: cumulative, model: modelId };
  }
  return null;
}

function buildZedThreadsQuery(dbPath: string, cursorUpdatedAt: string | null): string {
  const pragmaRows = queryDbJson(dbPath, 'PRAGMA table_info(threads)', {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 10_000,
  });
  const columns = new Set(
    pragmaRows.map((row) => row?.name).filter((name): name is string => typeof name === 'string'),
  );
  const optional = (col: string) => (columns.has(col) ? col : `NULL AS ${col}`);
  const escaped =
    typeof cursorUpdatedAt === 'string' && cursorUpdatedAt
      ? cursorUpdatedAt.replace(/'/g, "''")
      : null;
  const where = escaped ? ` WHERE updated_at > '${escaped}'` : '';
  return `SELECT id, updated_at, ${optional('created_at')}, data_type, hex(data) AS data_hex FROM threads${where}`;
}

function readZedThreadRowsFromSqlite(
  dbPath: string,
  cursorUpdatedAt: string | null,
): Record<string, unknown>[] {
  const query = buildZedThreadsQuery(dbPath, cursorUpdatedAt);
  return queryDbJson(dbPath, query, { maxBuffer: 256 * 1024 * 1024, timeout: 60_000 });
}

function capThreadTotals(threadTotals: Record<string, ZedThreadTotals>): void {
  const entries = Object.entries(threadTotals);
  if (entries.length <= MAX_THREAD_TOTALS) return;
  entries.sort((a, b) => {
    const ta = a[1].input + a[1].output + a[1].cache_read + a[1].cache_write;
    const tb = b[1].input + b[1].output + b[1].cache_read + b[1].cache_write;
    return tb - ta;
  });
  for (const k of Object.keys(threadTotals)) delete threadTotals[k];
  for (const [id, totals] of entries.slice(0, MAX_THREAD_TOTALS)) {
    threadTotals[id] = totals;
  }
}

function parseZedRows(
  rows: Record<string, unknown>[],
  sinceMs: number,
  threadTotals: Record<string, ZedThreadTotals>,
  bucketState: BucketAccumulator,
): { eventsParsed: number } {
  let eventsParsed = 0;

  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || typeof row.data_hex !== 'string') continue;

    let blob: Buffer;
    try {
      blob = Buffer.from(row.data_hex, 'hex');
    } catch {
      continue;
    }

    let jsonText: string;
    try {
      jsonText = decodeZedThreadBlob(row.data_type, blob);
    } catch {
      continue;
    }

    let thread: Record<string, unknown>;
    try {
      thread = JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      continue;
    }

    const extracted = extractZedTotals(thread);
    if (!extracted) continue;

    const prev = threadTotals[row.id] ?? { input: 0, output: 0, cache_read: 0, cache_write: 0 };
    const curr = extracted.totals;
    const prevSum = prev.input + prev.output + prev.cache_read + prev.cache_write;
    const currSum = curr.input + curr.output + curr.cache_read + curr.cache_write;
    const isReset = currSum > 0 && currSum < prevSum;
    const delta = isReset
      ? { ...curr }
      : {
          input: Math.max(0, curr.input - prev.input),
          output: Math.max(0, curr.output - prev.output),
          cache_read: Math.max(0, curr.cache_read - prev.cache_read),
          cache_write: Math.max(0, curr.cache_write - prev.cache_write),
        };
    const totalDelta = delta.input + delta.output + delta.cache_read + delta.cache_write;

    if (totalDelta <= 0) {
      if (
        curr.input !== prev.input ||
        curr.output !== prev.output ||
        curr.cache_read !== prev.cache_read ||
        curr.cache_write !== prev.cache_write
      ) {
        threadTotals[row.id] = curr;
      }
      continue;
    }

    const tsIso =
      (typeof row.updated_at === 'string' && row.updated_at) ||
      (typeof row.created_at === 'string' && row.created_at) ||
      (typeof thread.updated_at === 'string' && thread.updated_at) ||
      new Date().toISOString();
    const hourStart = toUtcHalfHourStart(tsIso);
    if (!hourStart || new Date(hourStart).getTime() < sinceMs) {
      threadTotals[row.id] = curr;
      continue;
    }

    const deltaBody = {
      input_tokens: delta.input,
      cached_input_tokens: delta.cache_read,
      cache_creation_input_tokens: delta.cache_write,
      output_tokens: delta.output,
      reasoning_output_tokens: 0,
    };
    const tokenDelta: TokenTotals = {
      ...deltaBody,
      total_tokens: computeTotalTokens(deltaBody),
      conversation_count: 1,
    };

    accumulateBucket(bucketState, 'zed', extracted.model, 'unknown', hourStart, tokenDelta, ZED_COLLECTOR);
    threadTotals[row.id] = curr;
    eventsParsed += 1;
  }

  return { eventsParsed };
}

export interface ParseZedResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parseZedIncremental(
  cursors: CursorsFile,
  statsSince: string,
): Promise<{ result: ParseZedResult; cursors: CursorsFile }> {
  const sinceMs = new Date(statsSince).getTime();
  if (!cursors.zed) cursors.zed = {};
  if (!cursors.zed.threadTotals) cursors.zed.threadTotals = {};
  const threadTotals = cursors.zed.threadTotals as Record<string, ZedThreadTotals>;
  const cursorUpdatedAt =
    typeof cursors.zed.lastUpdatedAt === 'string' ? cursors.zed.lastUpdatedAt : null;

  const resolvedDb = zedDbPath();
  if (!resolvedDb) {
    cursors.zed.updatedAt = new Date().toISOString();
    return { result: { buckets: [], eventsParsed: 0, filesProcessed: 0 }, cursors };
  }

  const cursorDbMtime = Number.isFinite(cursors.zed.lastDbMtimeMs)
    ? cursors.zed.lastDbMtimeMs!
    : 0;
  let currentMtime = 0;
  try {
    currentMtime = statSync(resolvedDb).mtimeMs;
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      cursors.zed.updatedAt = new Date().toISOString();
      return { result: { buckets: [], eventsParsed: 0, filesProcessed: 0 }, cursors };
    }
    throw err;
  }

  if (currentMtime > 0 && currentMtime === cursorDbMtime) {
    cursors.zed.updatedAt = new Date().toISOString();
    return {
      result: { buckets: [], eventsParsed: 0, filesProcessed: 0, skipped: true },
      cursors,
    };
  }

  const bucketState: BucketAccumulator = new Map();
  let eventsParsed = 0;
  let filesProcessed = 0;
  let nextCursor = cursorUpdatedAt;

  try {
    const rows = readSqliteWithSnapshot(resolvedDb, (snap) =>
      readZedThreadRowsFromSqlite(snap, cursorUpdatedAt),
    );
    filesProcessed = rows.length > 0 ? 1 : 0;

    if (rows.length > 0) {
      const parsed = parseZedRows(rows, sinceMs, threadTotals, bucketState);
      eventsParsed = parsed.eventsParsed;

      // Advance watermark from all touched rows (pre-cap).
      for (const r of rows) {
        if (
          typeof r.updated_at === 'string' &&
          threadTotals[r.id as string] !== undefined &&
          (nextCursor == null || r.updated_at > nextCursor)
        ) {
          nextCursor = r.updated_at;
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ENOENT|sqlite3 CLI not found/i.test(msg)) {
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

  capThreadTotals(threadTotals);
  cursors.zed.lastUpdatedAt = nextCursor;
  cursors.zed.lastDbMtimeMs = currentMtime;
  cursors.zed.updatedAt = new Date().toISOString();

  return {
    result: {
      buckets: bucketsFromState(bucketState, 'zed'),
      eventsParsed,
      filesProcessed,
    },
    cursors,
  };
}
