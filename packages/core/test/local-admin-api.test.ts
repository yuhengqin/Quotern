import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore } from '../src/server/state.js';
import { getModelPricingRates, resetPricingRuntime } from '../src/pricing/index.js';
import { AggregateCache } from '../src/aggregate-cache.js';
import type { TudConfig } from '../src/types.js';

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
  } finally { await rm(root, { recursive: true, force: true }); }
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
