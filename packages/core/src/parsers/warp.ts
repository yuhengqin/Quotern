/**
 * Warp Agent Mode passive reader — source `warp`, collector `warp`.
 *
 * Local SQLite (`warp.sqlite`) stores cumulative per-conversation token totals
 * in `agent_conversations.conversation_data`. There is no input/output/cache
 * split; warp_tokens + byok_tokens are recorded as input_tokens.
 */
import { existsSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import { resolveProjectName } from '../project-name.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import {
  accumulateBucket,
  bucketsFromState,
  computeTotalTokens,
  type BucketAccumulator,
} from './shared.js';
import { queryDbJson, readSqliteWithSnapshot, sqliteTableExists } from './sqlite.js';

export const WARP_COLLECTOR = 'warp';

const MAX_CONVERSATION_TOTALS = 10_000;

type WarpConversationTotals = { tokens: number };

interface WarpTokenUsage {
  model_id?: unknown;
  warp_tokens?: unknown;
  byok_tokens?: unknown;
}

interface WarpConversationData {
  conversation_usage_metadata?: {
    token_usage?: WarpTokenUsage[];
  };
}

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}

/** Candidate Warp sqlite paths (may not exist). Env override wins. */
export function warpDbPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = env.AI_USAGE_WARP_DB?.trim();
  if (explicit) return [expandHome(explicit)];

  const home = env.HOME?.trim() || homedir();
  const plat = platform();
  if (plat === 'darwin') {
    const group = join(
      home,
      'Library',
      'Group Containers',
      '2BBY89MBSN.dev.warp',
      'Library',
      'Application Support',
    );
    return [
      join(group, 'dev.warp.Warp-Stable', 'warp.sqlite'),
      join(group, 'dev.warp.Warp-Preview', 'warp.sqlite'),
    ];
  }
  if (plat === 'win32') {
    const local = env.LOCALAPPDATA?.trim() || join(home, 'AppData', 'Local');
    return [join(local, 'warp', 'Warp', 'data', 'warp.sqlite')];
  }
  const xdg = env.XDG_STATE_HOME?.trim() || join(home, '.local', 'state');
  return [join(xdg, 'warp-terminal', 'warp.sqlite')];
}

export function existingWarpDbPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  return warpDbPaths(env).filter((p) => existsSync(p));
}

export function parseWarpTimestamp(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    const ms = raw > 1e11 ? raw : raw * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const trimmed = raw.trim();
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && asNumber > 0) return parseWarpTimestamp(asNumber);
  const naive = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(trimmed);
  if (naive && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const d = new Date(
      Date.UTC(+naive[1]!, +naive[2]! - 1, +naive[3]!, +naive[4]!, +naive[5]!, +naive[6]!),
    );
    return d.toISOString();
  }
  const iso = new Date(trimmed);
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}

export function parseWarpConversationData(raw: unknown): WarpConversationData | null {
  if (raw && typeof raw === 'object') return raw as WarpConversationData;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return JSON.parse(raw) as WarpConversationData;
  } catch {
    return null;
  }
}

export function warpModelTokens(entry: WarpTokenUsage): { model: string; tokens: number } | null {
  const model = typeof entry.model_id === 'string' ? entry.model_id.trim() : '';
  if (!model) return null;
  const tokens = Math.max(0, toCount(entry.warp_tokens) + toCount(entry.byok_tokens));
  if (tokens === 0) return null;
  return { model, tokens };
}

function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function conversationKey(conversationId: string, model: string): string {
  return `${conversationId}|${model}`;
}

function capConversationTotals(totals: Record<string, WarpConversationTotals>): void {
  const entries = Object.entries(totals);
  if (entries.length <= MAX_CONVERSATION_TOTALS) return;
  entries.sort((a, b) => b[1].tokens - a[1].tokens);
  for (const k of Object.keys(totals)) delete totals[k];
  for (const [id, value] of entries.slice(0, MAX_CONVERSATION_TOTALS)) {
    totals[id] = value;
  }
}

function readWarpRows(dbPath: string): Record<string, unknown>[] {
  if (!sqliteTableExists(dbPath, 'agent_conversations')) return [];
  const hasQueries = sqliteTableExists(dbPath, 'ai_queries');
  if (hasQueries) {
    return queryDbJson(
      dbPath,
      `
        SELECT
          ac.conversation_id AS conversation_id,
          ac.conversation_data AS conversation_data,
          ac.last_modified_at AS last_modified_at,
          (SELECT MAX(q.start_ts) FROM ai_queries q WHERE q.conversation_id = ac.conversation_id)
            AS last_query_ts,
          (SELECT q.working_directory FROM ai_queries q
            WHERE q.conversation_id = ac.conversation_id
            ORDER BY q.start_ts DESC LIMIT 1) AS working_directory
        FROM agent_conversations ac
      `.trim(),
      { maxBuffer: 64 * 1024 * 1024, timeout: 60_000 },
    );
  }
  return queryDbJson(
    dbPath,
    `
      SELECT
        conversation_id,
        conversation_data,
        last_modified_at,
        NULL AS last_query_ts,
        NULL AS working_directory
      FROM agent_conversations
    `.trim(),
    { maxBuffer: 64 * 1024 * 1024, timeout: 60_000 },
  );
}

function parseWarpRows(
  rows: Record<string, unknown>[],
  sinceMs: number,
  conversationTotals: Record<string, WarpConversationTotals>,
  bucketState: BucketAccumulator,
): number {
  let eventsParsed = 0;

  for (const row of rows) {
    if (!row || typeof row.conversation_id !== 'string' || !row.conversation_id.trim()) continue;
    const conversationId = row.conversation_id.trim();
    const data = parseWarpConversationData(row.conversation_data);
    const usages = data?.conversation_usage_metadata?.token_usage;
    if (!Array.isArray(usages) || usages.length === 0) continue;

    const tsIso =
      parseWarpTimestamp(row.last_query_ts) ||
      parseWarpTimestamp(row.last_modified_at);
    const hourStart = tsIso ? toUtcHalfHourStart(tsIso) : null;
    const inWindow = Boolean(hourStart && new Date(hourStart).getTime() >= sinceMs);

    const cwd = typeof row.working_directory === 'string' ? row.working_directory.trim() : '';
    const project = cwd ? resolveProjectName(cwd) : 'unknown';

    for (const entry of usages) {
      const parsed = warpModelTokens(entry);
      if (!parsed) continue;
      const key = conversationKey(conversationId, parsed.model);
      const prevTokens = conversationTotals[key]?.tokens ?? 0;
      const isReset = parsed.tokens > 0 && parsed.tokens < prevTokens;
      const deltaTokens = isReset ? parsed.tokens : Math.max(0, parsed.tokens - prevTokens);
      conversationTotals[key] = { tokens: parsed.tokens };
      if (deltaTokens === 0 || !inWindow || !hourStart) continue;

      const body = {
        input_tokens: deltaTokens,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
      };
      const delta: TokenTotals = {
        ...body,
        total_tokens: computeTotalTokens(body),
        conversation_count: prevTokens === 0 || isReset ? 1 : 0,
      };
      accumulateBucket(bucketState, 'warp', parsed.model, project, hourStart, delta, WARP_COLLECTOR);
      eventsParsed += 1;
    }
  }

  return eventsParsed;
}

export interface ParseWarpResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parseWarpIncremental(
  cursors: CursorsFile,
  statsSince: string,
): Promise<{ result: ParseWarpResult; cursors: CursorsFile }> {
  const sinceMs = new Date(statsSince).getTime();
  if (!cursors.warp) cursors.warp = {};
  if (!cursors.warp.conversationTotals) cursors.warp.conversationTotals = {};
  if (!cursors.warp.dbMtimes) cursors.warp.dbMtimes = {};
  const conversationTotals = cursors.warp.conversationTotals;
  const dbMtimes = cursors.warp.dbMtimes;

  const dbs = existingWarpDbPaths();
  if (dbs.length === 0) {
    cursors.warp.updatedAt = new Date().toISOString();
    return { result: { buckets: [], eventsParsed: 0, filesProcessed: 0 }, cursors };
  }

  const bucketState: BucketAccumulator = new Map();
  let eventsParsed = 0;
  let filesProcessed = 0;
  let anyRead = false;

  try {
    for (const dbPath of dbs) {
      let currentMtime = 0;
      try {
        currentMtime = statSync(dbPath).mtimeMs;
      } catch (err) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        throw err;
      }
      if (currentMtime > 0 && currentMtime === dbMtimes[dbPath]) continue;

      const rows = readSqliteWithSnapshot(dbPath, (snap) => readWarpRows(snap));
      anyRead = true;
      filesProcessed += 1;
      eventsParsed += parseWarpRows(rows, sinceMs, conversationTotals, bucketState);
      dbMtimes[dbPath] = currentMtime;
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

  if (!anyRead) {
    cursors.warp.updatedAt = new Date().toISOString();
    return {
      result: { buckets: [], eventsParsed: 0, filesProcessed: 0, skipped: true },
      cursors,
    };
  }

  capConversationTotals(conversationTotals);
  cursors.warp.updatedAt = new Date().toISOString();

  return {
    result: {
      buckets: bucketsFromState(bucketState, 'warp'),
      eventsParsed,
      filesProcessed,
    },
    cursors,
  };
}
