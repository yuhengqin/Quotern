import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerAccountLaunchApi } from '../src/server/account-launch-api.js';
import { DEFAULT_QUOTA_PREFERENCES, type QuotaState } from '../src/quota/shared/quota.js';

test('launch actions require local peer and token, use configured directories, and preserve selection on invalid writes', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'quotern-launch-api-')); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const directory = join(dataDir, 'work'); await mkdir(directory);
  const state: QuotaState = { providers: [], notice: null, preferences: { ...DEFAULT_QUOTA_PREFERENCES, profiles: [{ id: 'work', provider: 'claude', label: 'Work', directory, enabled: true }] } };
  const launched: unknown[] = [];
  const app = new Hono(); registerAccountLaunchApi(app, { dataDir, quotaDirectory: join(dataDir, 'quota'), getState: () => state, launch: async (...args) => { launched.push(args); } });
  const url = 'http://localhost/functions/tud-account-launch';
  for (const request of [app.request(url, { headers: { Origin: 'https://attacker.example' } }), app.request(url, { headers: { Host: 'attacker.example' } }), app.request(url, {}, { quoternRemoteAddress: '192.0.2.1' }), app.request(url.replace('localhost', '192.0.2.1'))]) assert.equal((await request).status, 403);
  const view = (await (await app.request(url)).json()).data;
  const post = (body: unknown, token = view.token) => app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Quotern-Account-Action': token }, body: JSON.stringify(body) });
  assert.equal((await post({ action: 'launch', provider: 'claude', profileId: 'work' }, '')).status, 403);
  assert.equal((await post({ action: 'launch', provider: 'claude', profileId: 'work', directory: '/attacker' })).status, 400);
  assert.equal((await post({ action: 'launch', provider: 'claude', profileId: 'work' })).status, 200);
  assert.deepEqual(launched, [['claude', { directory }]]);
  const saved = (await (await post({ action: 'default', provider: 'claude', profileId: 'work', revision: view.preferences.revision })).json()).data;
  assert.equal(saved.selected.claude, 'work');
  assert.equal((await post({ action: 'default', provider: 'claude', profileId: null, revision: view.preferences.revision })).status, 409);
  assert.equal((await (await app.request(url)).json()).data.selected.claude, 'work');
});
