import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { loadConfig } from '../src/config.js';
import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore, runSync } from '../src/server/state.js';

function isolateConfigHome(dir: string, t: TestContext): void {
  const previous = process.env.QUOTERN_CONFIG_HOME;
  process.env.QUOTERN_CONFIG_HOME = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.QUOTERN_CONFIG_HOME;
    else process.env.QUOTERN_CONFIG_HOME = previous;
  });
}

test('local panel exposes local usage without cloud requests', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-local-only-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  isolateConfigHome(dir, t);
  const { config } = await loadConfig(dir);
  config.statsSince = new Date(Date.now() - 86_400_000).toISOString();
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected network request'); });
  const bucketStore = new BucketStore();
  bucketStore.apply([{ source: 'codex', model: 'gpt-5', project: 'local-test', hour_start: new Date().toISOString(), input_tokens: 100, output_tokens: 50, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 150, conversation_count: 1 }]);
  const deps = { dataDir: dir, getConfig: () => config, bucketStore };
  const app = createLocalApiApp(deps);
  const view = await (await app.request('/functions/tud-config')).json();
  assert.equal(view.success, true);
  assert.equal(view.data.deviceId, config.deviceId);
  for (const path of ['tud-leaderboard', 'tud-leaderboard-overview', 'tud-calibrate-devices', 'tud-calibrate-preview']) {
    assert.equal((await app.request('/functions/' + path)).status, 404, path);
  }
  assert.equal((await app.request('/functions/tud-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serverPort: 9000 }) })).status, 404);
  const result = await runSync(deps, '__no_source__');
  assert.equal(result.ok, true);
  const summary = await app.request('/functions/tud-account-usage-summary');
  assert.equal(summary.status, 200);
  assert.equal((await summary.json()).data.totalTokens, 150);
  assert.equal(network.mock.callCount(), 0);
});
