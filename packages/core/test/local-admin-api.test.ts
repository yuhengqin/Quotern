import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore } from '../src/server/state.js';
import { getModelPricingRates, resetPricingRuntime } from '../src/pricing/index.js';
import { AggregateCache } from '../src/aggregate-cache.js';
import type { TudConfig } from '../src/types.js';
import { withDataTransaction } from '../src/data-transaction.js';
import { appendBuckets } from '../src/queue/index.js';
import { claudeRequestPricingFact } from '../src/parsers/claude.js';
import { localEvidence, metricsFromBucket } from '../src/local-metrics.js';
import { readUsageReport } from '../src/usage-report.js';
import { createDataBackup, restoreDataBackup } from '../src/backup.js';

test('old logs preview freezes only missing usage and importing it survives restart and normal collection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-usage-recovery-'));
  try {
    const hour = '2026-01-02T00:00:00.000Z';
    const usage = { input_tokens: 5, output_tokens: 7 };
    const config = { statsSince: '2026-02-01T00:00:00.000Z' } as TudConfig;
    await writeFile(join(dir, 'config.json'), JSON.stringify(config));
    const base = { hour_start: hour, source: 'claude', model: 'claude-sonnet-4-6', project: 'fixture', collector: 'claude-code-cli', input_tokens: 5, output_tokens: 7, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 12, conversation_count: 1, local_metrics: localEvidence(1, true, true, true) };
    await appendBuckets(dir, [{ ...base, pricing_requests: [claudeRequestPricingFact('known', hour, usage)] }]);
    const store = new BucketStore();
    const deps = { dataDir: dir, bucketStore: store, getConfig: () => config, usageRecoveryEnabled: true };
    const app = createLocalApiApp(deps);
    const route = 'http://localhost/functions/tud-local-admin/usage-recovery';
    const get = await app.request(route);
    assert.equal(get.status, 200);
    const { token } = (await get.json()).data;
    const post = (value: unknown) => app.request(route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Quotern-Local-Admin': token }, body: JSON.stringify(value) });
    const content = ['known', 'new'].map(id => JSON.stringify({ type: 'assistant', cwd: 'C:/fixture', timestamp: hour, message: { id, usage, model: base.model, content: 'private chat text' } })).join('\n');
    const preview = async () => {
      const result = await post({ action: 'preview', files: [content] });
      assert.equal(result.status, 200);
      return (await result.json()).data;
    };
    const plan = await preview();
    assert.equal(plan.tokens, 12);
    assert.equal(plan.duplicate, 1);
    assert.equal(store.getRows().length, 0);
    assert.equal((await post({ action: 'apply', id: plan.id })).status, 200);
    const total = (rows: ReturnType<BucketStore['getRows']>) => rows.reduce((sum, row) => sum + row.total_tokens, 0);
    assert.equal(total(store.getRows()), 24);
    assert.equal(store.getRows().reduce((sum, row) => sum + (metricsFromBucket(row).requestCount ?? 0), 0), 2);
    assert.equal((await post({ action: 'apply', id: plan.id })).status, 200);
    const reportQuery = { fromDate: '2026-01-02', toDate: '2026-01-02' };
    const httpReport = await app.request('http://localhost/functions/tud-usage-report?fromDate=2026-01-02&toDate=2026-01-02');
    assert.equal((await httpReport.json()).data.summary.tokens, 24);
    assert.equal((await readUsageReport(dir, reportQuery)).summary.tokens, 24);
    assert.equal((await preview()).tokens, 0);
    const restarted = new BucketStore();
    await restarted.reload(dir, config.statsSince);
    assert.equal(total(restarted.getRows()), 24);
    assert.equal(restarted.reportSince(config.statsSince), hour);
    assert.equal(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')).localCollectSince, undefined);
    restarted.apply([{ ...base, total_tokens: 24, conversation_count: 2, input_tokens: 10, output_tokens: 14, pricing_requests: ['known', 'new'].map(id => claudeRequestPricingFact(id, hour, usage)) }]);
    assert.equal(total(restarted.getRows()), 24);
    assert.doesNotMatch(await readFile(join(dir, 'usage-recovery.json'), 'utf8'), /private chat text/);
    const target = join(dir, 'restored');
    await restoreDataBackup(await createDataBackup(dir), target);
    assert.equal((await readUsageReport(target, reportQuery)).summary.tokens, 24);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('old log plans reject changed evidence and skip dates with overlapping legacy totals', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-recovery-conflict-'));
  try {
    const hour = '2026-01-02T00:00:00.000Z', usage = { input_tokens: 9, output_tokens: 3 };
    const config = { statsSince: '2026-01-01T00:00:00.000Z' } as TudConfig;
    const store = new BucketStore();
    let owner = true;
    const app = createLocalApiApp({ dataDir: dir, bucketStore: store, getConfig: () => config, usageRecoveryEnabled: () => owner });
    const url = 'http://localhost/functions/tud-local-admin/usage-recovery';
    const { token } = (await (await app.request(url)).json()).data;
    const post = (value: unknown) => app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Quotern-Local-Admin': token }, body: JSON.stringify(value) });
    const file = JSON.stringify({ type: 'assistant', timestamp: hour, message: { id: 'example', usage, model: 'claude-sonnet-4-6' } });
    const unsupported = '{"type":"session_meta","payload":{"id":"codex-fixture"}}';
    const makePreview = async () => (await (await post({ action: 'preview', files: [file, unsupported] })).json()).data;
    const plan = await makePreview();
    assert.equal(plan.tokens, 12);
    assert.equal(plan.skippedFiles, 1);
    owner = false;
    assert.equal((await post({ action: 'apply', id: plan.id })).status, 409);
    owner = true;
    await appendBuckets(dir, [{ hour_start: hour, source: 'claude', model: 'another-model', project: 'other', ...usage, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 12, conversation_count: 1 }]);
    const conflict = await post({ action: 'apply', id: plan.id });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).message, 'RECOVERY_PREVIEW_CHANGED');
    const next = await makePreview();
    assert.equal(next.id, null);
    assert.equal(next.uncertain, 1);
    await assert.rejects(readFile(join(dir, 'usage-recovery.json')), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('local administration blocks cross-origin and rebound hosts, requires write token and rejects stale prices', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-local-admin-'));
  try {
    let changes = 0;
    const app = createLocalApiApp({ dataDir: dir, bucketStore: new BucketStore(), getConfig: () => ({} as TudConfig), onPricingChange: () => changes++ });
    const url = 'http://localhost/functions/tud-local-admin/pricing';
    assert.equal((await app.request(url, { headers: { Origin: 'https://evil.invalid' } })).status, 403);
    assert.equal((await app.request('http://evil.invalid/functions/tud-local-admin/pricing')).status, 403);
    assert.equal((await app.fetch(new Request(url), { quoternRemoteAddress: '192.0.2.5' })).status, 403);
    const read = await app.request(url), state = (await read.json()).data;
    assert.equal(read.headers.get('cache-control'), 'no-store');
    const body = JSON.stringify({ revision: state.revision, model: 'custom-model', rates: { input: 0, output: 4 } });
    assert.equal((await app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 403);
    const headers = { 'Content-Type': 'application/json', 'X-Quotern-Local-Admin': state.token };
    assert.equal((await app.request(url, { method: 'POST', headers, body })).status, 200);
    assert.equal(getModelPricingRates('custom-model')!.input, 0);
    assert.equal(changes, 1);
    assert.equal((await app.request(url, { method: 'POST', headers, body })).status, 409);
    assert.equal((await app.request(url, { method: 'POST', headers, body: '{}' })).status, 400);
    assert.equal((await app.request(url, { method: 'POST', headers, body: JSON.stringify({ revision: state.revision, model: 'custom-model', rates: { input: -1 } }) })).status, 409);
  } finally { await rm(dir, { recursive: true, force: true }); resetPricingRuntime(); }
});

test('backup API validates before exclusive restore and returns no source configuration secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-backup-api-'));
  try {
    await writeFile(join(root, 'config.json'), JSON.stringify({ statsSince: '2026-01-01', deviceId: 'private-device', pricing: { url: 'https://credential@example.invalid' } }));
    const app = createLocalApiApp({ dataDir: root, bucketStore: new BucketStore(), getConfig: () => ({} as TudConfig) });
    const url = 'http://localhost/functions/tud-local-admin/backup';
    const state = (await (await app.request(url)).json()).data;
    const headers = { 'Content-Type': 'application/json', 'X-Quotern-Local-Admin': state.token };
    const create = await app.request(url, { method: 'POST', headers, body: '{"action":"create"}' });
    assert.equal(create.status, 200);
    const { backup } = (await create.json()).data;
    assert.equal(JSON.stringify(backup).includes('credential'), false);
    assert.equal((await app.request(url, { method: 'POST', headers, body: JSON.stringify({ action: 'verify', backup }) })).status, 200);
    const result = await app.request(url, { method: 'POST', headers, body: JSON.stringify({ action: 'restore', backup, target: join(root, 'restored') }) });
    assert.equal(result.status, 200);
    assert.equal((await app.request(url, { method: 'POST', headers, body: JSON.stringify({ action: 'restore', backup, target: root }) })).status, 400);
    assert.equal((await app.request(url, { method: 'POST', headers, body: JSON.stringify({ action: 'restore', backup: {}, target: join(root, 'invalid') }) })).status, 400);
    const protectedResult = await app.request(url, { method: 'POST', headers, body: JSON.stringify({ action: 'restore-protected', backup, target: root }) });
    assert.equal(protectedResult.status, 200);
    const protectedData = (await protectedResult.json()).data;
    assert.equal(protectedData.restore.ok, false);
    assert.equal(protectedData.restore.code, 'BACKUP_TARGET_EXISTS');
    assert.equal(JSON.parse(await readFile(protectedData.protection.path, 'utf8')).schemaVersion, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('backup API rejects overlapping writes without a retryable 503', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-backup-busy-'));
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  try {
    await writeFile(join(root, 'config.json'), '{"statsSince":"2026-01-01"}');
    const app = createLocalApiApp({ dataDir: root, bucketStore: new BucketStore(), getConfig: () => ({} as TudConfig) });
    const url = 'http://localhost/functions/tud-local-admin/backup';
    const state = (await (await app.request(url)).json()).data;
    const headers = { 'Content-Type': 'application/json', 'X-Quotern-Local-Admin': state.token };
    const lock = withDataTransaction(root, async () => { entered(); await gate; });
    await started;
    const first = app.request(url, { method: 'POST', headers, body: '{"action":"create"}' });
    const unlockTimeout = setTimeout(release, 1000);
    await new Promise(resolve => setTimeout(resolve, 30));
    const second = await app.request(url, { method: 'POST', headers, body: '{"action":"create"}' });
    clearTimeout(unlockTimeout);
    release(); await lock;
    const completed = await first;
    assert.equal(second.status, 409);
    assert.equal((await second.json()).message, 'BACKUP_BUSY');
    assert.equal(completed.status, 200);
  } finally { release?.(); await rm(root, { recursive: true, force: true }); }
});

test('background pricing acknowledges the saved revision, reports failure and retries without rewriting prices', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-price-job-'));
  const gate: { release?: () => void } = {};
  try {
    const cache = new AggregateCache(dir);
    let fail = true, calls = 0;
    cache.rebuildFromRows = async () => { calls++; await new Promise<void>(resolve => { gate.release = resolve; }); if (fail) throw new Error('disk unavailable'); };
    const app = createLocalApiApp({ dataDir: dir, bucketStore: new BucketStore(), aggregateCache: cache, getConfig: () => ({} as TudConfig) });
    const url = 'http://localhost/functions/tud-local-admin/pricing';
    const state = (await (await app.request(url)).json()).data;
    assert.equal(state.capabilities.backgroundRecalculation, true);
    const headers = { 'Content-Type': 'application/json', 'X-Quotern-Local-Admin': state.token };
    const save = await app.request(url, { method: 'POST', headers, body: JSON.stringify({ revision: state.revision, model: 'custom-model', rates: { input: 0 }, background: true }) });
    assert.equal(save.status, 200);
    const saved = (await save.json()).data;
    assert.equal(saved.document.models['custom-model'].input, 0);
    assert.equal(saved.job.status, 'running');
    assert.notEqual(saved.revision, state.revision);
    while (!gate.release) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await app.request(url, { method: 'POST', headers, body: JSON.stringify({ revision: saved.revision, model: 'custom-model', rates: { input: 3 }, background: true }) })).status, 409);
    gate.release();
    let job;
    do { await new Promise(resolve => setTimeout(resolve, 5)); job = (await (await app.request(`${url}/recalculation`)).json()).data.job; } while (job.status === 'running');
    assert.equal(job.status, 'failed');
    fail = false; Object.assign(gate, { release: undefined });
    const retry = await app.request(`${url}/recalculation`, { method: 'POST', headers, body: JSON.stringify({ revision: saved.revision }) });
    assert.equal(retry.status, 200);
    while (!gate.release) await new Promise(resolve => setTimeout(resolve, 5));
    gate.release();
    do { await new Promise(resolve => setTimeout(resolve, 5)); job = (await (await app.request(`${url}/recalculation`)).json()).data.job; } while (job.status === 'running');
    assert.equal(job.status, 'succeeded');
    assert.equal(calls, 2);
    const originalJob = (await (await app.request(`${url}/recalculation?id=${saved.job.id}`)).json()).data.job;
    assert.equal(originalJob.id, saved.job.id);
    assert.equal(originalJob.status, 'failed', 'another window must still be able to query its own completed job');
    assert.equal((await (await app.request(`${url}/recalculation?id=expired-job`)).json()).data.job, null);
    assert.equal((await (await app.request(url)).json()).data.revision, saved.revision);
    assert.equal((await app.request(`${url}/recalculation`, { method: 'POST', headers, body: JSON.stringify({ revision: state.revision }) })).status, 409);
  } finally { gate.release?.(); await rm(dir, { recursive: true, force: true }); resetPricingRuntime(); }
});
