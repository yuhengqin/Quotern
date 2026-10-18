import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore } from '../src/server/state.js';
import { localDateNow, addLocalDays } from '../src/timezone.js';
import type { TudConfig } from '../src/types.js';

test('read-only report endpoint scopes explanations to the selected date and sources', async () => {
  const today = localDateNow();
  const store = new BucketStore();
  store.apply(['codex', 'claude'].map((source) => ({
    hour_start: `${today}T04:00:00Z`, source, model: 'unlisted-test-model', project: 'Example',
    input_tokens: 100, output_tokens: 20, cached_input_tokens: 0, cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0, total_tokens: 120, conversation_count: 1,
  })));
  const config = { statsSince: '2020-01-01', localCollectSince: '2020-01-01' } as TudConfig;
  const app = createLocalApiApp({ dataDir: 'unused-report-test', getConfig: () => config, bucketStore: store, runSyncViaRunner: async () => { throw new Error('must not sync'); } });
  const response = await app.request(`/functions/tud-usage-report?fromDate=${today}&toDate=${today}&sources=codex`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.summary.tokens, 120);
  assert.equal(body.data.summary.costExplanation.defaultPricedTokens, 120);
  assert.equal(body.data.coverage.snapshot, 'runtime');
  for (const query of ['days=abc', 'days=0', 'period=sessions', 'sources=typo', `fromDate=${today}`, `fromDate=${today}&toDate=${addLocalDays(today, -1)}`, 'surprise=yes']) {
    assert.equal((await app.request(`/functions/tud-usage-report?${query}`)).status, 400, query);
  }
});

test('trend endpoint filters source and rejects invalid or ambiguous query dimensions', async () => {
  const today = localDateNow();
  const store = new BucketStore();
  store.apply(['codex', 'claude'].map(source => ({ hour_start: `${today}T00:00:00+08:00`, source, model: 'trend-fixture', project: 'Example', input_tokens: 100, output_tokens: 20, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 120, conversation_count: 1 })));
  const config = { statsSince: '2020-01-01', localCollectSince: '2020-01-01' } as TudConfig;
  const app = createLocalApiApp({ dataDir: 'unused-trend-test', getConfig: () => config, bucketStore: store, runSyncViaRunner: async () => { throw new Error('must not sync'); } });
  const response = await app.request(`/functions/tud-usage-trend?fromDate=${today}&toDate=${today}&sources=claude&granularity=hourly`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.points.reduce((sum: number, point: { tokens: number }) => sum + point.tokens, 0), 120);
  assert.equal(body.data.points[0].key, `${today}T00`);
  for (const query of ['days=abc', 'days=0', 'sources=typo', 'granularity=minute', 'granularity=daily&granularity=hourly', `fromDate=${today}`, `days=1&fromDate=${today}&toDate=${today}`, 'surprise=yes']) {
    assert.equal((await app.request(`/functions/tud-usage-trend?${query}`)).status, 400, query);
  }
});
