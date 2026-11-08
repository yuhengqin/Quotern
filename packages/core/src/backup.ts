import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, readdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { withDataTransaction } from './data-transaction.js';
import { readRuntimeOwner, isPidAlive } from './runtime-pid.js';
import { validateManualPricing } from './pricing/manual-pricing.js';
import { validQuotaPatch } from './quota/readers/quota-store.js';
import { validateStoredAchievements } from './achievements/store.js';
import { validateBackupCursors, validateBackupSessions } from './backup-validation.js';

export const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
export const MAX_BACKUP_DOCUMENT_BYTES = 256 * 1024 * 1024;
export const BACKUP_INCOMPLETE_FILE = '.backup-restore-incomplete';
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 10_000;
export interface BackupFile { path: string; bytes: number; sha256: string; content: string }
export interface DataBackup { schemaVersion: 1; createdAt: string; files: BackupFile[] }
export type BackupContentCategory = 'usage' | 'sessions' | 'settings' | 'cursors' | 'achievements' | 'quota' | 'pricing';
export interface BackupContents {
  usageRows: number;
  /** Actual usage bucket timestamps, in UTC. Never inferred from configuration. */
  from: string | null;
  to: string | null;
  sources: string[];
  sourcesTruncated: boolean;
  categories: { kind: BackupContentCategory; files: number }[];
}
export interface BackupSummary { createdAt: string; fileCount: number; bytes: number; fingerprint: string; contents?: BackupContents }
export interface ProtectedRestoreResult {
  protection: { path: string; summary: BackupSummary };
  restore: { ok: true; target: string; summary: BackupSummary } | { ok: false; code: string };
}
const hash = (content: string) => createHash('sha256').update(content).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const stamp = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const allowed = (path: string) => ['config.json', 'cursors.json', 'pricing-manual.json', 'achievements/state.json', 'quota/history.json', 'quota/preferences.json'].includes(path)
  || ['desktop/quota/history.json', 'desktop/quota/preferences.json'].includes(path)
  || /^queue\/\d{4}-(?:0[1-9]|1[0-2])\.jsonl$/.test(path) || /^sessions\/[a-z][a-z0-9-]{0,63}\.json$/.test(path);
function fail(code = 'BACKUP_INVALID'): never { throw new Error(code); }

function safeConfig(value: unknown): Record<string, unknown> {
  if (!record(value) || !stamp(value.statsSince) || value.localCollectSince !== undefined && !stamp(value.localCollectSince)
    || value.lastSyncAt !== undefined && value.lastSyncAt !== null && !stamp(value.lastSyncAt)) return fail();
  return Object.fromEntries(['statsSince', 'localCollectSince', 'lastSyncAt'].filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}

function validateContent(path: string, content: string, onUsage?: (row: Record<string, unknown>) => void): void {
  if (path.startsWith('desktop/quota/')) path = path.slice('desktop/'.length);
  try {
    if (path.startsWith('queue/')) {
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const row: unknown = JSON.parse(line);
        if (!record(row) || !stamp(row.hour_start) || !['source', 'model', 'project'].every(key => typeof row[key] === 'string')
          || !['input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_creation_input_tokens'].every(key => typeof row[key] === 'number' && Number.isFinite(row[key]) && (row[key] as number) >= 0)
          || row.reasoning_output_tokens !== undefined && (typeof row.reasoning_output_tokens !== 'number' || !Number.isFinite(row.reasoning_output_tokens) || row.reasoning_output_tokens < 0)) fail();
        onUsage?.(row);
      }
      return;
    }
    const value: unknown = JSON.parse(content);
    if (!record(value)) fail();
    if (path === 'config.json') {
      const projected = safeConfig(value);
      if (Object.keys(value).some(key => !Object.hasOwn(projected, key))) fail();
    } else if (path === 'pricing-manual.json') validateManualPricing(value);
    else if (path.startsWith('sessions/')) validateBackupSessions(value, path.slice(9, -5));
    else if (path === 'cursors.json') validateBackupCursors(value);
    else if (path === 'quota/preferences.json') { if (!validQuotaPatch(value)) fail(); }
    else if (path === 'quota/history.json') {
      if (Object.entries(value).some(([key, rows]) => key.length > 512 || !Array.isArray(rows) || rows.some(row => !record(row) || typeof row.at !== 'number' || !Number.isFinite(row.at)
        || typeof row.usedPercent !== 'number' || !Number.isFinite(row.usedPercent) || row.usedPercent < 0 || row.usedPercent > 100
        || row.resetsAt !== null && (typeof row.resetsAt !== 'number' || !Number.isFinite(row.resetsAt))))) fail();
    } else if (path === 'achievements/state.json') {
      if (Buffer.byteLength(content) > 8 * 1024 * 1024) fail();
      validateStoredAchievements(value);
    }
  } catch { fail('BACKUP_CONTENT_INVALID'); }
}

/** Validates every member before any restore writes. No filesystem access. */
export function verifyDataBackup(input: unknown): BackupSummary {
  if (!record(input) || input.schemaVersion !== 1 || !stamp(input.createdAt) || Object.keys(input).some(key => !['schemaVersion', 'createdAt', 'files'].includes(key))
    || !Array.isArray(input.files) || !input.files.length || input.files.length > MAX_FILES) fail();
  let bytes = 0;
  let usageRows = 0, from = Infinity, to = -Infinity, sourcesTruncated = false;
  const sources = new Set<string>(), categories = new Map<BackupContentCategory, number>();
  const addSource = (source: string) => {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(source) || (sources.size >= 100 && !sources.has(source))) { sourcesTruncated = true; return; }
    sources.add(source);
  };
  const seen = new Set<string>(), metadata: Array<{ path: string; bytes: number; sha256: string }> = [];
  for (const raw of input.files) {
    if (!record(raw) || Object.keys(raw).some(key => !['path', 'bytes', 'sha256', 'content'].includes(key)) || typeof raw.path !== 'string' || !allowed(raw.path)
      || seen.has(raw.path.toLowerCase()) || typeof raw.content !== 'string' || typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256)
      || !Number.isSafeInteger(raw.bytes) || (raw.bytes as number) < 0 || (raw.bytes as number) > MAX_FILE_BYTES) fail();
    seen.add(raw.path.toLowerCase());
    const size = Buffer.byteLength(raw.content);
    bytes += size;
    if (size !== raw.bytes || bytes > MAX_BACKUP_BYTES) fail('BACKUP_TOO_LARGE_OR_SIZE');
    if (hash(raw.content) !== raw.sha256) fail('BACKUP_HASH_MISMATCH');
    validateContent(raw.path, raw.content, row => {
      usageRows++;
      const at = Date.parse(row.hour_start as string);
      from = Math.min(from, at); to = Math.max(to, at); addSource(row.source as string);
    });
    const category: BackupContentCategory = raw.path.startsWith('queue/') ? 'usage' : raw.path.startsWith('sessions/') ? 'sessions'
      : raw.path.includes('quota/') ? 'quota' : raw.path.startsWith('achievements/') ? 'achievements'
        : raw.path === 'cursors.json' ? 'cursors' : raw.path === 'pricing-manual.json' ? 'pricing' : 'settings';
    categories.set(category, (categories.get(category) ?? 0) + 1);
    if (category === 'sessions') addSource(raw.path.slice('sessions/'.length, -'.json'.length));
    metadata.push({ path: raw.path, bytes: size, sha256: raw.sha256 });
  }
  if (!seen.has('config.json')) fail();
  return { createdAt: input.createdAt, fileCount: seen.size, bytes, fingerprint: hash(JSON.stringify({ schemaVersion: 1, createdAt: input.createdAt, files: metadata })),
    contents: { usageRows, from: usageRows ? new Date(from).toISOString() : null, to: usageRows ? new Date(to).toISOString() : null,
      sources: [...sources].sort(), sourcesTruncated, categories: [...categories].map(([kind, files]) => ({ kind, files })) } };
}

export function parseDataBackup(text: string): DataBackup {
  if (Buffer.byteLength(text) > MAX_BACKUP_DOCUMENT_BYTES) fail('BACKUP_TOO_LARGE');
  let input: unknown;
  try { input = JSON.parse(text); } catch { return fail(); }
  verifyDataBackup(input);
  return input as DataBackup;
}

async function sourceFiles(dir: string, desktopQuotaDirectory?: string): Promise<Array<{ path: string; full: string }>> {
  const paths: Array<{ path: string; full: string }> = [];
  for (const file of ['config.json', 'cursors.json', 'pricing-manual.json']) {
    try { const stat = await lstat(join(dir, file)); if (!stat.isFile() || stat.isSymbolicLink()) fail('BACKUP_LINK'); paths.push({ path: file, full: join(dir, file) }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  for (const subdir of ['queue', 'sessions', 'achievements', 'quota', 'desktop/quota']) {
    try {
      const directory = subdir === 'desktop/quota' && desktopQuotaDirectory ? desktopQuotaDirectory : join(dir, subdir);
      if (subdir === 'desktop/quota' && !desktopQuotaDirectory) {
        const parent = await lstat(join(dir, 'desktop'));
        if (!parent.isDirectory() || parent.isSymbolicLink()) fail('BACKUP_LINK');
      }
      const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) fail('BACKUP_LINK');
      for (const item of await readdir(directory)) if (allowed(`${subdir}/${item}`)) paths.push({ path: `${subdir}/${item}`, full: join(directory, item) });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (paths.length > MAX_FILES) fail('BACKUP_TOO_LARGE');
  return paths.sort((a, b) => a.path.localeCompare(b.path));
}

export async function createDataBackup(dataDir: string, options: { desktopQuotaDirectory?: string } = {}): Promise<DataBackup> {
  const dir = await realpath(dataDir);
  const owner = await readRuntimeOwner(dir);
  if (owner && owner.pid !== process.pid && isPidAlive(owner.pid)) fail('BACKUP_RUNTIME_ACTIVE');
  const snapshot = async () => {
    try { await lstat(join(dir, BACKUP_INCOMPLETE_FILE)); fail('BACKUP_INCOMPLETE'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const paths = await sourceFiles(dir, options.desktopQuotaDirectory), rawHashes = new Map<string, string>();
    const files: BackupFile[] = [];
    let bytes = 0;
    for (const { path, full } of paths) {
      const stat = await lstat(full);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) fail('BACKUP_LINK');
      if (stat.size > MAX_FILE_BYTES || (bytes += stat.size) > MAX_BACKUP_BYTES) fail('BACKUP_TOO_LARGE');
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(full));
      rawHashes.set(path, hash(raw));
      const content = path === 'config.json' ? `${JSON.stringify(safeConfig(JSON.parse(raw)))}\n` : raw;
      files.push({ path, bytes: Buffer.byteLength(content), sha256: hash(content), content });
    }
    // Detect non-cooperating writes and topology changes as well as our locked writers.
    if (JSON.stringify(paths) !== JSON.stringify(await sourceFiles(dir, options.desktopQuotaDirectory))) fail('BACKUP_SOURCE_CHANGED');
    for (const { path, full } of paths) {
      const stat = await lstat(full);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) fail('BACKUP_LINK');
      if (hash(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(full))) !== rawHashes.get(path)) fail('BACKUP_SOURCE_CHANGED');
    }
    const backup: DataBackup = { schemaVersion: 1, createdAt: new Date().toISOString(), files };
    verifyDataBackup(backup);
    return backup;
  };
  return withDataTransaction(dir, () => options.desktopQuotaDirectory
    ? withDataTransaction(dirname(options.desktopQuotaDirectory), snapshot) : snapshot());
}

/** Restore is exclusive and never replaces an existing directory or switches a running app. */
export async function restoreDataBackup(input: unknown, requestedTarget: string): Promise<BackupSummary & { target: string }> {
  const summary = verifyDataBackup(input);
  const files = (input as DataBackup).files.map(file => ({ ...file }));
  if (!requestedTarget || !isAbsolute(requestedTarget)) fail('BACKUP_TARGET_ABSOLUTE');
  const target = resolve(requestedTarget);
  await realpath(dirname(target)); // Parent must already exist; do not create an arbitrary tree.
  try { await mkdir(target, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return fail('BACKUP_TARGET_EXISTS'); throw error; }
  await withDataTransaction(target, async () => {
    await writeFile(join(target, BACKUP_INCOMPLETE_FILE), 'Restore is incomplete. Do not use this directory.\n', { flag: 'wx', mode: 0o600 });
    for (const file of files) {
      const destination = join(target, file.path);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, file.content, { flag: 'wx', mode: 0o600 });
    }
    await unlink(join(target, BACKUP_INCOMPLETE_FILE));
  });
  return { ...summary, target };
}

/** Persist the current instance first. A later restore failure must not hide that path. */
export async function restoreDataBackupWithProtection(input: unknown, requestedTarget: string, dataDir: string, options: { desktopQuotaDirectory?: string } = {}): Promise<ProtectedRestoreResult> {
  verifyDataBackup(input);
  if (!requestedTarget || !isAbsolute(requestedTarget)) fail('BACKUP_TARGET_ABSOLUTE');
  let protection: ProtectedRestoreResult['protection'];
  try {
    const current = await createDataBackup(dataDir, options);
    const dir = await realpath(dataDir), backupDir = join(dir, 'backups');
    try { await mkdir(backupDir, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stat = await lstat(backupDir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(backupDir) !== backupDir) fail('BACKUP_LINK');
    const path = join(backupDir, `before-restore-${current.createdAt.replace(/[:.]/g, '-')}-${randomUUID()}.json`);
    const temporary = `${path}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      try { await handle.writeFile(JSON.stringify(current)); await handle.sync(); } finally { await handle.close(); }
      await link(temporary, path);
    } finally { await unlink(temporary).catch(() => {}); }
    protection = { path, summary: verifyDataBackup(current) };
  } catch { return fail('BACKUP_PROTECTION_FAILED'); }
  try {
    const { target, ...summary } = await restoreDataBackup(input, requestedTarget);
    return { protection, restore: { ok: true, target, summary } };
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    return { protection, restore: { ok: false, code: /^BACKUP_[A-Z_]+$/.test(code) ? code : 'LOCAL_ADMIN_WRITE_FAILED' } };
  }
}
