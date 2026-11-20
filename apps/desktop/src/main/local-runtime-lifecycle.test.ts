import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

test('a failed worker stop cannot masquerade as an active runtime during update recovery', async (t) => {
  let watcherCount = 0, writerAlive = false, failStop = false, writersStarted = 0;
  const mainRequests: string[] = [], analysisRequests: string[] = [];
  let analysisStops = 0, failAnalysis = false;
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
    getPricingSnapshot: () => ({ builtin: { exact: {} }, overlay: null }), getPricingFingerprint: () => 'fixture',
    BucketStore: class { reload = noOp; refresh = noOp; getRows = () => []; getRevision = () => 1; reportSince = (since: string) => since; },
    createAggregateCache: async () => ({ rebuildFromRows: noOp }),
    createApplyAfterSync: () => noOp, createLocalApiApp: () => ({ request: async (url: string) => { mainRequests.push(url); return Response.json({ success: true, data: 'main' }); } }),
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
    if (id === './session-analysis-host') return {
      runSessionAnalysisRequest: async (url: string) => { analysisRequests.push(url); if (failAnalysis) throw new Error('analysis failed'); return { status: 200, body: { success: true, data: 'analysis' } }; },
      stopSessionAnalysisWorker: async () => { analysisStops++; },
    };
    if (id === './session-analysis-protocol') return require('./session-analysis-protocol.js');
    if (id === './evict-cli-autostart') return { evictCliAutostart: noOp };
    if (id === './runtime-quota') return {
      getQuotaRuntimeState: () => null,
      getQuotaBackupDirectory: () => 'fixture/quota',
    };
    if (id === './sync-recovery') return require('./sync-recovery.js');
    return require(id);
  }, module, module.exports, { log() {}, warn() {}, error() {} });
  const runtime = module.exports as { startLocalRuntime(): Promise<unknown>; stopLocalRuntime(): Promise<void>; localApiRequest(path: string, init?: { method?: string }): Promise<{ status: number; body: unknown }> };
  t.after(async () => { failStop = false; await runtime.stopLocalRuntime(); });
  await runtime.startLocalRuntime();
  for (let index = 0; index < 12; index++) await Promise.resolve();
  assert.equal(watcherCount, 1); assert.equal(writersStarted, 1);
  assert.deepEqual((await runtime.localApiRequest('/functions/tud-session-activity?days=7')).body, { success: true, data: 'analysis' });
  assert.equal(analysisRequests.length, 1); assert.equal(mainRequests.length, 0);
  await runtime.localApiRequest('/functions/tud-session-activity-not-a-query');
  await runtime.localApiRequest('/functions/tud-session-activity', { method: 'POST' });
  assert.equal(mainRequests.length, 2, 'only exact GET analysis routes may leave the main API');
  failAnalysis = true;
  assert.equal((await runtime.localApiRequest('/functions/tud-session-list')).status, 500);
  assert.equal(mainRequests.length, 2, 'analysis failure must not fall back to heavy main-thread work');
  failAnalysis = false;
  failStop = true;
  const stopping = runtime.stopLocalRuntime();
  const stopped = stopping.catch(error => error);
  const beforeStopRequests = analysisRequests.length;
  assert.equal((await runtime.localApiRequest('/functions/tud-session-list')).status, 503, 'stopping must reject new analysis requests');
  assert.equal(analysisRequests.length, beforeStopRequests);
  assert.match((await stopped).message, /did not exit/);
  assert.equal(watcherCount, 0);
  assert.ok(analysisStops > 0, 'stopping runtime must also reclaim its analysis process');
  await assert.rejects(runtime.startLocalRuntime(), /did not exit/);
  assert.equal(writersStarted, 1);
  // The old writer eventually exits; a later recovery must rewire scheduling.
  writerAlive = false;
  await runtime.startLocalRuntime();
  assert.equal(watcherCount, 1); assert.equal(writersStarted, 2);
});

test('an analysis request waiting for cold startup cannot start a process after runtime was stopped', async t => {
  let entered!: () => void, release!: () => void, analysisRequests = 0;
  const loading = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const noOp = async () => {};
  const config = { deviceId: 'fixture', statsSince: '2026-01-01T00:00:00Z' };
  const core = {
    POLL_INTERVAL_MS: 60000, HEARTBEAT_INTERVAL_MS: 30000, localDateNow: () => '2026-10-20',
    createPollBackoff: () => ({ currentDelayMs: () => 60000, reset() {}, noteRound: () => 60000 }),
    resolveDataDir: () => 'fixture', isIsolatedDevRuntime: () => true,
    loadConfig: async () => { entered(); await gate; return { dir: 'fixture', config }; },
    touchStatsSince: noOp, claimRuntimeOwner: async () => ({ role: 'owner' }), releaseRuntimeOwner: noOp,
    touchRuntimeHeartbeat: noOp, clearRuntimeHeartbeat: noOp, evictRuntimeKind: noOp,
    setupClaudeHook: async () => ({ hookOk: false }), setupCodexHook: async () => ({ hookOk: false }),
    resolvePricingRefreshConfig: () => ({ url: null }), startPricingRefresh: () => Object.assign(() => {}, { ready: Promise.resolve(false) }),
    resolveLocalCollectSince: () => config.statsSince, getPricingFingerprint: () => 'fixture', getPricingSnapshot: () => ({ builtin: { exact: {} }, overlay: null }),
    BucketStore: class { reload = noOp; getRows = () => []; getRevision = () => 1; reportSince = (since: string) => since; },
    createAggregateCache: async () => ({ rebuildFromRows: noOp }), createApplyAfterSync: () => noOp,
    createLocalApiApp: () => ({ request: async () => Response.json({ success: true, data: null }) }),
    watchRuntimeSignals: () => ({ runSync: async () => [], stop() {} }), appendJsonLog: noOp, syncLogPath: () => 'unused',
  };
  const code = transformSync(readFileSync(join(__dirname, '../../src/main/local-runtime.ts'), 'utf8'), { loader: 'ts', format: 'cjs', target: 'node22' }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'console', code)((id: string) => {
    if (id === 'quotern-core') return core;
    if (id === './sync-worker-host') return { startSyncWorker: async () => true, stopSyncWorker: noOp, runSyncViaWorker: async () => [], invalidateSyncWorkerCursors() {} };
    if (id === './session-analysis-host') return { runSessionAnalysisRequest: async () => { analysisRequests++; return { status: 200, body: null }; }, stopSessionAnalysisWorker: noOp };
    if (id === './session-analysis-protocol') return require('./session-analysis-protocol.js');
    if (id === './evict-cli-autostart') return { evictCliAutostart: noOp };
    if (id === './runtime-quota') return { getQuotaRuntimeState: () => null, getQuotaBackupDirectory: () => 'fixture/quota' };
    if (id === './sync-recovery') return require('./sync-recovery.js');
    return require(id);
  }, module, module.exports, { log() {}, warn() {}, error() {} });
  const runtime = module.exports as { localApiRequest(path: string): Promise<{ status: number }>; stopLocalRuntime(): Promise<void> };
  t.after(async () => { release(); await runtime.stopLocalRuntime(); });
  const pending = runtime.localApiRequest('/functions/tud-session-list');
  await loading; await runtime.stopLocalRuntime(); release();
  assert.equal((await pending).status, 503);
  assert.equal(analysisRequests, 0);
});
