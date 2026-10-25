import { open, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { Decompress } from 'fzstd';
import { codexLedgerDbPaths, newestCodexLedgerPaths } from './parsers/codex-ledger.js';
import { queryDbJson, readSqliteWithSnapshot } from './parsers/sqlite.js';

const MAX_PREFIX_BYTES = 1024 * 1024;
const MAX_ZSTD_WINDOW = 8 * 1024 * 1024;
const budgetReached = Symbol('directory prefix budget');

/** Validate each frame before fzstd allocates its window; never feed an unchecked next frame. */
function decodedPrefix(input: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let written = 0, offset = 0;
  while (offset + 6 <= input.length && written < MAX_PREFIX_BYTES) {
    const frame = input.subarray(offset);
    if (frame.readUInt32LE(0) !== 0xfd2fb528) break;
    const flags = frame[4]!, single = Boolean(flags & 32), sizeFlag = flags >> 6;
    const sizeBytes = sizeFlag ? 2 ** sizeFlag : single ? 1 : 0;
    const headerBytes = 5 + (single ? 0 : 1) + [0, 1, 2, 4][flags & 3]! + sizeBytes;
    if (headerBytes > frame.length || flags & 8) break;
    let contentSize = 0;
    for (let i = 0; i < sizeBytes; i++) contentSize += frame[headerBytes - sizeBytes + i]! * 2 ** (8 * i);
    if (sizeFlag === 1) contentSize += 256;
    const descriptor = frame[5]!;
    const base = 2 ** (10 + (descriptor >> 3));
    const window = single ? contentSize : base + base / 8 * (descriptor & 7);
    if (!Number.isSafeInteger(window) || window > MAX_ZSTD_WINDOW) break;
    let end = headerBytes, complete = false;
    while (end + 3 <= frame.length) {
      const block = frame.readUIntLE(end, 3), type = (block >> 1) & 3;
      if (type === 3) return Buffer.concat(chunks, written);
      end += 3 + (type === 1 ? 1 : block >> 3);
      if (end > frame.length) break;
      if (block & 1) { end += flags & 4 ? 4 : 0; complete = end <= frame.length; break; }
    }
    const decoder = new Decompress(data => {
      const count = Math.min(data.length, MAX_PREFIX_BYTES - written);
      if (count) { chunks.push(Buffer.from(data.subarray(0, count))); written += count; }
      if (count < data.length || written === MAX_PREFIX_BYTES) throw budgetReached;
    });
    try { decoder.push(frame.subarray(0, complete ? end : frame.length), complete); }
    catch (error) { if (error !== budgetReached) return Buffer.concat(chunks, written); }
    if (!complete) break;
    offset += end;
  }
  return Buffer.concat(chunks, written);
}

async function sourcePrefix(path: string): Promise<{ bytes: Buffer; path: string; compressed: boolean } | null> {
  const candidates = path.endsWith('.jsonl') ? [path, `${path}.zst`, `${path}.zstd`] : [path];
  for (const candidate of candidates) {
    let handle;
    try {
      handle = await open(candidate, 'r');
      const input = Buffer.alloc(MAX_PREFIX_BYTES);
      const { bytesRead } = await handle.read(input, 0, input.length, 0);
      const prefix = input.subarray(0, bytesRead);
      const compressed = /\.(zst|zstd)$/.test(candidate);
      return { bytes: compressed ? decodedPrefix(prefix) : prefix, path: candidate, compressed };
    } catch { /* A source may have been archived since the last collection. */ }
    finally { await handle?.close(); }
  }
  return null;
}

const directoryValue = (value: unknown): string | null => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`;
const query = (path: string, sql: string) => queryDbJson(path, sql, { readOnly: true, timeout: 1500, maxBuffer: 32 * 1024 });

function codexDirectory(path: string, sessionId: string): string | null {
  for (const ledger of newestCodexLedgerPaths(codexLedgerDbPaths())) {
    const child = relative(dirname(ledger), path);
    if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) continue;
    try {
      const cwd = query(ledger, `SELECT cwd FROM threads WHERE id = ${sqlText(sessionId)} LIMIT 1`)[0]?.cwd;
      const directory = directoryValue(cwd);
      if (directory) return directory;
    } catch { /* Older schemas or a locked ledger can fall back to log metadata. */ }
  }
  return null;
}

function zcodeDirectory(path: string, sessionId: string): string | null {
  try {
    return readSqliteWithSnapshot(path, db => {
      let fallback: string | null = null;
      try { fallback = directoryValue(query(db, `SELECT directory FROM session WHERE id = ${sqlText(sessionId)} LIMIT 1`)[0]?.directory); } catch { /* Legacy schema. */ }
      for (const table of ['message', 'session_message']) {
        try {
          const columns = new Set(query(db, `PRAGMA table_info(${table})`).map(row => row.name));
          if (!columns.has('session_id') || !columns.has('data')) continue;
          const clock = columns.has('time_created') ? `coalesce(json_extract(data, '$.time.created'), time_created)` : `json_extract(data, '$.time.created')`;
          const rows = query(db, `SELECT json_extract(data, '$.path.cwd') AS directory FROM ${table}
            WHERE session_id = ${sqlText(sessionId)} AND json_valid(data)
              AND typeof(json_extract(data, '$.path.cwd')) = 'text' AND json_extract(data, '$.path.cwd') <> ''
            ORDER BY ${clock} DESC LIMIT 1`);
          const latest = directoryValue(rows[0]?.directory);
          if (latest) return latest;
        } catch { /* Try the other supported projection, then session.directory. */ }
      }
      return fallback;
    });
  } catch { return null; }
}

async function sourceTail(path: string): Promise<Buffer | null> {
  let handle;
  try {
    handle = await open(path, 'r');
    const { size } = await handle.stat();
    if (size <= MAX_PREFIX_BYTES) return null;
    const start = size - MAX_PREFIX_BYTES;
    const bytes = Buffer.alloc(MAX_PREFIX_BYTES);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, start);
    const tail = bytes.subarray(0, bytesRead);
    // The first line may start outside the window. Never parse that fragment.
    const boundary = tail.indexOf(10);
    return boundary < 0 ? null : tail.subarray(boundary + 1);
  } catch { return null; }
  finally { await handle?.close(); }
}

function metadataDirectory(bytes: Buffer, source: string, sessionId: string, initialIdentity = false): { directory: string | null; identified: boolean; currentIdentity: boolean } {
  let directory: string | null = null, identified = initialIdentity, currentIdentity = initialIdentity;
  for (const line of bytes.toString('utf8').split('\n')) {
    let record: Record<string, unknown>; try { record = JSON.parse(line); } catch { continue; }
    const payload = record.payload && typeof record.payload === 'object' ? record.payload as Record<string, unknown> : {};
    let cwd: unknown;
    if (source === 'codex') {
      if (record.type === 'session_meta') { currentIdentity = payload.id === sessionId; identified ||= currentIdentity; }
      if (currentIdentity && (record.type === 'session_meta' || record.type === 'turn_context')) cwd = payload.cwd;
    } else if (source === 'claude') {
      if (record.sessionId !== sessionId) continue;
      identified = true; cwd = record.cwd;
    } else if (record.type === 'session' && record.id === sessionId) {
      identified = true; cwd = record.cwd;
    }
    const candidate = directoryValue(cwd);
    if (candidate) directory = candidate;
  }
  return { directory, identified, currentIdentity };
}

export interface LocalSessionTarget { directory: string | null; sessionFile: string | null }

/** Local detail lookup only. Never persist cwd or attach it to bulk session exports. */
export async function readSessionTarget(dataDir: string, source: string, sessionId: string): Promise<LocalSessionTarget> {
  const empty = { directory: null, sessionFile: null };
  if (!['codex', 'claude', 'dsh', 'pi', 'zcode'].includes(source)) return empty;
  let snapshot: { files?: Record<string, { context?: { sessionId?: string }; messages?: Record<string, { sessionId: string }> }> };
  try { snapshot = JSON.parse(await readFile(join(dataDir, 'sessions', `${source}.json`), 'utf8')); } catch { return empty; }
  for (const [path, file] of Object.entries(snapshot.files ?? {})) {
    if (file.context?.sessionId !== sessionId && !Object.values(file.messages ?? {}).some(m => m.sessionId === sessionId)) continue;
    if (!isAbsolute(path)) continue;
    if (source === 'zcode' && /\.(db|sqlite)$/.test(path)) return { directory: zcodeDirectory(path, sessionId), sessionFile: null };
    if (!/\.jsonl(?:\.zstd?)?$/.test(path)) continue;
    const prefix = await sourcePrefix(path);
    if (!prefix) continue;
    const metadata = metadataDirectory(prefix.bytes, source, sessionId);
    if (!metadata.identified) continue;
    let directory = metadata.directory;
    let latest: string | null = null;
    if (!prefix.compressed && (source === 'codex' || source === 'claude')) {
      const tail = await sourceTail(prefix.path);
      latest = tail ? metadataDirectory(tail, source, sessionId, metadata.currentIdentity && file.context?.sessionId === sessionId).directory : null;
    }
    // The thread ledger owns Codex's current worktree, even when log metadata lags a handoff.
    directory = source === 'codex' ? codexDirectory(prefix.path, sessionId) ?? latest ?? directory : latest ?? directory;
    return { directory, sessionFile: source === 'pi' && !prefix.compressed ? prefix.path : null };
  }
  return empty;
}

export async function readSessionDirectory(dataDir: string, source: string, sessionId: string): Promise<string | null> {
  return (await readSessionTarget(dataDir, source, sessionId)).directory;
}
