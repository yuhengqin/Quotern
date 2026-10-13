/**
 * CodeBuddy passive reader (source `codebuddy`, collector `codebuddy`).
 *
 * Two channels feed the same source:
 *  1. CLI JSONL — ~/.codebuddy/projects/ (recursive .jsonl), assistant
 *     messages with providerData.rawUsage.
 *  2. App / editor extension history — <CodeBuddyExtension>/Data/<userId>/
 *     <host>/<userId>/history/<workspace>/<session>/messages/*.json, assistant
 *     messages carrying extra.lastStep*Tokens. This is what the CodeBuddy
 *     desktop app (CodeBuddy CN) and the VSCode / Cursor plugin actually
 *     write; the CLI channel alone never sees them.
 *     Project names come from (1) desktop codebuddy-sessions.vscdb,
 *     (2) editor genie-history/<base64(cwd)> keyed by session or md5(cwd),
 *     (3) base64 path segment above history/ on anonymous trees.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createJsonlLineReader } from './jsonl-tail.js';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { stat } from 'node:fs/promises';

import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import { resolveProjectName } from '../project-name.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import {
  accumulateBucket,
  bucketsFromState,
  computeTotalTokens,
  splitRootsEnv,
  type BucketAccumulator,
} from './shared.js';
import { queryDbJson, readSqliteWithSnapshot, sqliteTableExists } from './sqlite.js';
import { vscodeHostRoots } from './roocode.js';

export const CODEBUDDY_COLLECTOR = 'codebuddy';

type CodebuddyExtCursors = CursorsFile & {
  codebuddy?: {
    seenIds?: string[];
    fileOffsets?: Record<string, { size: number; mtimeMs: number; ino: number }>;
    extSeenIds?: string[];
    extFileMtimes?: Record<string, number>;
  };
};

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export function resolveCodebuddyHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CODEBUDDY_HOME?.trim();
  if (override) return expandHome(override);
  return join(homedir(), '.codebuddy');
}

export function resolveCodebuddyDefaultModel(env: NodeJS.ProcessEnv = process.env): string {
  const fallback = 'codebuddy-unknown';
  try {
    const home = resolveCodebuddyHome(env);
    const raw = readFileSync(join(home, 'settings.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { model?: unknown };
    if (typeof parsed.model === 'string' && parsed.model.trim()) return parsed.model.trim();
  } catch {
    // settings missing or malformed
  }
  return fallback;
}

function walkJsonlFiles(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (!isDir && !isFile) {
      try {
        const st = statSync(full);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch {
        continue;
      }
    }
    if (isDir) walkJsonlFiles(full, out);
    else if (isFile && entry.name.endsWith('.jsonl')) out.push(full);
  }
}

export function resolveCodebuddyProjectFiles(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = resolveCodebuddyHome(env);
  const files: string[] = [];
  const projectsDir = join(home, 'projects');
  if (existsSync(projectsDir)) walkJsonlFiles(projectsDir, files);
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

/** Directory name holding the App / editor extension data on every platform. */
const CODEBUDDY_EXTENSION_DIR = 'CodeBuddyExtension';

/** Desktop app dir name whose `codebuddy-sessions.vscdb` maps session → cwd. */
const CODEBUDDY_APP_DIR = 'CodeBuddy CN';
const CODEBUDDY_APP_SESSIONS_DB = 'codebuddy-sessions.vscdb';

/** How deep to look for a `history` dir under the extension root. */
const EXT_HISTORY_SEARCH_DEPTH = 6;

function readDirEntries(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Roots of the App / editor extension data dir:
 * `<root>/<userId>/<host>/<userId>/history/...`
 *
 * Override with `CODEBUDDY_EXTENSION_ROOTS` (`:`, `;` or `,` separated).
 */
export function resolveCodebuddyExtensionRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = env.CODEBUDDY_EXTENSION_ROOTS?.trim();
  if (override) return splitRootsEnv(override);

  const home = homedir();
  const plat = process.platform;
  if (plat === 'darwin') {
    return [join(home, 'Library', 'Application Support', CODEBUDDY_EXTENSION_DIR, 'Data')];
  }
  if (plat === 'win32') {
    const appData = env.APPDATA || join(home, 'AppData', 'Roaming');
    const localAppData = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return [
      join(appData, CODEBUDDY_EXTENSION_DIR, 'Data'),
      join(localAppData, CODEBUDDY_EXTENSION_DIR, 'Data'),
    ];
  }
  const dataHome = env.XDG_DATA_HOME || join(home, '.local', 'share');
  const configHome = env.XDG_CONFIG_HOME || join(home, '.config');
  return [
    join(dataHome, CODEBUDDY_EXTENSION_DIR, 'Data'),
    join(configHome, CODEBUDDY_EXTENSION_DIR, 'Data'),
  ];
}

/**
 * `codebuddy-sessions.vscdb` of the desktop app: `session:<id>` rows hold the
 * session cwd, which is the only place a project name can come from — the
 * extension history keys workspaces by md5.
 */
export function resolveCodebuddyAppSessionsDb(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CODEBUDDY_APP_SESSIONS_DB?.trim();
  if (override) return expandHome(override);
  const home = homedir();
  const plat = process.platform;
  const bases =
    plat === 'darwin'
      ? [join(home, 'Library', 'Application Support')]
      : plat === 'win32'
        ? [env.APPDATA || join(home, 'AppData', 'Roaming'), env.LOCALAPPDATA || join(home, 'AppData', 'Local')]
        : [env.XDG_CONFIG_HOME || join(home, '.config')];
  // `CodeBuddy CN` is the domestic app dir; probe the plain name too so an
  // international build still resolves on unverified platforms.
  for (const base of bases) {
    for (const dirName of [CODEBUDDY_APP_DIR, 'CodeBuddy']) {
      const candidate = join(base, dirName, CODEBUDDY_APP_SESSIONS_DB);
      if (existsSync(candidate)) return candidate;
    }
  }
  return join(bases[0]!, CODEBUDDY_APP_DIR, CODEBUDDY_APP_SESSIONS_DB);
}

export interface CodebuddyExtensionMessageFile {
  /** Absolute path of the message json. */
  file: string;
  /** `CodeBuddyIDE` (desktop app) or `VSCode` (VSCode / Cursor plugin). */
  host: string;
  /** Conversation id = the parent dir name of `messages/`. */
  sessionId: string;
  /** Workspace folder under `history/` — md5 hex of the absolute cwd when known. */
  workspaceId: string;
  /**
   * Absolute cwd decoded from the directory above `history/` when that name is
   * base64(path). Anonymous/`default` trees use this; logged-in trees usually
   * put the user id there instead (then `pathHint` is null).
   */
  pathHint: string | null;
}

/** VS Code / Cursor plugin id that owns `genie-history/<base64(cwd)>/`. */
const CODEBUDDY_PLUGIN_STORAGE = join(
  'User',
  'globalStorage',
  'tencent-cloud.coding-copilot',
  'genie-history',
);

/**
 * Decode a directory segment that stores an absolute workspace path as
 * standard or URL-safe base64. Returns null for user ids, host names, etc.
 */
export function tryDecodeCodebuddyBase64Path(segment: string): string | null {
  const trimmed = segment.trim();
  if (trimmed.length < 8) return null;
  // Logged-in trees put the account UUID above `history/` — skip early.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return null;
  }
  for (const encoding of ['base64url', 'base64'] as const) {
    let decoded: string;
    try {
      decoded = Buffer.from(trimmed, encoding).toString('utf8');
    } catch {
      continue;
    }
    if (!decoded || /[\u0000-\u0008\u000e-\u001f]/.test(decoded)) continue;
    const path = decoded.replace(/[\\/]+$/, '');
    if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return path;
  }
  return null;
}

function md5Hex(value: string): string {
  return createHash('md5').update(value, 'utf8').digest('hex');
}

function findHistoryDirs(dir: string, depth: number, out: string[]): void {
  if (depth > EXT_HISTORY_SEARCH_DEPTH) return;
  for (const entry of readDirEntries(dir)) {
    if (!entry.isDirectory()) continue;
    const full = join(dir, entry.name);
    if (entry.name === 'history') out.push(full);
    else findHistoryDirs(full, depth + 1, out);
  }
}

/**
 * Enumerate `<...>/history/<workspace>/<session>/messages/*.json`.
 *
 * Enumeration is host-agnostic: any `history` dir under the extension root
 * counts, so new hosts (JetBrains, …) are picked up without a code change.
 */
export function resolveCodebuddyExtensionMessageFiles(
  env: NodeJS.ProcessEnv = process.env,
): CodebuddyExtensionMessageFile[] {
  const out: CodebuddyExtensionMessageFile[] = [];
  for (const root of resolveCodebuddyExtensionRoots(env)) {
    if (!existsSync(root)) continue;
    const historyDirs: string[] = [];
    findHistoryDirs(root, 0, historyDirs);
    for (const historyDir of historyDirs) {
      // `<root>/<userId>/<host>/<userId>/history` — the host name sits two
      // levels above `history` because the user id is duplicated.
      // Anonymous trees look like `<root>/default/<host>/<base64(cwd)>/history`.
      const host = basename(dirname(dirname(historyDir))) || basename(dirname(historyDir)) || 'unknown';
      const pathHint = tryDecodeCodebuddyBase64Path(basename(dirname(historyDir)));
      for (const workspace of readDirEntries(historyDir)) {
        if (!workspace.isDirectory()) continue;
        const workspacePath = join(historyDir, workspace.name);
        for (const session of readDirEntries(workspacePath)) {
          if (!session.isDirectory()) continue;
          const messagesDir = join(workspacePath, session.name, 'messages');
          for (const file of readDirEntries(messagesDir)) {
            if (!file.isFile() || !file.name.endsWith('.json')) continue;
            out.push({
              file: join(messagesDir, file.name),
              host,
              sessionId: session.name,
              workspaceId: workspace.name,
              pathHint,
            });
          }
        }
      }
    }
  }
  out.sort((a, b) => a.file.localeCompare(b.file));
  return out;
}

/**
 * Roots of the editor plugin's `genie-history` dirs (Cursor / VS Code / …).
 * Override with `CODEBUDDY_GENIE_HISTORY_ROOTS`.
 */
export function resolveCodebuddyGenieHistoryRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = env.CODEBUDDY_GENIE_HISTORY_ROOTS?.trim();
  if (override) return splitRootsEnv(override);
  const out: string[] = [];
  for (const hostRoot of vscodeHostRoots()) {
    const candidate = join(hostRoot, CODEBUDDY_PLUGIN_STORAGE);
    if (existsSync(candidate)) out.push(candidate);
  }
  return out;
}

/**
 * Plugin-side cwd maps from `genie-history/<base64(cwd)>/conversations/<sessionId>/`.
 *
 * Desktop `codebuddy-sessions.vscdb` only covers the App; the VS Code / Cursor
 * plugin writes session → workspace here instead. `workspaceCwds` keys are
 * `md5(cwd)` — the same id used as the folder under extension `history/`.
 */
export function loadCodebuddyEditorWorkspaceMaps(
  env: NodeJS.ProcessEnv = process.env,
): { sessionCwds: Map<string, string>; workspaceCwds: Map<string, string> } {
  const sessionCwds = new Map<string, string>();
  const workspaceCwds = new Map<string, string>();
  for (const gh of resolveCodebuddyGenieHistoryRoots(env)) {
    for (const entry of readDirEntries(gh)) {
      if (!entry.isDirectory()) continue;
      const cwd = tryDecodeCodebuddyBase64Path(entry.name);
      if (!cwd) continue;
      workspaceCwds.set(md5Hex(cwd), cwd);
      const base = join(gh, entry.name);
      for (const conv of readDirEntries(join(base, 'conversations'))) {
        if (conv.isDirectory() && conv.name) sessionCwds.set(conv.name, cwd);
      }
      try {
        const current = JSON.parse(readFileSync(join(base, 'current.json'), 'utf-8')) as {
          conversationId?: unknown;
        };
        if (typeof current.conversationId === 'string' && current.conversationId) {
          sessionCwds.set(current.conversationId, cwd);
        }
      } catch {
        // optional pointer file
      }
    }
  }
  return { sessionCwds, workspaceCwds };
}

interface CodebuddyExtensionMessage {
  id: string | null;
  role: string | null;
  createdAt: string | null;
  extra: Record<string, unknown>;
}

/** Read one history message file; `null` when unreadable. */
export function readCodebuddyExtensionMessage(filePath: string): CodebuddyExtensionMessage | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  // `extra` is a serialized JSON string in the on-disk format.
  let extra: Record<string, unknown> = {};
  if (typeof parsed.extra === 'string') {
    try {
      const decoded = JSON.parse(parsed.extra) as unknown;
      if (decoded && typeof decoded === 'object') extra = decoded as Record<string, unknown>;
    } catch {
      extra = {};
    }
  } else if (parsed.extra && typeof parsed.extra === 'object') {
    extra = parsed.extra as Record<string, unknown>;
  }
  return {
    id: typeof parsed.id === 'string' && parsed.id ? parsed.id : null,
    role: typeof parsed.role === 'string' ? parsed.role : null,
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
    extra,
  };
}

/**
 * Token split from `extra.statsSnapshot` — the preferred source.
 *
 * One assistant message is a whole agent loop: every step (tool call, re-read,
 * rewrite) re-sends the full context, so the real cost of a reply is the sum
 * over all its steps. `statsSnapshot` holds that sum (`inputTokens` already
 * includes `cachedInputTokens`); `lastStep*` only describes the final call and
 * under-reports usage by roughly 7x.
 */
function usageFromCodebuddySnapshot(
  snapshot: Record<string, unknown>,
): Omit<TokenTotals, 'conversation_count'> | null {
  const inputTotal = toNonNeg(snapshot.inputTokens);
  const output = toNonNeg(snapshot.outputTokens);
  const cached = toNonNeg(snapshot.cachedInputTokens);
  const cacheWrite = toNonNeg(snapshot.cacheWriteTokens);
  const reasoning = toNonNeg(snapshot.thinkingTokens);
  if (inputTotal === 0 && output === 0 && cached === 0 && cacheWrite === 0) return null;

  // `cacheMissTokens` is the newly billed part of the prompt; older records
  // omit it and it falls back to `input - cached` (same as the CLI channel).
  const cacheMiss = toNonNeg(snapshot.cacheMissTokens) || Math.max(0, inputTotal - cached);
  const body = {
    input_tokens: cacheMiss,
    cached_input_tokens: cached,
    cache_creation_input_tokens: cacheWrite,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
  };
  return { ...body, total_tokens: computeTotalTokens(body) };
}

/**
 * Token split for the extension channel.
 *
 * Prefers `statsSnapshot` (whole-loop total, what the CodeBuddy UI shows) and
 * falls back to `lastStep*` for records written before snapshots existed.
 * `lastStepInputTokens` is the prompt size of that step (full context), and
 * `lastStepCachedInputTokens` the cache-hit part of it, so — same as the CLI
 * channel — the billed new input is `input - cached`. Steps without any usage
 * are tool/assistant intermediate states and carry no model call.
 */
function usageFromCodebuddyExtra(
  extra: Record<string, unknown>,
): Omit<TokenTotals, 'conversation_count'> | null {
  const snapshot = extra.statsSnapshot;
  if (snapshot && typeof snapshot === 'object') {
    const fromSnapshot = usageFromCodebuddySnapshot(snapshot as Record<string, unknown>);
    if (fromSnapshot) return fromSnapshot;
  }

  const rawInput = toNonNeg(extra.lastStepInputTokens);
  const rawOutput = toNonNeg(extra.lastStepOutputTokens);
  const cached = toNonNeg(extra.lastStepCachedInputTokens);
  if (rawInput === 0 && rawOutput === 0 && cached === 0) return null;

  const inputTokens = Math.max(0, rawInput - cached);
  const body = {
    input_tokens: inputTokens,
    cached_input_tokens: cached,
    cache_creation_input_tokens: 0,
    output_tokens: rawOutput,
    reasoning_output_tokens: 0,
  };
  return { ...body, total_tokens: computeTotalTokens(body) };
}

/** Empty / non-string cwd stays 'unknown'. */
function projectFromCwd(cwd: unknown): string {
  if (typeof cwd !== 'string' || !cwd.trim()) return 'unknown';
  return resolveProjectName(cwd.trim());
}

/** `conversationId → cwd` from the desktop app's session store. */
function loadCodebuddyAppSessionCwds(dbPath: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(dbPath)) return map;
  if (!sqliteTableExists(dbPath, 'ItemTable')) return map;
  try {
    const rows = readSqliteWithSnapshot(dbPath, (snap) =>
      queryDbJson(snap, "SELECT key, value FROM ItemTable WHERE key LIKE 'session:%'", {
        timeout: 10_000,
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
    for (const row of rows) {
      let value: unknown = row.value;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value) as unknown;
        } catch {
          continue;
        }
      }
      if (!value || typeof value !== 'object') continue;
      const rec = value as Record<string, unknown>;
      const key = typeof row.key === 'string' ? row.key : '';
      const id =
        typeof rec.conversationId === 'string' && rec.conversationId
          ? rec.conversationId
          : key.replace(/^session:/, '');
      const cwd = typeof rec.cwd === 'string' ? rec.cwd.trim() : '';
      if (id && cwd) map.set(id, cwd);
    }
  } catch {
    // Best effort; unresolved sessions stay 'unknown'.
  }
  return map;
}

/** Hard cap on tracked extension message files; the oldest-modified are dropped first. */
const EXT_FILE_MTIMES_CAP = 20_000;

/**
 * The mtime map lives in the shared cursors file (one entry per assistant
 * message file), so it must not grow forever. Evicting an entry is safe: the
 * worst case is the file being re-read on a later run, where `extSeenIds`
 * dedups it — and messages older than the stats window are re-marked seen
 * without being counted again.
 */
function capExtFileMtimes(map: Record<string, number>): Record<string, number> {
  const keys = Object.keys(map);
  if (keys.length <= EXT_FILE_MTIMES_CAP) return map;
  const dropped = keys
    .sort((a, b) => map[a]! - map[b]!)
    .slice(0, keys.length - EXT_FILE_MTIMES_CAP);
  for (const key of dropped) delete map[key];
  return map;
}

function normalizeModel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function toNonNeg(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}

function normalizeCodebuddyUsage(
  rawUsage: Record<string, unknown>,
): Omit<TokenTotals, 'conversation_count'> | null {
  const promptTokens = toNonNeg(rawUsage.prompt_tokens);
  const completionTokens = toNonNeg(rawUsage.completion_tokens);
  const details =
    rawUsage.prompt_tokens_details && typeof rawUsage.prompt_tokens_details === 'object'
      ? (rawUsage.prompt_tokens_details as Record<string, unknown>)
      : {};
  const cachedTokens = toNonNeg(details.cached_tokens);
  const cacheReadAlt = toNonNeg(rawUsage.cache_read_input_tokens);
  const cacheCreation = toNonNeg(rawUsage.cache_creation_input_tokens);
  const reasoningTokens = toNonNeg(details.reasoning_tokens);

  const cacheRead = Math.max(cachedTokens, cacheReadAlt);
  const inputTokens = Math.max(0, promptTokens - cacheRead);

  if (inputTokens === 0 && completionTokens === 0 && cacheRead === 0 && cacheCreation === 0) {
    return null;
  }

  const body = {
    input_tokens: inputTokens,
    cached_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreation,
    output_tokens: completionTokens,
    reasoning_output_tokens: reasoningTokens,
  };
  return { ...body, total_tokens: computeTotalTokens(body) };
}

export interface ParseCodebuddyResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parseCodebuddyIncremental(
  cursors: CursorsFile,
  statsSince: string,
  opts?: {
    env?: NodeJS.ProcessEnv;
    projectFiles?: string[];
    defaultModel?: string;
    /** Seam for tests: extension history message files to read. */
    extensionFiles?: CodebuddyExtensionMessageFile[];
    /** Seam for tests: explicit session → cwd map instead of disk discovery. */
    sessionCwds?: Map<string, string>;
    /** Seam for tests: workspace md5 → cwd (plugin history folder name). */
    workspaceCwds?: Map<string, string>;
  },
): Promise<{ result: ParseCodebuddyResult; cursors: CursorsFile }> {
  const env = opts?.env ?? process.env;
  const sinceMs = new Date(statsSince).getTime();
  const ext = cursors as CodebuddyExtCursors;
  if (!ext.codebuddy) ext.codebuddy = { seenIds: [], fileOffsets: {} };
  if (!ext.codebuddy.fileOffsets) ext.codebuddy.fileOffsets = {};
  if (!ext.codebuddy.extSeenIds) ext.codebuddy.extSeenIds = [];
  if (!ext.codebuddy.extFileMtimes) ext.codebuddy.extFileMtimes = {};
  const seenIds = new Set(ext.codebuddy.seenIds ?? []);
  const fileOffsets = ext.codebuddy.fileOffsets;
  const bucketState: BucketAccumulator = new Map();
  const fallbackModel = opts?.defaultModel ?? resolveCodebuddyDefaultModel(env);
  const files = opts?.projectFiles ?? resolveCodebuddyProjectFiles(env);

  let eventsParsed = 0;
  let filesProcessed = 0;

  for (const filePath of files) {
    const st = await stat(filePath).catch(() => null);
    if (!st?.isFile()) continue;

    const prev = fileOffsets[filePath];
    const prevSize = prev?.size ?? 0;
    const inodeChanged = typeof prev?.ino === 'number' && prev.ino !== st.ino;
    const startOffset = st.size < prevSize || inodeChanged ? 0 : prevSize;
    if (st.size <= startOffset) continue;

    const reader = createJsonlLineReader(filePath, startOffset);

    for await (const line of reader) {
      if (!line.trim()) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (entry.type !== 'message' || entry.role !== 'assistant') continue;

      const provider =
        entry.providerData && typeof entry.providerData === 'object'
          ? (entry.providerData as Record<string, unknown>)
          : null;
      const rawUsage =
        provider?.rawUsage && typeof provider.rawUsage === 'object'
          ? (provider.rawUsage as Record<string, unknown>)
          : null;
      if (!rawUsage) continue;

      const sessionId =
        typeof entry.sessionId === 'string' && entry.sessionId
          ? entry.sessionId
          : basename(filePath, '.jsonl');
      const tsMs =
        Number.isFinite(Number(entry.timestamp)) && Number(entry.timestamp) > 0
          ? Number(entry.timestamp)
          : null;
      const messageId =
        typeof entry.uuid === 'string' && entry.uuid
          ? entry.uuid
          : typeof entry.id === 'string' && entry.id
            ? entry.id
            : tsMs != null
              ? `${sessionId}:${tsMs}`
              : null;
      if (!messageId || seenIds.has(messageId)) continue;

      const delta = normalizeCodebuddyUsage(rawUsage);
      if (!delta) {
        seenIds.add(messageId);
        continue;
      }
      if (tsMs == null) {
        seenIds.add(messageId);
        continue;
      }

      const hourStart = toUtcHalfHourStart(new Date(tsMs).toISOString());
      if (!hourStart || new Date(hourStart).getTime() < sinceMs) {
        seenIds.add(messageId);
        continue;
      }

      const model =
        normalizeModel(provider?.model) ??
        normalizeModel(entry.model) ??
        fallbackModel;

      accumulateBucket(
        bucketState,
        'codebuddy',
        model,
        'unknown',
        hourStart,
        { ...delta, conversation_count: 1 },
        CODEBUDDY_COLLECTOR,
      );
      seenIds.add(messageId);
      eventsParsed += 1;
    }

    const postStat = await stat(filePath).catch(() => st);
    fileOffsets[filePath] = {
      size: reader.nextOffset,
      mtimeMs: postStat.mtimeMs,
      ino: postStat.ino,
    };
    filesProcessed += 1;
  }

  ext.codebuddy.seenIds = Array.from(seenIds).slice(-10_000);

  // Channel 2 — App / editor extension history. Where the desktop app and the
  // VSCode / Cursor plugin actually record usage.
  const extSeenIds = new Set(ext.codebuddy.extSeenIds ?? []);
  const extFileMtimes = ext.codebuddy.extFileMtimes ?? {};
  // An explicit `projectFiles` list scopes the run to the CLI channel (used by
  // tests and by callers that already resolved their own files); the extension
  // channel is only auto-discovered on a normal full parse.
  const extensionFiles =
    opts?.extensionFiles ?? (opts?.projectFiles ? [] : resolveCodebuddyExtensionMessageFiles(env));

  // Project attribution, in order: desktop session db → editor genie-history
  // (session id / workspace md5) → base64 path above `history/` (anonymous tree).
  type ExtProjectMaps = {
    sessionCwds: Map<string, string>;
    workspaceCwds: Map<string, string>;
  };
  let projectMaps: ExtProjectMaps | null =
    opts?.sessionCwds != null || opts?.workspaceCwds != null
      ? {
          sessionCwds: opts.sessionCwds ?? new Map(),
          workspaceCwds: opts.workspaceCwds ?? new Map(),
        }
      : null;
  const ensureProjectMaps = (): ExtProjectMaps => {
    if (projectMaps) return projectMaps;
    const sessionCwds = loadCodebuddyAppSessionCwds(resolveCodebuddyAppSessionsDb(env));
    const editor = loadCodebuddyEditorWorkspaceMaps(env);
    for (const [id, cwd] of editor.sessionCwds) {
      if (!sessionCwds.has(id)) sessionCwds.set(id, cwd);
    }
    projectMaps = { sessionCwds, workspaceCwds: editor.workspaceCwds };
    return projectMaps;
  };
  const resolveExtensionProject = (entry: CodebuddyExtensionMessageFile): string => {
    const maps = ensureProjectMaps();
    return projectFromCwd(
      maps.sessionCwds.get(entry.sessionId) ??
        (entry.workspaceId ? maps.workspaceCwds.get(entry.workspaceId) : undefined) ??
        entry.pathHint,
    );
  };

  let extEventsParsed = 0;
  let extFilesProcessed = 0;

  for (const entry of extensionFiles) {
    const st = await stat(entry.file).catch(() => null);
    if (!st?.isFile()) continue;

    // One file per message, so mtime is enough to skip untouched history.
    const prevMtime = extFileMtimes[entry.file];
    if (prevMtime != null && Math.trunc(prevMtime) === Math.trunc(st.mtimeMs)) continue;
    extFileMtimes[entry.file] = st.mtimeMs;
    extFilesProcessed += 1;

    const message = readCodebuddyExtensionMessage(entry.file);
    if (!message || message.role !== 'assistant') continue;

    const usage = usageFromCodebuddyExtra(message.extra);
    // Steps without usage are tool/intermediate states. They are not marked
    // seen so a later rewrite (mtime bump) can still pick up real usage.
    if (!usage) continue;

    const messageId = message.id ?? basename(entry.file, '.json');
    if (extSeenIds.has(messageId)) continue;

    const tsMs = message.createdAt ? Date.parse(message.createdAt) : Number.NaN;
    if (!Number.isFinite(tsMs) || tsMs <= 0) {
      extSeenIds.add(messageId);
      continue;
    }
    const hourStart = toUtcHalfHourStart(new Date(tsMs).toISOString());
    if (!hourStart || new Date(hourStart).getTime() < sinceMs) {
      extSeenIds.add(messageId);
      continue;
    }

    const model =
      normalizeModel(message.extra.modelId) ??
      normalizeModel(message.extra.modelName) ??
      fallbackModel;
    const project = resolveExtensionProject(entry);

    accumulateBucket(
      bucketState,
      'codebuddy',
      model,
      project,
      hourStart,
      { ...usage, conversation_count: 1 },
      CODEBUDDY_COLLECTOR,
    );
    extSeenIds.add(messageId);
    extEventsParsed += 1;
  }

  ext.codebuddy.extSeenIds = Array.from(extSeenIds).slice(-50_000);
  ext.codebuddy.extFileMtimes = capExtFileMtimes(extFileMtimes);

  return {
    result: {
      buckets: bucketsFromState(bucketState, 'codebuddy'),
      eventsParsed: eventsParsed + extEventsParsed,
      filesProcessed: filesProcessed + extFilesProcessed,
    },
    cursors,
  };
}
