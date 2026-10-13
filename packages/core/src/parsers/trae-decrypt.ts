import { createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { open as fsOpen, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWriteStream } from 'node:fs';

const PAGE_SIZE = 4096;
const RESERVE_SIZE = 80;
const SALT_SIZE = 16;
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'utf8');

export interface TraeSqlcipherKeyFile {
  enc_key: string;
  address?: string;
  source?: string;
}

export function parseTraeSqlcipherKey(raw: unknown): Buffer | null {
  if (!raw || typeof raw !== 'object') return null;
  const encKey = (raw as TraeSqlcipherKeyFile).enc_key;
  if (typeof encKey !== 'string') return null;
  const hex = encKey.trim().replace(/^x'/i, '').replace(/'$/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

export function loadTraeSqlcipherKeyFile(path: string): Buffer | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return parseTraeSqlcipherKey(parsed);
  } catch {
    return null;
  }
}

export function saveTraeSqlcipherKeyFile(
  path: string,
  encKeyHex: string,
  meta?: Partial<TraeSqlcipherKeyFile>,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const payload: TraeSqlcipherKeyFile = {
    enc_key: encKeyHex.replace(/^x'/i, '').replace(/'$/, '').toLowerCase(),
    ...meta,
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
}

function decryptPage(key: Buffer, page: Buffer, pageNumber: number): Buffer {
  const ivStart = PAGE_SIZE - RESERVE_SIZE;
  const iv = page.subarray(ivStart, ivStart + 16);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(false);
  if (pageNumber === 1) {
    const plaintext = Buffer.concat([
      decipher.update(page.subarray(SALT_SIZE, ivStart)),
      decipher.final(),
    ]);
    return Buffer.concat([SQLITE_HEADER, plaintext, Buffer.alloc(RESERVE_SIZE)]);
  }
  const plaintext = Buffer.concat([
    decipher.update(page.subarray(0, ivStart)),
    decipher.final(),
  ]);
  return Buffer.concat([plaintext, Buffer.alloc(RESERVE_SIZE)]);
}

/** Returns true if page 1 decrypts to a plausible SQLite header (key is valid). */
export function verifyTraeSqlcipherKey(dbPath: string, key: Buffer): boolean {
  if (!existsSync(dbPath) || key.length !== 32) return false;
  try {
    const fd = readFileSync(dbPath);
    if (fd.length < PAGE_SIZE) return false;
    const page1 = decryptPage(key, fd.subarray(0, PAGE_SIZE), 1);
    if (!page1.subarray(0, 16).equals(SQLITE_HEADER)) return false;
    // Page size is big-endian at offset 16; SQLCipher Trae DBs use 4096.
    // Wrong keys still decrypt without error but yield garbage here.
    const pageSize = page1.readUInt16BE(16);
    return pageSize === 4096 || pageSize === 1; // 1 means 65536 in SQLite
  } catch {
    return false;
  }
}

/**
 * Decrypt a Trae SQLCipher 4 DB (raw 256-bit key) to a plaintext SQLite file.
 * Large DBs (100MB+) may take a few seconds.
 */
export async function decryptTraeDatabase(
  sourcePath: string,
  key: Buffer,
  destinationPath: string,
): Promise<void> {
  if (key.length !== 32) throw new Error('Trae SQLCipher key must be 32 bytes');
  mkdirSync(dirname(destinationPath), { recursive: true });

  const handle = await fsOpen(sourcePath, 'r');
  try {
    const { size } = await handle.stat();
    const totalPages = Math.floor(size / PAGE_SIZE);
    if (totalPages < 1) throw new Error('Trae database is empty or truncated');

    const out = createWriteStream(destinationPath, { flags: 'w' });
    const pageBuf = Buffer.alloc(PAGE_SIZE);
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const { bytesRead } = await handle.read(
        pageBuf,
        0,
        PAGE_SIZE,
        (pageNumber - 1) * PAGE_SIZE,
      );
      if (bytesRead !== PAGE_SIZE) {
        out.destroy();
        throw new Error(`short read at Trae page ${pageNumber}`);
      }
      const decrypted = decryptPage(key, pageBuf, pageNumber);
      if (!out.write(decrypted)) {
        await new Promise<void>((resolve) => out.once('drain', resolve));
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve());
      out.on('error', reject);
    });
  } finally {
    await handle.close();
  }
}

/** Decrypt to a temp file under os.tmpdir(); caller should unlink when done. */
export async function decryptTraeDatabaseToTemp(
  sourcePath: string,
  key: Buffer,
): Promise<string> {
  const dest = join(tmpdir(), `tud-trae-${randomBytes(8).toString('hex')}.db`);
  try {
    await decryptTraeDatabase(sourcePath, key, dest);
    return dest;
  } catch (err) {
    await unlink(dest).catch(() => undefined);
    throw err;
  }
}
