/**
 * Goose (Block AI agent) passive reader — source `goose`, collector `goose`.
 *
 * SQLite sessions table with cumulative accumulated_* token columns.
 */
import { existsSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import {
  accumulateBucket,
  bucketsFromState,
  computeTotalTokens,
  type BucketAccumulator,
} from './shared.js';
import { queryDbJson, readSqliteWithSnapshot } from './sqlite.js';

export const GOOSE_COLLECTOR = 'goose';

const MAX_SESSION_TOTALS = 10_000;

type GooseSessionTotals = {
  input: number;
  output: number;
  total: number;
};

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

/** Resolve Goose sessions.db (env overrides first). */
export function gooseDbPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.AI_USAGE_GOOSE_DB?.trim();
  if (explicit) return expandHome(explicit);

  const root = env.GOOSE_PATH_ROOT?.trim();
  if (root) return join(expandHome(root), 'data', 'sessions', 'sessions.db');

  const home = env.HOME?.trim() || homedir();
  const plat = platform();
  const candidates: string[] = [];

  if (plat === 'darwin') {
    candidates.push(
      join(home, 'Library', 'Application Support', 'goose', 'sessions', 'sessions.db'),
    );
  } else if (plat === 'win32') {
    const appData = env.APPDATA?.trim() || join(home, 'AppData', 'Roaming');
    candidates.push(join(appData, 'goose', 'sessions', 'sessions.db'));
  } else {
    const xdg = env.XDG_DATA_HOME?.trim() || join(home, '.local', 'share');
    candidates.push(
      join(xdg, 'goose', 'sessions', 'sessions.db'),
      join(xdg, 'Block', 'goose', 'sessions', 'sessions.db'),
    );
  }

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0] ?? null;
}

export function parseGooseModelName(modelConfigJson: unknown): string | null {
  if (typeof modelConfigJson !== 'string' || !modelConfigJson.trim()) return null;
  try {
    const obj = JSON.parse(modelConfigJson) as { model_name?: unknown };
    if (obj && typeof obj.model_name === 'string') {
      const trimmed = obj.model_name.trim();
      return trimmed || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Goose created_at → ISO 8601 (naive UTC before generic Date parse). */
export function parseGooseCreatedAt(s: unknown): string | null {
  if (typeof s !== 'string' || !s.trim()) return null;
  const trimmed = s.trim();
  const dt = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (dt) {
    const d = new Date(Date.UTC(+dt[1]!, +dt[2]! - 1, +dt[3]!, +dt[4]!, +dt[5]!, +dt[6]!));
    return d.toISOString();
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const d = new Date(Date.UTC(+dateOnly[1]!, +dateOnly[2]! - 1, +dateOnly[3]!));
    return d.toISOString();
  }
  const iso = new Date(trimmed);
  if (!Number.isNaN(iso.getTime())) return iso.toISOString();
  return null;
}

function readGooseSessionsFromSqlite(dbPath: string): Record<string, unknown>[] {
  const pragmaRows = queryDbJson(dbPath, 'PRAGMA table_info(sessions)', {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 10_000,
  });
  const columns = new Set(
    pragmaRows.map((row) => row?.name).filter((name): name is string => typeof name === 'string'),
  );
  const optional = (col: string) => (columns.has(col) ? col : `NULL AS ${col}`);
  const sql = `
    SELECT
      id,
      model_config_json,
      ${optional('provider_name')},
      created_at,
      ${optional('total_tokens')},
      ${optional('input_tokens')},
      ${optional('output_tokens')},
      ${optional('accumulated_total_tokens')},
      ${optional('accumulated_input_tokens')},
      ${optional('accumulated_output_tokens')}
    FROM sessions
    WHERE model_config_json IS NOT NULL
      AND TRIM(model_config_json) != ''
  `.trim();
  return queryDbJson(dbPath, sql, { maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });
}

function capSessionTotals(sessionTotals: Record<string, GooseSessionTotals>): void {
  const entries = Object.entries(sessionTotals);
  if (entries.length <= MAX_SESSION_TOTALS) return;
  entries.sort((a, b) => b[1].total - a[1].total);
  for (const k of Object.keys(sessionTotals)) delete sessionTotals[k];
  for (const [id, totals] of entries.slice(0, MAX_SESSION_TOTALS)) {
    sessionTotals[id] = totals;
  }
}

function parseGooseRows(
  rows: Record<string, unknown>[],
  sinceMs: number,
  sessionTotals: Record<string, GooseSessionTotals>,
  bucketState: BucketAccumulator,
): number {
  let eventsParsed = 0;

  for (const row of rows) {
    if (!row || typeof row.id !== 'string') continue;

    const model = parseGooseModelName(row.model_config_json);
    if (!model) continue;

    const totalNow = Math.max(
      0,
      Number(row.accumulated_total_tokens ?? row.total_tokens ?? 0) || 0,
    );
    const inputNow = Math.max(
      0,
      Number(row.accumulated_input_tokens ?? row.input_tokens ?? 0) || 0,
    );
    const outputNow = Math.max(
      0,
      Number(row.accumulated_output_tokens ?? row.output_tokens ?? 0) || 0,
    );
    if (totalNow === 0 && inputNow === 0 && outputNow === 0) continue;

    const prev = sessionTotals[row.id] ?? { input: 0, output: 0, total: 0 };
    const isReset = totalNow > 0 && totalNow < prev.total;
    const dInput = isReset ? inputNow : Math.max(0, inputNow - prev.input);
    const dOutput = isReset ? outputNow : Math.max(0, outputNow - prev.output);
    const dTotal = isReset ? totalNow : Math.max(0, totalNow - prev.total);

    if (dInput === 0 && dOutput === 0 && dTotal === 0) {
      if (prev.input !== inputNow || prev.output !== outputNow || prev.total !== totalNow) {
        sessionTotals[row.id] = { input: inputNow, output: outputNow, total: totalNow };
      }
      continue;
    }

    const accountedDelta = dInput + dOutput;
    const reasoningDelta = Math.max(0, dTotal - accountedDelta);

    const tsIso = parseGooseCreatedAt(row.created_at) || new Date().toISOString();
    const hourStart = toUtcHalfHourStart(tsIso);
    if (!hourStart || new Date(hourStart).getTime() < sinceMs) {
      sessionTotals[row.id] = { input: inputNow, output: outputNow, total: totalNow };
      continue;
    }

    const deltaBody = {
      input_tokens: dInput,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: dOutput,
      reasoning_output_tokens: reasoningDelta,
    };
    const delta: TokenTotals = {
      ...deltaBody,
      total_tokens: computeTotalTokens(deltaBody),
      conversation_count: 1,
    };

    accumulateBucket(bucketState, 'goose', model, 'unknown', hourStart, delta, GOOSE_COLLECTOR);
    sessionTotals[row.id] = { input: inputNow, output: outputNow, total: totalNow };
    eventsParsed += 1;
  }

  return eventsParsed;
}

export interface ParseGooseResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parseGooseIncremental(
  cursors: CursorsFile,
  statsSince: string,
): Promise<{ result: ParseGooseResult; cursors: CursorsFile }> {
  const sinceMs = new Date(statsSince).getTime();
  if (!cursors.goose) cursors.goose = {};
  if (!cursors.goose.sessionTotals) cursors.goose.sessionTotals = {};
  const sessionTotals = cursors.goose.sessionTotals as Record<string, GooseSessionTotals>;

  const resolvedDb = gooseDbPath();
  if (!resolvedDb) {
    cursors.goose.updatedAt = new Date().toISOString();
    return { result: { buckets: [], eventsParsed: 0, filesProcessed: 0 }, cursors };
  }

  const cursorDbMtime = Number.isFinite(cursors.goose.lastDbMtimeMs)
    ? cursors.goose.lastDbMtimeMs!
    : 0;
  let currentMtime = 0;
  try {
    currentMtime = statSync(resolvedDb).mtimeMs;
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      cursors.goose.updatedAt = new Date().toISOString();
      return { result: { buckets: [], eventsParsed: 0, filesProcessed: 0 }, cursors };
    }
    throw err;
  }

  if (currentMtime > 0 && currentMtime === cursorDbMtime) {
    cursors.goose.updatedAt = new Date().toISOString();
    return {
      result: { buckets: [], eventsParsed: 0, filesProcessed: 0, skipped: true },
      cursors,
    };
  }

  const bucketState: BucketAccumulator = new Map();
  let eventsParsed = 0;
  let filesProcessed = 0;

  try {
    const rows = readSqliteWithSnapshot(resolvedDb, (snap) => readGooseSessionsFromSqlite(snap));
    filesProcessed = rows.length > 0 ? 1 : 0;
    eventsParsed = parseGooseRows(rows, sinceMs, sessionTotals, bucketState);
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

  capSessionTotals(sessionTotals);
  cursors.goose.lastDbMtimeMs = currentMtime;
  cursors.goose.updatedAt = new Date().toISOString();

  return {
    result: {
      buckets: bucketsFromState(bucketState, 'goose'),
      eventsParsed,
      filesProcessed,
    },
    cursors,
  };
}
