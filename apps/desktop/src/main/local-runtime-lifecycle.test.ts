import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

test('a failed worker stop cannot masquerade as an active runtime during update recovery', async (t) => {
  let watcherCount = 0, writerAlive = false, failStop = false, writersStarted = 0;
  const config = { deviceId: 'fixture', statsSince: '2026-01-01T00:00:00.000Z', lastSyncAt: null };
  const noOp = async () => {};
  const core = {
    POLL_INTERVAL_MS: 60_000, HEARTBEAT_INTERVAL_MS: 30_000,
    createPollBackoff: () => ({ currentDelayMs: () => 60_000, reset() {}, noteRound: () => 60_000 }),
    resolveDataDir: () => 'fixture', isIsolatedDevRuntime: () => true,
    loadConfig: async () => ({ dir: 'fixture', config }),
    touchStatsSince: noOp, claimRuntimeOwner: async () => ({ role: 'owner' }),
    touchRuntimeHeartbeat: noOp, clearRuntimeHeartbeat: noOp, releaseRuntimeOwner: noOp,
    evictRuntimeKind: noOp, setupClaudeHook: async () => ({ hookOk: false }), setupCodexHook: async () => ({ hookOk: false }),
    resolvePricingRefreshConfig: () => ({ url: null }), startPricingRefresh: () => Object.assign(() => {}, { ready: Promise.resolve(false) }),
    resolveLocalCollectSince: () => config.statsSince,
    BucketStore: class { reload = noOp; refresh = noOp; getRows = () => []; },
    createAggregateCache: async () => ({ rebuildFromRows: noOp }),
    createApplyAfterSync: () => noOp, createLocalApiApp: () => ({}),
    watchRuntimeSignals: (deps: { runSyncOverride: unknown }) => {
      watcherCount++; return { runSync: deps.runSyncOverride, stop: () => { watcherCount--; } };
    },
    appendJsonLog: noOp, syncLogPath: () => 'unused', measureCpuPhase: (_a: unknown, _b: unknown, _c: unknown, action: () => unknown) => action(),
    localDateNow: () => '2026-10-20',
  };
  const worker = {
    startSyncWorker: async () => { if (!writerAlive) { writerAlive = true; writersStarted++; } return true; },
    runSyncViaWorker: async () => [],
    stopSyncWorker: async () => { if (writerAlive && failStop) throw new Error('sync worker did not exit after termination'); writerAlive = false; },
    invalidateSyncWorkerCursors() {},
  };
  const code = transformSync(readFileSync(join(__dirname, '../../src/main/local-runtime.ts'), 'utf8'), { loader: 'ts', format: 'cjs', target: 'node22' }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'console', code)((id: string) => {
    if (id === 'quotern-core') return core;
    if (id === './sync-worker-host') return worker;
    if (id === './evict-cli-autostart') return { evictCliAutostart: noOp };
    if (id === './quota-runtime') return { getQuotaRuntimeState: () => null };
    if (id === './sync-recovery') return require('./sync-recovery.js');
    return require(id);
  }, module, module.exports, { log() {}, warn() {}, error() {} });
  const runtime = module.exports as { startLocalRuntime(): Promise<unknown>; stopLocalRuntime(): Promise<void> };
  t.after(async () => { failStop = false; await runtime.stopLocalRuntime(); });
  await runtime.startLocalRuntime();
  for (let index = 0; index < 12; index++) await Promise.resolve();
  assert.equal(watcherCount, 1); assert.equal(writersStarted, 1);
  failStop = true;
  await assert.rejects(runtime.stopLocalRuntime(), /did not exit/);
  assert.equal(watcherCount, 0);
  await assert.rejects(runtime.startLocalRuntime(), /did not exit/);
  assert.equal(writersStarted, 1);
  // The old writer eventually exits; a later recovery must rewire scheduling.
  writerAlive = false;
  await runtime.startLocalRuntime();
  assert.equal(watcherCount, 1); assert.equal(writersStarted, 2);
});
