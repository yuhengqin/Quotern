/**
 * Kiro CLI passive reader (source `kiro`, collector `kiro-cli`).
 *
 * MVP scope: official CLI only — `~/.kiro/sessions/cli/*.jsonl` (character-estimate
 * billing on assistant turns) plus optional SQLite when explicit token counts exist.
 * Kiro IDE legacy (`kiro.kiroagent` devdata) is intentionally out of MVP scope.
 *
 * Path helpers to add in ../paths.ts:
 *   - kiroHome() / kiroCliSessionsDir() — `KIRO_HOME`, `KIRO_CLI_SESSIONS_DIR`
 *   - kiroCliDbPath() — macOS Application Support, Win APPDATA, Linux XDG
 */
import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir, platform } from 'node:os';
import { basename, join } from 'node:path';
import { stat } from 'node:fs/promises';

import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import { resolveProjectName } from '../project-name.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import {
  accumulateBucket,
  bucketsFromState,
  computeTotalTokens,
  type BucketAccumulator,
} from './shared.js';
import { estimateAntigravityTokens } from './antigravity.js';
import { queryDbJson, readSqliteWithSnapshot } from './sqlite.js';

export const KIRO_COLLECTOR_CLI = 'kiro-cli';

const NON_TEXT_KEYS = new Set([
  'signature',
  'redactedContent',
  'toolUseId',
  'modelId',
  'message_id',
  'format',
  'id',
]);

type KiroExtCursors = CursorsFile & {
  kiro?: {
    seenHashes?: string[];
    files?: Record<string, { inode: number; size: number; mtimeMs: number }>;
  };
};

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export function kiroHome(): string {
  const env = process.env.KIRO_HOME?.trim();
  return env ? expandHome(env) : join(homedir(), '.kiro');
}

export function kiroCliSessionsDir(): string {
  const env = process.env.KIRO_CLI_SESSIONS_DIR?.trim();
  if (env) return expandHome(env);
  return join(kiroHome(), 'sessions', 'cli');
}

export function kiroCliDbPath(): string {
  const explicit = process.env.KIRO_CLI_DB_PATH?.trim();
  if (explicit) return expandHome(explicit);
  const plat = platform();
  if (plat === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'kiro-cli', 'data.sqlite3');
  }
  if (plat === 'win32') {
    const appData = process.env.APPDATA?.trim() || join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'kiro-cli', 'data.sqlite3');
  }
  const xdg = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share');
  return join(xdg, 'kiro-cli', 'data.sqlite3');
}

function estTokens(value: unknown): number {
  if (typeof value === 'string') return estimateAntigravityTokens(value);
  if (Array.isArray(value)) {
    let n = 0;
    for (const v of value) n += estTokens(v);
    return n;
  }
  if (value && typeof value === 'object') {
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (NON_TEXT_KEYS.has(k)) continue;
      n += estTokens(v);
    }
    return n;
  }
  return 0;
}

export function canonicalizeKiroModel(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return 'kiro-cli-agent';
  let name = raw.trim().toLowerCase();
  if (!name || name === 'auto') return 'kiro-cli-agent';
  name = name.replace(
    /^(?:arn:aws:bedrock:[^:]*:[^:]*:(?:foundation-model\/)?|anthropic\.|openai\.|aws\.)/,
    '',
  );
  name = name.replace(/:\d+$/, '');
  name = name.replace(/-\d{8}-v\d+$/i, '');
  name = name.replace(/-v\d+$/i, '');
  name = name.replace(/-\d{8}$/, '');
  name = name.replace(/\.v\d+$/i, '');
  return name || 'kiro-cli-agent';
}

function loadCliSessionMeta(sessionsDir: string, sessionId: string): { cwd: string; model: string | null } {
  try {
    const d = JSON.parse(readFileSync(join(sessionsDir, `${sessionId}.json`), 'utf-8')) as {
      cwd?: string;
      session_state?: { rts_model_state?: { model_info?: { model_id?: string } } };
    };
    return {
      cwd: (typeof d.cwd === 'string' && d.cwd) || 'unknown',
      model: d.session_state?.rts_model_state?.model_info?.model_id ?? null,
    };
  } catch {
    return { cwd: 'unknown', model: null };
  }
}

export function cliEventsToEntries(
  events: Array<{ kind?: string; data?: Record<string, unknown> }>,
  opts: { cwd?: string; model?: string | null; fallbackTimestamp?: Date | null } = {},
): Array<{
  requestId: string | null;
  model: string;
  project: string;
  timestamp: Date;
  delta: Omit<TokenTotals, 'conversation_count'>;
}> {
  const entries: Array<{
    requestId: string | null;
    model: string;
    project: string;
    timestamp: Date;
    delta: Omit<TokenTotals, 'conversation_count'>;
  }> = [];
  let curTs: Date | null = null;
  let pendingInput = 0;
  let curModel = opts.model ?? null;
  let turnIndex = 0;

  for (const ev of events) {
    const data = ev.data;
    if (!data || typeof data !== 'object') continue;
    const content = Array.isArray(data.content) ? data.content : [];

    if (ev.kind === 'Prompt') {
      const ts = (data.meta as { timestamp?: number } | undefined)?.timestamp;
      if (typeof ts === 'number' && ts > 0) curTs = new Date(ts * 1000);
      for (const item of content) {
        const row = item as { kind?: string; data?: unknown };
        pendingInput += row?.kind === 'image' ? 1600 : estTokens(row?.data);
      }
    } else if (ev.kind === 'ToolResults') {
      for (const item of content) pendingInput += estTokens((item as { data?: unknown })?.data);
    } else if (ev.kind === 'AssistantMessage') {
      let output = 0;
      let reasoning = 0;
      for (const item of content) {
        const row = item as { kind?: string; data?: Record<string, unknown> };
        const cd = row?.data;
        if (cd && typeof cd.modelId === 'string' && cd.modelId) curModel = cd.modelId;
        if (row?.kind === 'thinking' && cd && typeof cd === 'object') {
          reasoning += estTokens(cd.text);
        } else {
          output += estTokens(cd);
        }
      }

      const inputTokens = pendingInput;
      if (inputTokens > 0 || output > 0 || reasoning > 0) {
        const deltaBody = {
          input_tokens: inputTokens,
          output_tokens: output,
          cached_input_tokens: 0,
          cache_creation_input_tokens: 0,
          reasoning_output_tokens: reasoning,
        };
        entries.push({
          requestId: typeof data.message_id === 'string' ? data.message_id : `turn:${turnIndex}`,
          model: canonicalizeKiroModel(curModel),
          project: opts.cwd ? resolveProjectName(opts.cwd) : 'unknown',
          timestamp: curTs || opts.fallbackTimestamp || new Date(),
          delta: { ...deltaBody, total_tokens: computeTotalTokens(deltaBody) },
        });
      }
      pendingInput = 0;
      turnIndex += 1;
    } else if (ev.kind === 'Compaction') {
      pendingInput = 0;
    }
  }

  return entries;
}

async function parseKiroJsonlFile(opts: {
  filePath: string;
  sinceMs: number;
  seenHashes: Set<string>;
  fileCursors: Record<string, { inode: number; size: number; mtimeMs: number }>;
  bucketState: BucketAccumulator;
}): Promise<{ eventsParsed: number; filesProcessed: number }> {
  const { filePath, sinceMs, seenHashes, fileCursors, bucketState } = opts;
  const st = await stat(filePath).catch(() => null);
  if (!st?.isFile()) return { eventsParsed: 0, filesProcessed: 0 };

  const prev = fileCursors[filePath];
  if (prev && prev.inode === st.ino && prev.size === st.size && prev.mtimeMs === st.mtimeMs) {
    return { eventsParsed: 0, filesProcessed: 0 };
  }

  const sessionsDir = join(filePath, '..');
  const sessionId = basename(filePath, '.jsonl');
  const meta = loadCliSessionMeta(sessionsDir, sessionId);

  const events: Array<{ kind?: string; data?: Record<string, unknown> }> = [];
  const stream = createReadStream(filePath);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as { kind?: string; data?: Record<string, unknown> });
    } catch {
      continue;
    }
  }

  let eventsParsed = 0;
  for (const entry of cliEventsToEntries(events, {
    cwd: meta.cwd,
    model: meta.model,
    fallbackTimestamp: st.mtime,
  })) {
    const dedup = entry.requestId ? `${sessionId}:${entry.requestId}` : null;
    if (dedup && seenHashes.has(dedup)) continue;

    const hourStart = toUtcHalfHourStart(entry.timestamp.toISOString());
    if (!hourStart || new Date(hourStart).getTime() < sinceMs) continue;

    accumulateBucket(
      bucketState,
      'kiro',
      entry.model,
      entry.project,
      hourStart,
      { ...entry.delta, conversation_count: 1 },
      KIRO_COLLECTOR_CLI,
    );
    if (dedup) seenHashes.add(dedup);
    eventsParsed += 1;
  }

  fileCursors[filePath] = { inode: st.ino, size: st.size, mtimeMs: st.mtimeMs };
  return { eventsParsed, filesProcessed: 1 };
}

function parseKiroSqlite(
  dbPath: string,
  sinceMs: number,
  seenHashes: Set<string>,
  bucketState: BucketAccumulator,
): { eventsParsed: number; filesProcessed: number } {
  if (!existsSync(dbPath)) return { eventsParsed: 0, filesProcessed: 0 };

  const sqlV2 = `
    SELECT
      conversation_id,
      json_extract(value, '$.model_info.model_id') AS session_model_id,
      json_extract(value, '$.user_turn_metadata.requests') AS requests_json
    FROM conversations_v2
    WHERE json_extract(value, '$.user_turn_metadata.requests') IS NOT NULL
  `;

  let rows: Record<string, unknown>[] = [];
  try {
    rows = readSqliteWithSnapshot(dbPath, (snap) => queryDbJson(snap, sqlV2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ENOENT|sqlite3 CLI not found|no such table/i.test(msg)) {
      return { eventsParsed: 0, filesProcessed: 0 };
    }
    throw err;
  }

  let eventsParsed = 0;
  for (const row of rows) {
    let requests: Array<Record<string, unknown>>;
    try {
      requests = JSON.parse(String(row.requests_json || '[]')) as Array<Record<string, unknown>>;
    } catch {
      continue;
    }
    if (!Array.isArray(requests)) continue;
    const sessionModel = typeof row.session_model_id === 'string' ? row.session_model_id : null;
    const convId = typeof row.conversation_id === 'string' ? row.conversation_id : 'unknown';

    for (const r of requests) {
      const requestId = typeof r.request_id === 'string' ? r.request_id : null;
      if (!requestId || seenHashes.has(requestId)) continue;

      const inputRaw = Number(r.input_token_count);
      const outputRaw = Number(r.output_token_count);
      let input = Number.isFinite(inputRaw) && inputRaw > 0 ? Math.floor(inputRaw) : 0;
      let output = Number.isFinite(outputRaw) && outputRaw > 0 ? Math.floor(outputRaw) : 0;

      if (input === 0 && output === 0) {
        const promptLen = Math.max(0, Number(r.user_prompt_length) || 0);
        const respLen = Math.max(0, Number(r.response_size) || 0);
        input = Math.floor(promptLen / 4);
        output = Math.floor(respLen / 4);
      }
      if (input === 0 && output === 0) continue;

      const tsMs = Number(r.request_start_timestamp_ms);
      if (!Number.isFinite(tsMs) || tsMs <= 0) continue;
      const hourStart = toUtcHalfHourStart(new Date(tsMs).toISOString());
      if (!hourStart || new Date(hourStart).getTime() < sinceMs) continue;

      const deltaBody = {
        input_tokens: input,
        output_tokens: output,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
      };
      const model = canonicalizeKiroModel(
        (typeof r.model_id === 'string' && r.model_id) || sessionModel,
      );

      accumulateBucket(
        bucketState,
        'kiro',
        model,
        convId,
        hourStart,
        { ...deltaBody, total_tokens: computeTotalTokens(deltaBody), conversation_count: 1 },
        KIRO_COLLECTOR_CLI,
      );
      seenHashes.add(requestId);
      eventsParsed += 1;
    }
  }

  return { eventsParsed, filesProcessed: rows.length > 0 ? 1 : 0 };
}

export interface ParseKiroResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parseKiroIncremental(
  cursors: CursorsFile,
  statsSince: string,
): Promise<{ result: ParseKiroResult; cursors: CursorsFile }> {
  const sinceMs = new Date(statsSince).getTime();
  const ext = cursors as KiroExtCursors;
  if (!ext.kiro) ext.kiro = { seenHashes: [], files: {} };
  if (!ext.kiro.files) ext.kiro.files = {};
  const seenHashes = new Set(ext.kiro.seenHashes ?? []);
  const fileCursors = ext.kiro.files;
  const bucketState: BucketAccumulator = new Map();

  let eventsParsed = 0;
  let filesProcessed = 0;

  const sessionsDir = kiroCliSessionsDir();
  if (existsSync(sessionsDir)) {
    let names: string[];
    try {
      names = readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      names = [];
    }
    for (const name of names) {
      const parsed = await parseKiroJsonlFile({
        filePath: join(sessionsDir, name),
        sinceMs,
        seenHashes,
        fileCursors,
        bucketState,
      });
      eventsParsed += parsed.eventsParsed;
      filesProcessed += parsed.filesProcessed;
    }
  }

  try {
    const sqlite = parseKiroSqlite(kiroCliDbPath(), sinceMs, seenHashes, bucketState);
    eventsParsed += sqlite.eventsParsed;
    filesProcessed += sqlite.filesProcessed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/sqlite3 CLI not found/i.test(msg)) {
      return {
        result: {
          buckets: bucketsFromState(bucketState, 'kiro'),
          eventsParsed,
          filesProcessed,
          skipped: filesProcessed === 0 && eventsParsed === 0,
          error: msg,
        },
        cursors,
      };
    }
  }

  ext.kiro.seenHashes = Array.from(seenHashes).slice(-50_000);

  return {
    result: {
      buckets: bucketsFromState(bucketState, 'kiro'),
      eventsParsed,
      filesProcessed,
    },
    cursors,
  };
}
