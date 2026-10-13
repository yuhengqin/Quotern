/**
 * Electron utilityProcess entry: parsers / local sync live here so the
 * main process event loop (IPC + window) is not blocked by JSONL / SQLite.
 */
import { Worker } from 'node:worker_threads';

import {
  appendJsonLog,
  createSyncRunner,
  loadConfig,
  resetCursorsCache,
  syncLogPath,
  type SyncResult,
  type TudConfig,
} from 'quotern-core';
import type { SyncWorkerRequest, SyncWorkerResponse } from './sync-worker-protocol';
import { restoreNativeTrapHandler } from './native-crash-signals';

restoreNativeTrapHandler();

process.title = 'tud-sync-worker';

/**
 * 硬看门狗：主线程事件循环连续 5 分钟无法运行定时器时 SIGKILL 本进程。
 *
 * 问题：原生层故障（如 #187 zstd SIGTRAP）可能使事件循环自旋卡死，进程内
 * 定时器永不触发，宿主 crashRestarts 因进程未退出而无法生效。
 * 做法：看门狗跑在独立 worker 线程；主线程每 30s 喂活一次。超时未喂则
 * SIGKILL，将僵死转为普通崩溃，由宿主按既有逻辑重启。正常长同步只要
 * 事件循环仍可调度喂活，不会被终止。
 */
const WATCHDOG_FEED_MS = 30_000;
const WATCHDOG_CHECK_MS = 15_000;
const WATCHDOG_TIMEOUT_MS = 5 * 60_000;

function startWatchdog(): void {
  const workerSrc = `
const { parentPort } = require('node:worker_threads');
let lastFeedAt = Date.now();
parentPort.on('message', () => { lastFeedAt = Date.now(); });
setInterval(() => {
  if (Date.now() - lastFeedAt > ${WATCHDOG_TIMEOUT_MS}) {
    process.kill(process.pid, 'SIGKILL');
  }
}, ${WATCHDOG_CHECK_MS});
`;
  try {
    const watchdog = new Worker(workerSrc, { eval: true });
    watchdog.unref();
    setInterval(() => watchdog.postMessage('feed'), WATCHDOG_FEED_MS).unref();
  } catch {
    // 启动失败仅失去僵死自愈，同步逻辑不受影响。
  }
}

interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!parentPort) {
  process.stderr.write('[tud-sync-worker] missing process.parentPort; exiting\n');
  process.exit(1);
}

let runSyncFn: ((reason: string, source?: string) => Promise<SyncResult[]>) | null = null;
let config: TudConfig | null = null;
let dataDir = '';

function post(msg: SyncWorkerResponse): void {
  parentPort!.postMessage(msg);
}

parentPort.on('message', (event) => {
  void handle(event.data as SyncWorkerRequest);
});

async function handle(msg: SyncWorkerRequest): Promise<void> {
  if (msg.type === 'init') {
    dataDir = msg.dataDir;
    const loaded = await loadConfig(dataDir);
    config = loaded.config;
    const { runSync } = createSyncRunner({
      dataDir,
      getConfig: () => config!,
      setConfig: (next) => {
        config = next;
      },
      loadConfig,
    });
    runSyncFn = runSync;
    await appendJsonLog(syncLogPath(dataDir), {
      event: 'cpu_phase',
      phase: 'worker_ready',
      pid: process.pid,
      role: 'sync-worker',
      wallMs: 0,
      cpuMs: 0,
    });
    process.stdout.write(`[tud-sync-worker] ready pid=${process.pid}\n`);
    startWatchdog();
    post({ type: 'ready', pid: process.pid });
    return;
  }

  if (msg.type === 'invalidateCursors') {
    // Main owns cursors.json (range expansion clears it) but parsers run here.
    // Without this the worker keeps serving its cached offsets, reports "no new
    // events" and the widened window never backfills.
    if (dataDir) resetCursorsCache(dataDir);
    return;
  }

  if (msg.type === 'stop') {
    runSyncFn = null;
    return;
  }

  if (msg.type === 'runSync') {
    if (!runSyncFn) {
      post({ type: 'syncError', id: msg.id, error: 'sync worker not initialized' });
      return;
    }
    try {
      const results = await runSyncFn(msg.reason, msg.source);
      post({ type: 'syncDone', id: msg.id, results });
    } catch (err) {
      post({
        type: 'syncError',
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
