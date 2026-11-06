import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPerformanceReport } from '../src/performance-analysis.js';
import type { SessionEvidence } from '../src/session-insights.js';

const sessions = [
  { source: 'codex', sessionId: 'one', projectLabel: 'Project A', sessionTitle: 'First session' },
  { source: 'codex', sessionId: 'two', projectLabel: 'Project B' },
];
const sample = (id: string, extra: Partial<SessionEvidence> = {}): SessionEvidence => ({
  source: 'codex', sessionId: 'one', kind: 'request', id, timestamp: '2026-11-01T05:00:00Z', model: 'model-a', ...extra,
});
const options = { fromDate: '2026-11-01', toDate: '2026-11-01', timeZone: 'UTC' };

test('performance quantiles use raw samples and speed is weighted by measured duration', () => {
  const report = buildPerformanceReport([
    sample('a', { ttftMs: 0 }), sample('b', { ttftMs: 100 }), sample('c', { ttftMs: 9000, sessionId: 'two' }),
    sample('d', { outputTokens: 200, durationMs: 1000 }), sample('e', { outputTokens: 400, durationMs: 4000 }),
  ], sessions, options);
  assert.equal(report.summary.ttftP50Ms, 100);
  assert.equal(report.summary.ttftP95Ms, 9000);
  assert.equal(report.summary.tokensPerSecond, 120);
  assert.equal(report.summary.speedSampleCount, 2);
  assert.equal(report.summary.sessionCount, 2);
  assert.equal(report.trend.length, 1);
});

test('duplicate and inherited fork evidence never inflate samples; invalid samples remain absent', () => {
  const duplicate = sample('same', { ttftMs: 12 });
  const report = buildPerformanceReport([
    duplicate, duplicate, { ...duplicate, sessionId: 'two' },
    sample('parent', { sessionId: 'two', kind: 'metadata', parentId: 'one', relationKind: 'fork' }),
    sample('bad', { ttftMs: Number.NaN, outputTokens: 199, durationMs: 0 }),
    sample('slow', { outputTokens: 400, durationMs: 3600001 }),
  ], sessions, options);
  assert.equal(report.summary.ttftSampleCount, 1);
  assert.equal(report.summary.speedSampleCount, 0);
  assert.equal(report.summary.tokensPerSecond, null);
});

test('range and dimension filters preserve full facets and use actual sample timestamps', () => {
  const report = buildPerformanceReport([
    sample('inside', { ttftMs: 20 }), sample('other', { ttftMs: 10, sessionId: 'two', model: 'model-b' }),
    sample('before', { ttftMs: 40, timestamp: '2026-11-01T04:59:59Z' }),
    sample('end', { ttftMs: 80, timestamp: '2026-11-01T06:00:00Z' }),
  ], sessions, { ...options, fromTime: '2026-11-01T05:00:00Z', toTime: '2026-11-01T06:00:00Z', model: 'model-a', project: 'Project A', groupBy: 'project' });
  assert.equal(report.summary.ttftSampleCount, 1);
  assert.deepEqual(report.facets.models, ['model-a', 'model-b']);
  assert.equal(report.groups[0]?.label, 'Project A');
  assert.equal(report.samples[0]?.sessionId, 'one');
});

test('fork siblings and descendants deduplicate inherited requests even without the parent record', () => {
  const events = [
    sample('link', { sessionId: 'one', kind: 'metadata', parentId: 'missing', relationKind: 'fork' }),
    sample('link', { sessionId: 'two', kind: 'metadata', parentId: 'missing', relationKind: 'fork' }),
    sample('link', { sessionId: 'three', kind: 'metadata', parentId: 'two', relationKind: 'fork' }),
    ...['one', 'two', 'three'].map(sessionId => sample('inherited', { sessionId, ttftMs: 20 })),
    sample('inherited', { sessionId: 'independent', ttftMs: 40 }),
    sample('new-request', { sessionId: 'three', ttftMs: 80 }),
  ];
  const report = buildPerformanceReport(events, sessions, options);
  assert.equal(report.summary.ttftSampleCount, 3);
  assert.deepEqual(buildPerformanceReport([...events].reverse(), sessions, options).samples, report.samples);
});

test('recent sample limit never truncates aggregates and no evidence produces null metrics', () => {
  const report = buildPerformanceReport(Array.from({ length: 120 }, (_, n) => sample(String(n), { ttftMs: n })), sessions, options);
  assert.equal(report.samples.length, 100);
  assert.equal(report.summary.ttftSampleCount, 120);
  const empty = buildPerformanceReport([], sessions, options);
  assert.equal(empty.summary.ttftP95Ms, null);
  assert.equal(empty.summary.tokensPerSecond, null);
  assert.equal(empty.summary.sessionCount, 0);
});

test('model comparison uses all raw samples and obeys the current period and project', () => {
  const report = buildPerformanceReport([
    ...Array.from({ length: 120 }, (_, n) => sample(String(n), { ttftMs: n })),
    sample('other', { model: 'model-b', ttftMs: 900, sessionId: 'two' }),
  ], sessions, { ...options, compareModels: ['model-a', 'model-b'], project: 'Project A' });
  assert.equal(report.comparison?.[0]?.trend[0]?.ttftSampleCount, 120);
  assert.equal(report.comparison?.[0]?.trend[0]?.ttftP50Ms, 59);
  assert.deepEqual(report.comparison?.[1]?.trend, []);
});
