import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createQuotaRuntime, QuotaManager, parseQuotaServiceStatus } from '../src/quota/runtime.js';
import { openQuotaStore } from '../src/quota/readers/quota-store.js';
import { markQuotaIdentity } from '../src/quota/readers/quota-identity.js';
import { SUBSCRIPTION_CHANNELS } from '../src/quota/shared/subscription-channels.js';
import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore } from '../src/server/state.js';
import type { TudConfig } from '../src/types.js';

test('Node-only quota runtime registers all desktop channels without starting network reads', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'quotern-quota-runtime-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manager = await createQuotaRuntime({ directory, fetch: async () => { throw new Error('must not request before start'); } });
  t.after(() => manager.dispose());
  assert.deepEqual(manager.getState().providers.map(item => item.id), SUBSCRIPTION_CHANNELS.map(item => item.id));
  assert.equal(parseQuotaServiceStatus({ status: { indicator: 'none' } }), 'operational');
  assert.throws(() => parseQuotaServiceStatus({ status: { indicator: 'invented' } }));
});

test('HTTP manual refresh returns normalized quota and never returns raw account credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'quotern-quota-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let used = 25;
  const manager = new QuotaManager({ store: await openQuotaStore(directory), notify() {}, readers: [{
    id: 'codex', label: 'Codex', interval: 180,
    read: async () => markQuotaIdentity({ status: 'ready', hasAccount: true, planLabel: 'Plus', fetchedAt: Date.now() / 1000,
      fiveHour: { usedPercent: used, resetsAt: Date.now() / 1000 + 3600, windowDurationMins: 300 },
      accessToken: 'secret-token', accountId: 'private-account', email: 'private@example.test' }, 'private-account'),
  }] });
  t.after(() => manager.dispose());
  const app = createLocalApiApp({ dataDir: directory, bucketStore: new BucketStore(), getConfig: () => ({} as TudConfig), quota: manager });
  const refresh = () => app.request('/functions/tud-quota/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'codex' }) });
  const first = await refresh();
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.data.providers[0].windows[0].usedPercent, 25);
  assert.doesNotMatch(JSON.stringify(body), /secret-token|private-account|private@example|accessToken|accountId|email/);
  used = 40;
  assert.equal((await (await refresh()).json()).data.providers[0].windows[0].usedPercent, 40);
});
