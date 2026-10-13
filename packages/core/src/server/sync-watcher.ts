import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';

const WATCHED_FILES = new Set(['sync.done', 'notify.signal']);

export type WatchedSyncSignal = 'sync.done' | 'notify.signal';

export function watchSyncSignals(
  dataDir: string,
  onDebounced: (filename: WatchedSyncSignal) => void | Promise<void>,
  debounceMs = 400,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: WatchedSyncSignal | null = null;

  const schedule = (filename: WatchedSyncSignal) => {
    // Prefer notify over sync.done when both fire in the same debounce window.
    if (pending === 'notify.signal' && filename === 'sync.done') {
      // keep notify
    } else {
      pending = filename;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const file = pending;
      pending = null;
      if (!file) return;
      void Promise.resolve(onDebounced(file)).catch(() => {});
    }, debounceMs);
  };

  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(dataDir, (_eventType, filename) => {
      if (!filename || !WATCHED_FILES.has(filename)) return;
      schedule(filename as WatchedSyncSignal);
    });
  } catch {
    // watcher unavailable; poll timer + manual sync still work
  }

  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}

export function syncSignalFilenames(): string[] {
  return [...WATCHED_FILES];
}

export function isSyncSignalFile(filename: string): boolean {
  return WATCHED_FILES.has(filename);
}

export function resolveSyncSignalPath(dataDir: string, filename: string): string {
  return join(dataDir, filename);
}
