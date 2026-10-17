import assert from 'node:assert/strict';
import test from 'node:test';

import { formatUsageReport } from '../dist/usage-output.js';

function makeReport(overrides = {}) {
  const localMetrics = {
    version: 1,
    uncachedInputTokens: 0,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    requestCount: 0,
    knownRequestCount: 0,
    cacheHitRate: null,
    missingReasons: ['unsupported_source'],
  };
  const costExplanation = {
    version: 1,
    knownCostUsd: 0,
    reportedCostUsd: 0,
    estimatedCostUsd: 0,
    totalTokens: 0,
    unpricedTokens: 4,
    defaultPricedTokens: 0,
    tokenQualityTokens: {
      recorded: 0,
      estimated: 0,
      ledger: 0,
      mixed: 0,
      unknown: 0,
    },
    entries: [],
  };
  const row = {
    key: 'row',
    label: 'Model',
    source: 'codex',
    model: 'gpt-test',
    project: 'Quotern',
    tokens: 0,
    costUsd: null,
    knownCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    localMetrics,
    costExplanation,
  };
  const summary = {
    tokens: 0,
    costUsd: null,
    knownCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    localMetrics,
    costExplanation,
  };
  return {
    schemaVersion: 1,
    period: 'daily',
    timeZone: 'Asia/Shanghai',
    fromDate: '2026-10-01',
    toDate: '2026-10-02',
    filters: { sources: [], model: null, project: null },
    coverage: {
      collectSince: '2026-10-01T00:00:00.000Z',
      fromDate: '2026-10-01',
      toDate: '2026-10-02',
      limited: true,
      snapshot: 'persisted',
      lastSyncAt: null,
      readAt: '2026-10-02T00:00:00.000Z',
      invalidRows: 0,
    },
    summary,
    rows: [row],
    ...overrides,
  };
}

test('formatUsageReport returns readable JSON that can be read back', () => {
  const report = makeReport();
  const json = formatUsageReport(report, 'json');
  assert.equal(json, JSON.stringify(report, null, 2));
  assert.deepEqual(JSON.parse(json), report);
});

test('compact JSON preserves identity, totals and uncertainty without detailed price entries', () => {
  const report = makeReport();
  report.rows.push({ ...report.rows[0], key: 'other-source', source: 'claude' });
  const before = structuredClone(report);
  const compact = JSON.parse(formatUsageReport(report, 'json', { compact: true }));

  assert.equal(compact.view, 'compact');
  assert.equal(compact.schemaVersion, 1);
  assert.deepEqual(compact.filters, report.filters);
  assert.deepEqual(compact.rows.map(({ source, model, tokens }) => ({ source, model, tokens })), [
    { source: 'codex', model: 'gpt-test', tokens: 0 },
    { source: 'claude', model: 'gpt-test', tokens: 0 },
  ]);
  assert.equal(compact.rows[0].costUsd, null);
  assert.equal(compact.rows[0].knownCostUsd, 0);
  assert.equal(compact.rows[0].costExplanation.unpricedTokens, 4);
  assert.deepEqual(compact.rows[0].costExplanation.tokenQualityTokens, report.rows[0].costExplanation.tokenQualityTokens);
  assert.equal(compact.summary.localMetrics.cacheHitRate, null);
  assert.deepEqual(compact.summary.localMetrics.missingReasons, ['unsupported_source']);
  assert.equal('entries' in compact.summary.costExplanation, false);
  assert.equal('entries' in compact.rows[0].costExplanation, false);
  assert.equal('localMetrics' in compact.rows[0], false);
  assert.deepEqual(report, before);
  assert.deepEqual(JSON.parse(formatUsageReport(report, 'json')), before);
});

test('display timestamps use the report time zone including date rollover and daylight saving', () => {
  for (const [timeZone, stamp, expected] of [
    ['Asia/Shanghai', '2026-10-17T08:55:21.344Z', '2026-10-17 16:55:21 (Asia/Shanghai)'],
    ['Asia/Shanghai', '2026-10-17T18:30:00Z', '2026-10-18 02:30:00 (Asia/Shanghai)'],
    ['America/New_York', '2026-07-01T08:00:00Z', '2026-07-01 04:00:00 (America/New_York)'],
    ['America/New_York', '2026-01-01T08:00:00Z', '2026-01-01 03:00:00 (America/New_York)'],
  ]) {
    const report = makeReport({ timeZone });
    report.coverage.lastSyncAt = stamp;
    const compact = JSON.parse(formatUsageReport(report, 'json', { compact: true }));
    assert.equal(compact.coverage.lastSyncAt, stamp);
    assert.equal(compact.coverage.display.lastSyncAt, expected);
    assert.ok(formatUsageReport(report, 'text').includes(`最近同步完成\t${expected}`));
  }
  const report = makeReport();
  const compact = JSON.parse(formatUsageReport(report, 'json', { compact: true }));
  assert.equal(compact.coverage.display.lastSyncAt, null);
  assert.equal(compact.coverage.display.readAt, '2026-10-02 08:00:00 (Asia/Shanghai)');
  assert.equal(compact.coverage.display.collectSince, '2026-10-01 08:00:00 (Asia/Shanghai)');
  assert.ok(formatUsageReport(report, 'text').includes('报告读取时间\t2026-10-02 08:00:00 (Asia/Shanghai)'));
});

test('formatUsageReport emits CSV with quoting, formula protection, nulls, and zeroes', () => {
  const report = makeReport();
  report.rows[0] = {
    ...report.rows[0],
    label: 'line one, "quoted"\r\nline two',
    source: '=SUM(A1,A2)',
    fromDate: undefined,
    toDate: undefined,
    localMetrics: { ...report.rows[0].localMetrics, requestCount: 0, cacheHitRate: null },
  };

  const csv = formatUsageReport(report, 'csv');
  assert.ok(csv.startsWith('period,label,source,model,project,from_date,to_date,tokens,cost_usd,known_cost_usd,unpriced_tokens,default_priced_tokens,request_count,cache_reuse_rate,collect_since,coverage_limited,last_sync_at,snapshot,time_zone\r\n'));
  assert.ok(csv.includes('"line one, ""quoted""\r\nline two","\'=SUM(A1,A2)",gpt-test,Quotern,2026-10-01,2026-10-02,0,,0,4,0,0,,2026-10-01T00:00:00.000Z,true,,persisted,Asia/Shanghai'));
  report.rows[0].model = '=1+1';
  report.rows[0].project = '@formula';
  report.rows[0].label = '-formula';
  assert.ok(formatUsageReport(report, 'csv').includes("'-formula"));
  assert.ok(formatUsageReport(report, 'csv').includes("'=1+1,'@formula"));
});

test('formatUsageReport text marks unknown costs and removes terminal controls', () => {
  const report = makeReport();
  report.rows[0] = { ...report.rows[0], label: 'Model\u001b[31m', source: 'source\tname' };
  const text = formatUsageReport(report, 'text');
  const lines = text.split('\n');

  assert.equal(lines[0], 'Quotern usage · daily');
  assert.equal(lines[1], '2026-10-01 – 2026-10-02 · Asia/Shanghai');
  assert.equal(lines[2], 'Model[31m\tsourcename\t0\t未知（已知 $0.000000）');
  assert.ok(lines.includes('最近同步完成\t未知'));
  assert.ok(lines.includes('快照\tpersisted（读取时已落盘快照）'));
  assert.ok(lines.includes('提示\t费用信息包含来源报告与费率估算，不是实际账单。'));
  assert.ok(!text.includes('\u001b'));
});
