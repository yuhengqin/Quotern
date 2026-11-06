import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUsageReport } from '../src/usage-report.js';
import type { QueueBucket } from '../src/types.js';

const bucket = (date: string, tokens: number, project = 'A', source = 'codex', model = 'model-a'): QueueBucket => ({ source, model, project, hour_start: `${date}T01:00:00Z`, input_tokens: tokens, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: tokens, conversation_count: 1 });
const context = { collectSince: '2026-10-01T00:00:00Z', now: new Date('2026-11-06T10:00:00Z') };
const query = { period: 'overview' as const, fromDate: '2026-11-03', toDate: '2026-11-05' };
const results = (rows: QueueBucket[], patch = {}) => Reflect.get(buildUsageReport(rows, { ...query, ...patch }, context), 'insights');

test('growth attribution compares equal windows and respects source filters', () => {
  const rows = [bucket('2026-10-31', 100000), bucket('2026-11-03', 400000), bucket('2026-11-04', 300000, 'Other', 'claude')];
  const output = results(rows, { sources: ['codex'] });
  assert.ok(output?.comparison);
  assert.ok(output?.findings.some((item: any) => item.kind === 'project-growth' && item.project === 'A' && item.tokens === 300000));
  assert.ok(!output.findings.some((item: any) => item.project === 'Other'));
  assert.equal(output.comparison.fromTime, '2026-10-30T16:00:00.000Z');
  assert.equal(output.comparison.toTime, '2026-11-02T16:00:00.000Z');
});

test('incomplete baseline and zero baseline never produce percentage growth claims', () => {
  const rows = [bucket('2026-11-03', 400000)];
  assert.ok(!results(rows)?.findings.some((item: any) => item.kind === 'project-growth'));
  const output = Reflect.get(buildUsageReport(rows, query, { ...context, collectSince: '2026-11-02T00:00:00Z' }), 'insights');
  assert.equal(output?.comparison, null);
});

test('spikes follow the requested date range and require enough active-day samples', () => {
  const rows = [bucket('2026-11-03', 10000), bucket('2026-11-04', 10000), bucket('2026-11-05', 400000)];
  assert.ok(results(rows)?.findings.some((item: any) => item.kind === 'daily-spike' && item.date === '2026-11-05'));
  assert.ok(!results(rows, { fromDate: '2026-11-03', toDate: '2026-11-04' })?.findings.some((item: any) => item.kind === 'daily-spike'));
});

test('model shifts preserve source identity and empty data has no findings', () => {
  const output = results([bucket('2026-10-31', 200000), bucket('2026-11-03', 200000, 'A', 'codex', 'model-b')]);
  assert.ok(output?.findings.some((item: any) => item.kind === 'model-shift' && item.source === 'codex' && item.model === 'model-b'));
  assert.deepEqual(results([])?.findings, []);
});
