import assert from 'node:assert/strict';
import test from 'node:test';
import { dailyModelKey } from 'quotern-core/daily-model-key';
import { addLocalDays, localDateNow } from 'quotern-core/timezone';
import type { UsageDataset } from './api.ts';
import { buildDashboardDataFromDataset } from './dashboard-data.ts';
import { buildShareDataFromDataset, buildShareSnapshot } from './share-snapshot.ts';

const today = localDateNow();
const yesterday = addLocalDays(today, -1);
const olderDay = addLocalDays(today, -15);
const dataset: UsageDataset = {
  summary: {
    totalTokens: 3100, totalCostUsd: 31, todayTokens: 100,
    todayCostUsd: 1, statsSince: olderDay, bySource: [],
  },
  syncStatus: null,
  projectRows: [],
  dailyRows: [[olderDay, 2000], [yesterday, 1000], [today, 100]].map(([date, tokens]) => ({
    date: String(date), tokens: Number(tokens), costUsd: Number(tokens) / 100,
    models: {
      [dailyModelKey('codex', 'gpt-5')]: Number(tokens) * 0.7,
      [dailyModelKey('claude', 'sonnet')]: Number(tokens) * 0.3,
    },
  })),
  hourlyRows: [[yesterday, 1000], [today, 100]].flatMap(([date, tokens]) => [
    { date: String(date), hour: 0, source: 'codex', tokens: Number(tokens) * 0.7, costUsd: Number(tokens) * 0.007,
      inputTokens: Number(tokens) * 0.5, outputTokens: Number(tokens) * 0.2, cachedInputTokens: 0 },
    { date: String(date), hour: 0, source: 'claude', tokens: Number(tokens) * 0.3, costUsd: Number(tokens) * 0.003,
      inputTokens: Number(tokens) * 0.2, outputTokens: Number(tokens) * 0.1, cachedInputTokens: 0 },
  ]),
  modelRows: [
    { source: 'codex', model: 'gpt-5', tokens: 2170, costUsd: 21.7, pct: 70 },
    { source: 'claude', model: 'sonnet', tokens: 930, costUsd: 9.3, pct: 30 },
  ],
};

test('share Agent filter keeps totals, model ranking and badges in the same scope', () => {
  const data = buildDashboardDataFromDataset(dataset, 30);
  const before = structuredClone(data);
  const result = buildShareSnapshot(data, { rangeDays: 30, selectedDate: null, selectedSources: ['codex'] });
  assert.equal(result.summary.totalTokens, 2170);
  assert.equal(result.summary.totalCostUsd, 21.7);
  assert.deepEqual(result.details.sources, ['codex']);
  assert.deepEqual(result.details.models.map(({ model, tokens }) => ({ model, tokens })), [{ model: 'gpt-5', tokens: 2170 }]);
  assert.equal(result.details.days.reduce((sum, day) => sum + day.tokens, 0), 2170);
  assert.deepEqual(data, before, 'sharing must not mutate the main dashboard data');
});

test('share preserves a heatmap day instead of exporting its enclosing range', () => {
  const data = buildDashboardDataFromDataset(dataset, 30);
  const result = buildShareSnapshot(data, { rangeDays: 30, selectedDate: yesterday, selectedSources: ['codex'] });
  assert.equal(result.summary.totalTokens, 700);
  assert.equal(result.summary.totalCostUsd, 7);
  assert.deepEqual(result.details.days, [{ date: yesterday, tokens: 700 }]);
  assert.deepEqual(result.details.models.map(({ model, tokens }) => ({ model, tokens })), [{ model: 'gpt-5', tokens: 700 }]);
});

test('today share uses only today hourly usage and keeps an absent Agent filter empty', () => {
  const data = buildDashboardDataFromDataset(dataset, 1);
  const result = buildShareSnapshot(data, { rangeDays: 1, selectedDate: null, selectedSources: ['codex'] });
  assert.equal(result.summary.totalTokens, 70);
  assert.deepEqual(result.details.days, [{ date: today, tokens: 70 }]);
  const empty = buildShareSnapshot(data, { rangeDays: 1, selectedDate: null, selectedSources: ['cursor'] });
  assert.equal(empty.summary.totalTokens, 0);
  assert.deepEqual(empty.details.models, []);
  assert.deepEqual(empty.details.sources, ['cursor']);
});

test('all Agents share includes every active Agent and the full selected range', () => {
  const data = buildDashboardDataFromDataset(dataset, 30);
  const result = buildShareSnapshot(data, { rangeDays: 30, selectedDate: null, selectedSources: [] });
  assert.equal(result.summary.totalTokens, 3100);
  assert.deepEqual(result.details.sources, ['codex', 'claude']);
  assert.equal(result.details.models.length, 2);
});

test('an empty share dataset stays empty even when the dashboard converter has a sample fallback', () => {
  const data = buildShareDataFromDataset({ ...dataset, dailyRows: [], hourlyRows: [], modelRows: [] }, 7);
  const result = buildShareSnapshot(data, { rangeDays: 7, selectedDate: null, selectedSources: [] });
  assert.equal(result.summary.totalTokens, 0);
  assert.equal(result.summary.totalCostUsd, 0);
  assert.deepEqual(result.details.models, []);
  assert.deepEqual(result.details.sources, []);
});

test('a selected Agent alias remains consistent after the API changes its source spelling', () => {
  const data = buildDashboardDataFromDataset(dataset, 30);
  const result = buildShareSnapshot(data, { rangeDays: 30, selectedDate: null, selectedSources: ['claude-code'] });
  assert.equal(result.summary.totalTokens, 930);
  assert.deepEqual(result.details.sources, ['claude']);
  assert.deepEqual(result.details.models.map(({ model, tokens }) => ({ model, tokens })), [{ model: 'sonnet', tokens: 930 }]);
  const duplicate = buildShareSnapshot(data, { rangeDays: 30, selectedDate: null, selectedSources: ['claude-code', 'claude'] });
  assert.deepEqual(duplicate.details.sources, ['claude']);
});
