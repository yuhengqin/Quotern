/** Main owns UI/state; each sync worker owns only its own requests. */
import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import type { SyncResult } from 'quotern-core';
import type { SyncWorkerRequest, SyncWorkerResponse } from './sync-worker-protocol';

const START_TIMEOUT_MS = 15_000;
const SYNC_TIMEOUT_MS = 10 * 60_000;
const EXIT_TIMEOUT_MS = 5_000;
type Waiter = { resolve: (results: SyncResult[]) => void; reject: (err: Error) => void };
interface WorkerInstance {
  process: ChildProcess;
  pid?: number;
  ready: boolean;
  expectedExit: boolean;
  exited: boolean;
  exit: Promise<void>;
  resolveExit: () => void;
  rejectReady?: (err: Error) => void;
  terminalError?: Error;
  terminating?: Promise<void>;
  pending: Map<number, Waiter>;
}
let child: WorkerInstance | null = null;
let starting: Promise<boolean> | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let nextId = 1;
let generation = 0;
let lastDataDir: string | null = null;
let stopping = false;
let crashRestarts = 0;

function rejectAll(instance: WorkerInstance, error: Error): void {
  for (const waiter of instance.pending.values()) waiter.reject(error);
  instance.pending.clear();
}
function cancelRestart(): void {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
}
async function waitForExit(instance: WorkerInstance): Promise<void> {
  if (instance.exited) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([instance.exit, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('sync worker did not exit after termination')), EXIT_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer); }
}
function terminate(instance: WorkerInstance, error: Error): Promise<void> {
  if (instance.terminating) return instance.terminating;
  instance.expectedExit = true;
  instance.ready = false;
  instance.terminalError = error;
  instance.rejectReady?.(error);
  if (!instance.exited) {
    try { instance.process.send({ type: 'stop' } satisfies SyncWorkerRequest, () => {}); } catch { /* may already be gone */ }
    try { instance.process.kill(); } catch { /* exit confirmation below remains required */ }
  }
  instance.terminating = waitForExit(instance).catch(err => {
    rejectAll(instance, err instanceof Error ? err : new Error(String(err)));
    throw err;
  });
  return instance.terminating;
}

function handleMessage(instance: WorkerInstance, data: unknown): void {
  if (child !== instance || instance.expectedExit || instance.exited) return;
  const message = data as SyncWorkerResponse;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'ready') return;
  if (message.type !== 'syncDone' && message.type !== 'syncError') return;
  crashRestarts = 0;
  const waiter = instance.pending.get(message.id);
  if (!waiter) return;
  instance.pending.delete(message.id);
  if (message.type === 'syncDone') waiter.resolve(message.results);
  else waiter.reject(new Error(message.error));
}

export function isSyncWorkerRunning(): boolean { return Boolean(child?.ready && !child.expectedExit); }

export function startSyncWorker(dataDir: string): Promise<boolean> {
  if (!stopping && lastDataDir === dataDir) {
    if (starting) return starting;
    if (isSyncWorkerRunning()) return Promise.resolve(true);
  }
  if (starting) return Promise.reject(new Error('sync worker is starting for another data directory'));
  cancelRestart();
  stopping = false;
  lastDataDir = dataDir;
  const token = ++generation;
  let instance: WorkerInstance | null = null;
  const operation = (async () => {
    try {
      if (child) await terminate(child, new Error('sync worker replaced'));
      if (stopping || generation !== token) return false;
      const spawned = fork(join(__dirname, 'sync-worker.cjs'), [], { execArgv: [], silent: true, serialization: 'advanced' });
      let resolveExit!: () => void;
      const exit = new Promise<void>(resolve => { resolveExit = resolve; });
      instance = { process: spawned, pid: spawned.pid, ready: false, expectedExit: false, exited: false, exit, resolveExit, pending: new Map() };
      const active = instance;
      child = active;
      spawned.on('spawn', () => { active.pid = spawned.pid; });
      spawned.stdout?.on('data', (buffer: Buffer) => process.stdout.write('[tud-sync-worker] ' + buffer.toString()));
      spawned.stderr?.on('data', (buffer: Buffer) => process.stderr.write('[tud-sync-worker] ' + buffer.toString()));
      spawned.on('message', data => handleMessage(active, data));
      spawned.on('error', error => {
        console.error('[tud-desktop] sync worker fatal error:', { pid: active.pid, error });
        void terminate(active, error).catch(err => console.error('[tud-desktop] sync worker termination failed:', err));
      });
      const onExit = (code: number | null) => {
        if (active.exited) return;
        active.exited = true;
        active.ready = false;
        const error = active.terminalError ?? new Error('sync worker exited (' + (code ?? 'null') + ')');
        console[active.expectedExit ? 'log' : 'warn']('[tud-desktop] sync worker exited:', {
          pid: active.pid, code, expected: active.expectedExit, pending: active.pending.size, restarts: crashRestarts,
        });
        active.rejectReady?.(error);
        rejectAll(active, error);
        active.resolveExit();
        if (child !== active) return;
        child = null;
        if (!active.expectedExit && !stopping && generation === token && lastDataDir && crashRestarts < 5) {
          crashRestarts++;
          const dir = lastDataDir;
          restartTimer = setTimeout(() => {
            restartTimer = null;
            if (!stopping && generation === token && lastDataDir === dir && !child && !starting) void startSyncWorker(dir);
          }, 500);
        }
      };
      spawned.on('exit', onExit);
      spawned.on('close', onExit);
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); spawned.removeListener('message', onReady); active.rejectReady = undefined; };
        const fail = (error: Error) => { cleanup(); reject(error); };
        const onReady = (data: unknown) => {
          if ((data as SyncWorkerResponse)?.type !== 'ready' || child !== active || active.expectedExit || generation !== token) return;
          active.ready = true;
          cleanup(); resolve();
        };
        const timer = setTimeout(() => fail(new Error('sync worker ready timeout')), START_TIMEOUT_MS);
        active.rejectReady = fail;
        spawned.on('message', onReady);
        try { spawned.send({ type: 'init', dataDir } satisfies SyncWorkerRequest, error => { if (error) fail(error); }); }
        catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      });
      if (child !== active || stopping || generation !== token) return false;
      console.log('[tud-desktop] sync worker ready pid=' + (active.pid ?? '?'));
      return true;
    } catch (error) {
      if (!stopping && generation === token) console.warn('[tud-desktop] sync worker failed to start:', error instanceof Error ? error.message : error);
      if (instance && child === instance && !instance.exited) {
        // Do not fall back to a second writer unless this process has really exited.
        await terminate(instance, error instanceof Error ? error : new Error(String(error)));
      }
      if (child?.expectedExit && !child.exited) throw error;
      return false;
    }
  })();
  const shared = operation.finally(() => { if (starting === shared) starting = null; });
  starting = shared;
  return shared;
}

export function invalidateSyncWorkerCursors(): void {
  if (!child?.ready || child.expectedExit) return;
  const active = child;
  const fail = (error: Error) => { void terminate(active, error).catch(err => console.error('[tud-desktop] sync worker termination failed:', err)); };
  try { active.process.send({ type: 'invalidateCursors' } satisfies SyncWorkerRequest, error => { if (error) fail(error); }); }
  catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
}

export async function stopSyncWorker(): Promise<void> {
  stopping = true;
  generation++;
  lastDataDir = null;
  cancelRestart();
  const active = child;
  starting = null;
  if (active) await terminate(active, new Error('sync worker stopped'));
}

export async function runSyncViaWorker(reason: string, source?: string): Promise<SyncResult[]> {
  if (!isSyncWorkerRunning()) {
    if (!lastDataDir || !await startSyncWorker(lastDataDir)) throw new Error('sync worker is not running');
  }
  const active = child;
  if (!active?.ready || active.expectedExit) throw new Error('sync worker is not running');
  const id = nextId++;
  return new Promise<SyncResult[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      // The caller may recover disk state only after this writer has exited.
      void terminate(active, new Error('sync worker timed out after ' + SYNC_TIMEOUT_MS + 'ms')).catch(error => {
        console.error('[tud-desktop] sync worker termination failed:', error instanceof Error ? error.message : error);
      });
    }, SYNC_TIMEOUT_MS);
    active.pending.set(id, {
      resolve: results => { clearTimeout(timer); resolve(results); },
      reject: error => { clearTimeout(timer); reject(error); },
    });
    const fail = (error: unknown) => {
      if (!active.pending.has(id)) return;
      active.pending.delete(id); clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    try { active.process.send({ type: 'runSync', id, reason, source } satisfies SyncWorkerRequest, error => { if (error) fail(error); }); }
    catch (error) { fail(error); }
  });
}
