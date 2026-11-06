import { link, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createDataBackup, verifyDataBackup, parseDataBackup, restoreDataBackup, resolveDataDir, MAX_BACKUP_DOCUMENT_BYTES } from 'quotern-core';

export const backupHelp = 'quotern backup create --out <backup.json> [--data-dir <source>]\nquotern backup verify --file <backup.json>\nquotern backup restore --file <backup.json> --target <new-directory>\nExisting files and directories are never overwritten. Stop other Quotern runtimes before CLI backup. Restore does not switch the current runtime.';
export function parseBackupArgs(args: readonly string[]) {
  const action = args[0];
  if (!action || action === 'help' || args.includes('--help')) return { action: 'help' as const };
  if (!['create', 'verify', 'restore'].includes(action)) throw new Error(backupHelp);
  const values = new Map<string, string>();
  const allowed = action === 'create' ? ['--out', '--data-dir'] : action === 'restore' ? ['--file', '--target'] : ['--file'];
  for (let i = 1; i < args.length; i++) {
    const key = args[i]!, value = args[++i];
    if (!allowed.includes(key) || values.has(key) || !value?.trim() || value.startsWith('--')) throw new Error(`Invalid backup argument: ${key}\n${backupHelp}`);
    values.set(key, value);
  }
  if (action === 'create' && !values.has('--out') || action !== 'create' && !values.has('--file') || action === 'restore' && !values.has('--target')) throw new Error(backupHelp);
  return { action: action as 'create' | 'verify' | 'restore', values };
}

/** Runs before ordinary runtime startup: verify and restore do not initialize the source. */
export async function runBackupCommand(args: readonly string[]): Promise<void> {
  const options = parseBackupArgs(args);
  if (options.action === 'help') { console.log(backupHelp); return; }
  const values = options.values!;
  if (options.action === 'create') {
    const dir = await realpath(resolve(values.get('--data-dir') ?? resolveDataDir()));
    const output = resolve(values.get('--out')!), parent = await realpath(dirname(output));
    const canonicalOutput = resolve(parent, basename(output));
    const part = relative(dir, canonicalOutput);
    if (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)) throw new Error('BACKUP_OUTPUT_INSIDE_SOURCE');
    const backup = await createDataBackup(dir), temporary = `${canonicalOutput}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(backup), { flag: 'wx', mode: 0o600 }); await link(temporary, canonicalOutput); }
    finally { await unlink(temporary).catch(() => {}); }
    console.log(JSON.stringify({ ...verifyDataBackup(backup), file: canonicalOutput }, null, 2));
    return;
  }
  const file = resolve(values.get('--file')!);
  if ((await stat(file)).size > MAX_BACKUP_DOCUMENT_BYTES) throw new Error('BACKUP_TOO_LARGE');
  const backup = parseDataBackup(await readFile(file, 'utf8'));
  const result = options.action === 'verify' ? verifyDataBackup(backup) : await restoreDataBackup(backup, resolve(values.get('--target')!));
  console.log(JSON.stringify(result, null, 2));
}
