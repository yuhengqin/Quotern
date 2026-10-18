import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore } from '../src/server/state.js';
import type { TudConfig } from '../src/types.js';

test('local quota API reads and refreshes the host runtime without exposing credentials', async () => {
  const calls: unknown[] = [];
  const state = { providers: [], preferences: { thresholdAlerts: false, resetAlerts: false, showSparkline: true, paceModel: 'uniform' as const, channels: {} }, notice: null };
  const quota = {
    getState: () => state,
    async refresh(reason: string, id?: string) { calls.push([reason, id]); return state; },
    async setPreferences(patch: unknown) { calls.push(patch); return state; },
  };
  const deps = { dataDir: 'unused', bucketStore: new BucketStore(), getConfig: () => ({} as TudConfig), quota };
  const app = createLocalApiApp(deps);
  const path = '/functions/tud-quota';
  const response = await app.request(path);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { success: true, message: 'ok', data: state });
  assert.deepEqual(calls, [['interaction', undefined]]);
  const post = (suffix: string, body: unknown, origin = 'http://localhost:5194') => app.request(path + suffix, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
  });
  assert.equal((await post('/refresh', { provider: 'codex' })).status, 200);
  assert.deepEqual(calls.at(-1), ['manual', 'codex']);
  assert.equal((await post('/refresh', { provider: 'unknown' })).status, 400);
  assert.equal((await post('/refresh', { provider: 1 })).status, 400);
  assert.equal((await post('/preferences', { channels: { codex: false } })).status, 200);
  assert.deepEqual(calls.at(-1), { channels: { codex: false } });
  assert.equal((await post('/preferences', { showSparkline: 'yes' })).status, 400);
  assert.equal((await post('/refresh', {}, 'https://evil.example')).status, 403);
  assert.equal((await app.request(path, { headers: { Origin: 'null' } })).status, 403);
  assert.equal((await app.request(path + '/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
});

test('a host without quota support returns a bounded unavailable response', async () => {
  const app = createLocalApiApp({ dataDir: 'unused', bucketStore: new BucketStore(), getConfig: () => ({} as TudConfig) });
  const response = await app.request('/functions/tud-quota');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { success: false, message: 'QUOTA_UNAVAILABLE', data: null });
});
