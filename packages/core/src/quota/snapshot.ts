import { open, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseQuotaReport, type QuotaReport, type QuotaRuntimeSource } from './report.js';

const MAX_BYTES = 1024 * 1024;
/** A local routing guard, not an authentication credential. Never reveals the directory. */
export function quotaDirectoryKey(directory: string): string {
  const normalized = path.resolve(directory);
  return createHash('sha256').update(process.platform === 'win32' ? normalized.toLowerCase() : normalized).digest('hex');
}
const snapshotPath = (directory: string, runtime: QuotaRuntimeSource) => path.join(directory, 'quota-snapshots', `${runtime}.json`);
const empty = (availability: 'missing' | 'invalid', now: number): QuotaReport => ({ schemaVersion: 1, availability, runtime: null, generatedAt: null, readAt: now, stale: true, providers: [] });

/** Does not open a quota store, create directories, repair files or query a provider. */
export async function readQuotaReport(directory: string, options: { runtime?: QuotaRuntimeSource | 'latest'; now?: number } = {}): Promise<QuotaReport> {
  const now = options.now ?? Date.now() / 1000;
  const read = async (source: QuotaRuntimeSource) => {
    let file;
    try {
      file = await open(snapshotPath(directory, source), 'r');
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES) return empty('invalid', now);
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const result = await file.read(buffer, bytes, buffer.length - bytes, null);
        if (!result.bytesRead) break;
        bytes += result.bytesRead;
      }
      if (bytes > MAX_BYTES) return empty('invalid', now);
      return parseQuotaReport(JSON.parse(buffer.subarray(0, bytes).toString('utf8')), source, now);
    } catch (error) { return empty((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid', now); }
    finally { await file?.close(); }
  };
  if (options.runtime && options.runtime !== 'latest') return read(options.runtime);
  const reports = await Promise.all([read('cli'), read('desktop')]);
  return reports.filter(r => r.availability === 'ready').sort((a, b) => b.generatedAt! - a.generatedAt!)[0]
    ?? empty(reports.some(r => r.availability === 'invalid') ? 'invalid' : 'missing', now);
}

/** Separate runtime files; concurrent state emissions are serialized and coalesced. */
export function createQuotaSnapshotPublisher(directory: string, runtime: QuotaRuntimeSource) {
  let queued: QuotaReport | null = null;
  let pending: Promise<void> | null = null;
  const publish = (report: QuotaReport): Promise<void> => {
    queued = parseQuotaReport(report, runtime, report.generatedAt ?? Date.now() / 1000);
    if (pending) return pending;
    pending = (async () => {
      await mkdir(path.dirname(snapshotPath(directory, runtime)), { recursive: true });
      while (queued) {
        const value = queued; queued = null;
        const body = JSON.stringify(value);
        if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('quota snapshot too large');
        const target = snapshotPath(directory, runtime), temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
        try { await writeFile(temporary, body, { mode: 0o600, flag: 'wx' }); await rename(temporary, target); }
        finally { await unlink(temporary).catch(() => {}); }
      }
    })().finally(() => {
      pending = null;
      // A state emission can arrive between the drain completing and this microtask.
      if (queued) return publish(queued);
    });
    return pending;
  };
  return { publish, flush: () => pending ?? Promise.resolve() };
}
