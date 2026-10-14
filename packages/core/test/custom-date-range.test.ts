import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AggregateCache } from '../src/aggregate-cache.js';
import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore, ensureLocalCollectRange } from '../src/server/state.js';
import { addLocalDays, localDateNow } from '../src/timezone.js';
import type { TudConfig } from '../src/types.js';

for (const cached of [false, true]) {
  test(`custom dates scope daily, hourly and model/project totals (cache=${cached})`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'quotern-custom-range-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const today = localDateNow();
    const chosen = addLocalDays(today, -2);
    const bucketStore = new BucketStore();
    bucketStore.apply([-3, -2, -1, 0].map((delta, i) => ({
      hour_start: `${addLocalDays(today, delta)}T04:00:00.000Z`,
      source: 'codex', model: 'test-model', project: 'test-project',
      input_tokens: (i + 1) * 10, output_tokens: 0, cached_input_tokens: 0,
      cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
      total_tokens: (i + 1) * 10, conversation_count: 1,
    })));
    const config = { deviceId: 'test', statsSince: '2020-01-01', localCollectSince: '2020-01-01' } as TudConfig;
    const aggregateCache = cached ? new AggregateCache(dir) : undefined;
    if (aggregateCache) await aggregateCache.rebuildFromRows(bucketStore.getRows());
    const app = createLocalApiApp({ dataDir: dir, getConfig: () => config, bucketStore, aggregateCache });
    const query = `?days=7&fromDate=${chosen}&toDate=${chosen}`;
    const daily = await (await app.request(`/functions/tud-usage-daily${query}`)).json();
    assert.deepEqual(daily.data.days.map((row: { date: string }) => row.date), [chosen]);
    assert.equal(daily.data.days[0].tokens, 20);
    const hourly = await (await app.request(`/functions/tud-usage-hourly${query}`)).json();
    assert.deepEqual(hourly.data.hours.map((row: { date: string }) => row.date), [chosen]);
    const models = await (await app.request(`/functions/tud-usage-model-breakdown${query}`)).json();
    assert.equal(models.data.models[0].tokens, 20);
    assert.equal(models.data.projects[0].tokens, 20);
    for (const invalid of [`fromDate=${today}&toDate=${chosen}`, 'fromDate=2026-02-30&toDate=2026-03-01', `fromDate=${chosen}`]) {
      const response = await app.request(`/functions/tud-usage-daily?${invalid}`);
      assert.equal(response.status, 400, invalid);
    }
  });
}

test('custom lookback expands collection without accepting invalid preset days', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-custom-ensure-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = { deviceId: 'test', statsSince: new Date().toISOString(), localCollectSince: new Date().toISOString() } as TudConfig;
  const deps = { dataDir: dir, getConfig: () => config, bucketStore: new BucketStore(), runSyncViaRunner: async () => [] };
  await assert.rejects(ensureLocalCollectRange(deps, 17), /INVALID_RANGE_DAYS/);
  const result = await ensureLocalCollectRange(deps, 17, true);
  assert.equal(result.expanded, true);
  await assert.rejects(ensureLocalCollectRange(deps, 366, true), /INVALID_RANGE_DAYS/);
});
