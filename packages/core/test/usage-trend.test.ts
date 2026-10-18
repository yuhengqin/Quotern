import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import * as core from '../src/index.js';
import type { QueueBucket } from '../src/types.js';

const bucket = (patch: Partial<QueueBucket> = {}): QueueBucket => ({ source: 'claude', model: 'trend-a', project: 'P', hour_start: '2026-10-17T16:00:00Z', input_tokens: 1000000, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 1000000, conversation_count: 1, ...patch });
const context = { collectSince: '2026-09-01', now: new Date('2026-10-18T02:00:00Z') };
const trend = (...args: any[]): any => {
  const build = (core as any).aggregateUsageTrend;
  assert.equal(typeof build, 'function');
  return build(...args);
};
afterEach(() => core.resetPricingRuntime());

test('trend uses actual model prices and source filters, never token proportions', () => {
  core.applyRemotePricingOverlay({ exact: { 'trend-a': { input: 1 }, 'trend-b': { input: 10 } } });
  const report = trend([bucket(), bucket({ model: 'trend-b' }), bucket({ source: 'codex' })], { fromDate: '2026-10-18', toDate: '2026-10-18', sources: ['claude'], granularity: 'daily' }, context);
  assert.equal(report.points[0].knownCostUsd, 11);
  assert.deepEqual(report.models, ['trend-b', 'trend-a']);
  assert.equal(report.points[0].models['trend-a'].knownCostUsd, 1);
  assert.equal(report.points[0].models['trend-b'].knownCostUsd, 10);
  assert.equal(report.points[0].tokens, 2000000);
});

test('hourly trend retains each date, fills empty hours and stops at the current hour', () => {
  const report = trend([bucket({ hour_start: '2026-10-16T16:00:00Z' }), bucket()], { fromDate: '2026-10-17', toDate: '2026-10-18', granularity: 'hourly' }, context);
  assert.equal(report.points.length, 35);
  assert.equal(report.points[0].key, '2026-10-17T00');
  assert.equal(report.points[24].key, '2026-10-18T00');
  assert.equal(report.points.at(-1).key, '2026-10-18T10');
  assert.equal(report.points[1].tokens, 0);
});

test('weekly and monthly trend uses Monday boundaries clipped to the selected range', () => {
  const query = { fromDate: '2026-10-11', toDate: '2026-10-18' };
  const weekly = trend([], { ...query, granularity: 'weekly' }, context);
  assert.deepEqual(weekly.points.map((p: any) => [p.key, p.fromDate, p.toDate]), [['2026-10-05', '2026-10-11', '2026-10-11'], ['2026-10-12', '2026-10-12', '2026-10-18']]);
  const monthly = trend([], { ...query, granularity: 'monthly' }, context);
  assert.deepEqual([monthly.points[0].fromDate, monthly.points[0].toDate], ['2026-10-11', '2026-10-18']);
  assert.throws(() => trend([], { ...query, granularity: 'minute' }, context));
});

test('trend exposes partial pricing and respects collection floor', () => {
  core.applyRemotePricingOverlay({ exact: { 'trend-a': { output: 10 } } });
  const report = trend([bucket()], { fromDate: '2026-10-17', toDate: '2026-10-18', granularity: 'daily' }, { ...context, collectSince: '2026-10-18' });
  assert.equal(report.points.length, 1);
  assert.equal(report.points[0].costUsd, null);
  assert.equal(report.points[0].unpricedTokens, 1000000);
  assert.equal(report.coverage.limited, true);
});
