import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { lock } from 'proper-lockfile';

const held = new AsyncLocalStorage<ReadonlySet<string>>();

/** Cross-process, heartbeat-backed lock shared by collection and local snapshots. */
export async function withDataTransaction<T>(dataDir: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dataDir, { recursive: true });
  const dir = await realpath(dataDir);
  if (held.getStore()?.has(dir)) return operation();
  const release = await lock(join(dir, '.data-transaction'), { realpath: false, stale: 60_000, update: 5_000,
    retries: { retries: 120, factor: 1, minTimeout: 500, maxTimeout: 500 } });
  try { return await held.run(new Set([...(held.getStore() ?? []), dir]), operation); }
  finally { await release(); }
}
