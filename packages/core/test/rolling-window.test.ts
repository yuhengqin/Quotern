import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateDaily, aggregateHourly, aggregateModelBreakdown } from '../src/aggregate.js';
import { buildUsageReport } from '../src/usage-report.js';
import { aggregateUsageTrend } from '../src/usage-trend.js';
import { aggregateSessionMetrics } from '../src/session-metrics.js';
import { aggregateSessionActivity, extractSessionObservation } from '../src/session-observation.js';
import type { QueueBucket } from '../src/types.js';
import type { TudConfig } from '../src/types.js';
import { AggregateCache } from '../src/aggregate-cache.js';
import { BucketStore } from '../src/server/state.js';
import { createLocalApiApp } from '../src/server/local-api.js';

const bounds = { fromDate: undefined, toDate: undefined, fromTime: '2026-10-17T06:30:00Z', toTime: '2026-10-18T06:30:00Z' };
const rows: QueueBucket[] = ['2026-10-17T06:00:00Z', bounds.fromTime, '2026-10-18T06:00:00Z', bounds.toTime].map((hour_start, i) => ({
  hour_start, source: 'codex', model: 'gpt-5', project: 'rolling', input_tokens: 10 ** i,
  output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
  total_tokens: 10 ** i, conversation_count: 1,
}));
const context = { collectSince: '2026-01-01', now: new Date('2026-10-18T07:00:00Z') };

test('rolling totals include the lower time bound and exclude the upper bound across midnight', () => {
  assert.equal(aggregateDaily(rows, 1, context.collectSince, undefined, bounds).days.reduce((sum, row) => sum + row.tokens, 0), 110);
  assert.equal(aggregateHourly(rows, 1, context.collectSince, undefined, bounds).hours.reduce((sum, row) => sum + row.tokens, 0), 110);
  assert.equal(aggregateModelBreakdown(rows, 1, context.collectSince, undefined, bounds).models[0]?.tokens, 110);
});

test('rolling bounds bypass whole-day caches and survive local API serialization', async () => {
  const cache = new AggregateCache('unused-rolling-cache');
  assert.equal(cache.getDaily(rows, 1, context.collectSince, bounds).days.reduce((sum, row) => sum + row.tokens, 0), 110);
  assert.equal(cache.getHourly(rows, 1, context.collectSince, bounds).hours.reduce((sum, row) => sum + row.tokens, 0), 110);
  assert.equal(cache.getModelBreakdown(rows, 1, context.collectSince, bounds).models[0]?.tokens, 110);
  const store = new BucketStore(); store.apply(rows);
  const app = createLocalApiApp({ dataDir: 'unused-rolling-api', bucketStore: store, getConfig: () => ({ statsSince: context.collectSince } as TudConfig), runSyncViaRunner: async () => { throw new Error('must not sync'); } });
  const query = new URLSearchParams({ fromTime: bounds.fromTime, toTime: bounds.toTime });
  for (const endpoint of ['usage-daily', 'usage-hourly', 'usage-model-breakdown', 'usage-report', 'usage-trend']) {
    const response = await app.request(`/functions/tud-${endpoint}?${query}`);
    assert.equal(response.status, 200, endpoint);
    const { data } = await response.json();
    const tokens = endpoint === 'usage-report' ? data.summary.tokens : (endpoint === 'usage-trend' ? data.points : data.days ?? data.hours ?? data.models).reduce((sum: number, row: { tokens: number }) => sum + row.tokens, 0);
    assert.equal(tokens, 110, endpoint);
    for (const invalid of [`fromTime=${bounds.fromTime}`, `${query}&fromDate=2026-10-17&toDate=2026-10-18`]) {
      assert.equal((await app.request(`/functions/tud-${endpoint}?${invalid}`)).status, 400, endpoint);
    }
  }
});

test('rolling cost reports and hourly trends select the same buckets without a second full calendar day', () => {
  assert.equal(buildUsageReport(rows, bounds, context).summary.tokens, 110);
  const trend = aggregateUsageTrend(rows, { ...bounds, granularity: 'hourly' }, context);
  assert.equal(trend.points.reduce((sum, point) => sum + point.tokens, 0), 110);
  assert.equal(trend.points[0]?.key, '2026-10-17T14');
  assert.equal(trend.points.at(-1)?.key, '2026-10-18T14');
  assert.throws(() => buildUsageReport(rows, { ...bounds, days: 1 }, context));
  assert.throws(() => buildUsageReport(rows, { fromTime: bounds.fromTime }, context));
});

test('rolling messages and task duration clip to the same instant bounds', () => {
  const messages = rows.map((row, i) => ({ source: 'codex', sessionId: 'one', id: String(i), role: 'assistant' as const, timestamp: row.hour_start }));
  const metrics = aggregateSessionMetrics(messages, { ...bounds, timingEvents: [
    { source: 'codex', sessionId: 'one', id: 'start', turnId: 'turn', kind: 'task-start', timestamp: '2026-10-17T06:00:00Z' },
    { source: 'codex', sessionId: 'one', id: 'end', turnId: 'turn', kind: 'task-end', timestamp: '2026-10-17T07:00:00Z', durationMs: 3600000 },
  ] });
  assert.equal(metrics.messageCount, 2);
  assert.equal(metrics.taskSeconds, 1800);
});

test('session attribution follows usage bucket boundaries while messages retain exact clocks', () => {
  const options = { fromTime: '2026-10-17T06:15:00Z', toTime: '2026-10-18T06:15:00Z', totalTokens: 200 };
  const events = ['2026-10-17T06:20:00Z', '2026-10-18T06:20:00Z'].map((timestamp, i) => extractSessionObservation('pi', {
    type: 'message', id: String(i), timestamp, message: { role: 'assistant', usage: { input: (i + 1) * 100, cost: { total: i + 1 } } },
  }, { sessionId: 'one' })!);
  const snapshot = aggregateSessionActivity(events, [], options);
  assert.equal(snapshot.attributedTokens, 200);
  assert.equal(snapshot.totalTokens, 200);
  assert.equal(snapshot.otherTokens, 0);
  assert.equal(snapshot.tokenTotalMismatch, false);
  assert.equal(snapshot.sessions[0]?.costUsd, 2);
  assert.equal(aggregateSessionMetrics(events.map(e => ({ source: e.source, sessionId: e.sessionId, id: e.id, role: 'assistant', timestamp: e.timestamp })), options).messageCount, 1);
});
