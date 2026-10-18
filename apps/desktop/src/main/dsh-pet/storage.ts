import { lstat, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export async function atomicPrivateFile(file: string, text: string): Promise<void> {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('数据目录不能是链接');
  try { if ((await lstat(file)).isSymbolicLink()) throw new Error('数据文件不能是链接'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = path.join(directory, `.${path.basename(file)}-${randomBytes(8).toString('hex')}`);
  try { await writeFile(temporary, text, { flag: 'wx', mode: 0o600 }); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
