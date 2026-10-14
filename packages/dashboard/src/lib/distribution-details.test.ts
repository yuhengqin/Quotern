import assert from 'node:assert/strict';
import test from 'node:test';
import { dailyModelKey } from 'quotern-core/daily-model-key';
import type { LocalUsageMetrics } from 'quotern-core/local-metrics';
import { localDateNow } from 'quotern-core/timezone';
import type { UsageDataset } from './api.ts';
import { buildDashboardDataFromDataset, projectDashboardForDate } from './dashboard-data.ts';
import { buildToolModelUsage } from './dashboard-mock-data.ts';
import { buildToolModelDistributions } from './usage-filter.ts';

const first: LocalUsageMetrics = {
  version: 1,
  uncachedInputTokens: 10,
  cacheReadTokens: 20,
  cacheWriteTokens: 3,
  outputTokens: 5,
  reasoningOutputTokens: 2,
  requestCount: 1,
  knownRequestCount: 1,
  cacheHitRate: 20 / 33,
  missingReasons: [],
};
const second: LocalUsageMetrics = {
  ...first,
  uncachedInputTokens: 20,
  cacheReadTokens: 30,
  cacheWriteTokens: 7,
  outputTokens: 8,
  reasoningOutputTokens: 5,
  cacheHitRate: 30 / 57,
};

function makeDataset(): UsageDataset {
  const date = localDateNow();
  return {
    summary: {
      totalTokens: 110,
      totalCostUsd: 3.3,
      todayTokens: 110,
      todayCostUsd: 3.3,
      statsSince: date,
      bySource: [],
    },
    dailyRows: [{
      date,
      tokens: 110,
      costUsd: 3.3,
      models: {
        [dailyModelKey('codex', 'shared-model')]: 40,
        [dailyModelKey('claude', 'shared-model')]: 70,
      },
      sources: [
        { source: 'codex', tokens: 40, costUsd: 1.1, localMetrics: first },
        { source: 'claude', tokens: 70, costUsd: 2.2, localMetrics: second },
      ],
    }],
    modelRows: [
      { source: 'codex', model: 'shared-model', tokens: 40, costUsd: 1.1, pct: 40 / 1.1, localMetrics: first },
      { source: 'claude', model: 'shared-model', tokens: 70, costUsd: 2.2, pct: 70 / 1.1, localMetrics: second },
    ],
    projectRows: [],
    hourlyRows: [],
    syncStatus: null,
  };
}

test('distribution details survive API projection and sum the same model across Agents', () => {
  const view = buildDashboardDataFromDataset(makeDataset(), 7);
  const result = buildToolModelDistributions(view.toolModelUsage);

  assert.deepEqual(result.tools.find((row) => row.id === 'codex')?.localMetrics, first);
  const model = result.models.find((row) => row.id === 'shared-model');
  assert.equal(model?.tokens, 110);
  assert.ok(Math.abs((model?.costUsd ?? 0) - 3.3) < 1e-8);
  assert.equal(model?.localMetrics?.uncachedInputTokens, 30);
  assert.equal(model?.localMetrics?.cacheReadTokens, 50);
  assert.equal(model?.localMetrics?.cacheWriteTokens, 10);
  assert.equal(model?.localMetrics?.outputTokens, 13);
  assert.equal(model?.localMetrics?.reasoningOutputTokens, 7);

  const filtered = buildToolModelDistributions(view.toolModelUsage.filter((row) => row.source === 'codex'));
  assert.deepEqual(filtered.models[0]?.localMetrics, first);
});

test('unknown cache counts stay unknown while known zero counts stay zero', () => {
  const dataset = makeDataset();
  dataset.modelRows[0]!.localMetrics = { ...first, cacheReadTokens: null, cacheHitRate: null };
  dataset.modelRows[1]!.localMetrics = { ...second, cacheWriteTokens: 0 };
  const result = buildToolModelDistributions(buildDashboardDataFromDataset(dataset, 7).toolModelUsage);

  assert.equal(result.models[0]?.localMetrics?.cacheReadTokens, null);
  assert.equal(result.models[0]?.localMetrics?.cacheWriteTokens, 3);
  assert.equal(result.tools.find((row) => row.id === 'claude')?.localMetrics?.cacheWriteTokens, 0);
});

test('legacy rows do not turn a partial model breakdown into a complete one', () => {
  const toolRows = buildToolModelUsage([
    { source: 'codex', tokens: 40, costUsd: 1.1, localMetrics: first, models: [
      { model: 'shared-model', tokens: 40, costUsd: 1.1, localMetrics: first },
    ] },
    { source: 'claude', tokens: 70, costUsd: 2.2, models: [
      { model: 'shared-model', tokens: 70, costUsd: 2.2 },
    ] },
  ]);
  const result = buildToolModelDistributions(toolRows);

  assert.equal(result.models[0]?.tokens, 110);
  assert.equal(result.models[0]?.localMetrics, undefined);
  assert.equal(result.tools.find((row) => row.id === 'claude')?.localMetrics, undefined);
  assert.deepEqual(result.tools.find((row) => row.id === 'codex')?.localMetrics, first);
});

test('day drill-down keeps Agent evidence without reusing range model details', () => {
  const dataset = makeDataset();
  const view = buildDashboardDataFromDataset(dataset, 7);
  const day = projectDashboardForDate(view, localDateNow());
  const result = buildToolModelDistributions(day.toolModelUsage);

  assert.deepEqual(result.tools.find((row) => row.id === 'codex')?.localMetrics, first);
  assert.deepEqual(result.tools.find((row) => row.id === 'claude')?.localMetrics, second);
  assert.equal(result.models[0]?.localMetrics, undefined);
});
