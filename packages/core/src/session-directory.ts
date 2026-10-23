import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Decompress } from 'fzstd';

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

async function sourcePrefix(path: string): Promise<Buffer | null> {
  const candidates = path.endsWith('.jsonl') ? [path, `${path}.zst`, `${path}.zstd`] : [path];
  for (const candidate of candidates) {
    let handle;
    try {
      handle = await open(candidate, 'r');
      const input = Buffer.alloc(MAX_PREFIX_BYTES);
      const { bytesRead } = await handle.read(input, 0, input.length, 0);
      const prefix = input.subarray(0, bytesRead);
      return /\.(zst|zstd)$/.test(candidate) ? decodedPrefix(prefix) : prefix;
    } catch { /* A source may have been archived since the last collection. */ }
    finally { await handle?.close(); }
  }
  return null;
}

/** Local detail lookup only. Never persist cwd or attach it to bulk session exports. */
export async function readSessionDirectory(dataDir: string, source: string, sessionId: string): Promise<string | null> {
  if (!['codex', 'claude', 'dsh'].includes(source)) return null;
  let snapshot: { files?: Record<string, { context?: { sessionId?: string }; messages?: Record<string, { sessionId: string }> }> };
  try { snapshot = JSON.parse(await readFile(join(dataDir, 'sessions', `${source}.json`), 'utf8')); } catch { return null; }
  for (const [path, file] of Object.entries(snapshot.files ?? {})) {
    if (file.context?.sessionId !== sessionId && !Object.values(file.messages ?? {}).some(m => m.sessionId === sessionId)) continue;
    if (!/\.jsonl(?:\.zstd?)?$/.test(path)) continue;
    const prefix = await sourcePrefix(path);
    if (!prefix) continue;
    for (const line of prefix.toString('utf8').split('\n').slice(0, 512)) {
      let record: Record<string, unknown>; try { record = JSON.parse(line); } catch { continue; }
      const payload = record.payload && typeof record.payload === 'object' ? record.payload as Record<string, unknown> : {};
      if (source === 'codex' && (record.type !== 'session_meta' || payload.id !== sessionId)) continue;
      if (source === 'claude' && record.sessionId && record.sessionId !== sessionId) continue;
      if (source === 'dsh' && (record.type !== 'session' || record.id !== sessionId)) continue;
      const cwd = source === 'codex' ? payload.cwd : record.cwd;
      if (typeof cwd === 'string' && cwd.length <= 4096 && !/[\u0000-\u001f]/.test(cwd)) return cwd;
    }
  }
  return null;
}
