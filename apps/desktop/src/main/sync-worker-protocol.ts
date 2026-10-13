import type { SyncResult } from 'quotern-core';

export type SyncWorkerRequest =
  | { type: 'init'; dataDir: string }
  | { type: 'runSync'; id: number; reason: string; source?: string }
  /** Main cleared cursors.json on disk; the worker must drop its cached copy. */
  | { type: 'invalidateCursors' }
  | { type: 'stop' };

export type SyncWorkerResponse =
  | { type: 'ready'; pid?: number }
  | { type: 'syncDone'; id: number; results: SyncResult[] }
  | { type: 'syncError'; id: number; error: string };
