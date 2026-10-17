import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import * as core from '../src/index.js';
import type { QueueBucket } from '../src/types.js';

const now = new Date('2026-10-16T04:00:00Z');
const bucket = (patch: Partial<QueueBucket> = {}): QueueBucket => ({
  source: 'codex', model: 'unit-price', project: 'Quotern', hour_start: '2026-10-15T16:00:00Z',
  input_tokens: 100, output_tokens: 20, cached_input_tokens: 30, cache_creation_input_tokens: 0,
  reasoning_output_tokens: 0, total_tokens: 150, conversation_count: 1, ...patch,
});
const api = () => core as unknown as {
  buildUsageReport?: (rows: QueueBucket[], query: object, context: object) => any;
  readUsageReport?: (dataDir: string, query: object, options?: object) => Promise<any>;
};
afterEach(() => core.resetPricingRuntime());

test('report shares existing cost/token totals, uses Shanghai dates and preserves model/source identity', () => {
  const { buildUsageReport } = api();
  assert.equal(typeof buildUsageReport, 'function');
  core.applyRemotePricingOverlay({ exact: { 'unit-price': { input: 2, output: 10, cache_read: 0.2 } } });
  const rows = [bucket(), bucket({ source: 'claude' }), bucket({ hour_start: '2026-10-15T15:30:00Z' })];
  const report = buildUsageReport!(rows, { period: 'models', fromDate: '2026-10-16', toDate: '2026-10-16' }, { collectSince: '2026-10-01', now });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.timeZone, 'Asia/Shanghai');
  assert.equal(report.summary.tokens, 300);
  assert.equal(report.summary.knownCostUsd, core.roundCostUsd(core.computeRowCost(rows[0]!) * 2));
  assert.equal(report.rows.length, 2);
  assert.equal(report.summary.localMetrics.requestCount, null);
});

test('report filters project/model/source and uses Monday weeks and clipped month boundaries', () => {
  const { buildUsageReport } = api();
  assert.equal(typeof buildUsageReport, 'function');
  const context = { collectSince: '2026-09-01', now };
  const rows = [bucket({ hour_start: '2026-10-11T02:00:00Z' }), bucket({ hour_start: '2026-10-12T02:00:00Z' }), bucket({ project: 'Other' }), bucket({ source: 'claude' })];
  const report = buildUsageReport!(rows, { period: 'weekly', days: 7, sources: ['codex'], project: 'Quotern', model: 'unit-price' }, context);
  assert.equal(report.summary.tokens, 300);
  assert.deepEqual(report.rows.map((r: any) => r.key), ['2026-10-05', '2026-10-12']);
  assert.equal(report.rows[0].fromDate, '2026-10-10');
  assert.equal(report.rows[1].toDate, '2026-10-16');
  const monthly = buildUsageReport!(rows, { period: 'monthly', days: 7 }, context);
  assert.equal(monthly.rows[0].fromDate, '2026-10-10');
  assert.equal(monthly.rows[0].toDate, '2026-10-16');
});

test('report rejects ambiguous dates and invalid filters, and discloses truncated coverage', () => {
  const { buildUsageReport } = api();
  assert.equal(typeof buildUsageReport, 'function');
  const context = { collectSince: '2026-10-14', now };
  for (const query of [{ days: 0 }, { fromDate: '2026-10-10' }, { fromDate: '2026-02-30', toDate: '2026-10-16' }, { toDate: '2026-10-17', fromDate: '2026-10-10' }, { sources: ['not-a-source'] }, { period: 'sessions' }]) {
    assert.throws(() => buildUsageReport!([], query, context));
  }
  const report = buildUsageReport!([], { days: 7 }, context);
  assert.equal(report.coverage.limited, true);
  assert.equal(report.coverage.fromDate, '2026-10-14');
  assert.equal(report.summary.tokens, 0);
});

test('report coverage distinguishes Shanghai midnight from a partial first day', () => {
  const query = { fromDate: '2026-10-16', toDate: '2026-10-16' };
  const cases: Array<[string, boolean]> = [
    ['2026-10-15T15:59:59.999Z', false],
    ['2026-10-15T16:00:00.000Z', false],
    ['2026-10-16T00:00:00+08:00', false],
    ['2026-10-15T16:00:00.001Z', true],
    ['2026-10-15T16:00:01.000Z', true],
    ['2026-10-15T16:30:00.000Z', true],
    ['2026-10-15T17:00:00.000Z', true],
  ];
  for (const [collectSince, limited] of cases) {
    const report = core.buildUsageReport([], query, { collectSince, now });
    assert.equal(report.coverage.limited, limited, collectSince);
  }
});

test('persisted reporting dedupes snapshots and never initializes or rewrites local runtime files', async () => {
  const { readUsageReport } = api();
  assert.equal(typeof readUsageReport, 'function');
  const dir = await mkdtemp(join(tmpdir(), 'quotern-report-'));
  try {
    await mkdir(join(dir, 'queue'));
    const config = JSON.stringify({ statsSince: '2026-10-01', localCollectSince: '2026-10-01', lastSyncAt: '2026-10-16T03:00:00Z', token: 'must-not-appear' });
    await writeFile(join(dir, 'config.json'), config);
    await writeFile(join(dir, 'tud.pid'), JSON.stringify({ pid: 123456, kind: 'desktop' }));
    const queue = `${JSON.stringify(bucket({ input_tokens: 1 }))}\n${JSON.stringify(bucket())}\n{"partial":`;
    await writeFile(join(dir, 'queue', '2026-10.jsonl'), queue);
    const before = (await readdir(dir)).sort();
    const report = await readUsageReport!(dir, { days: 7 }, { now });
    assert.equal(report.summary.tokens, 150);
    assert.equal(report.coverage.snapshot, 'persisted');
    assert.equal(JSON.stringify(report).includes('must-not-appear'), false);
    assert.deepEqual((await readdir(dir)).sort(), before);
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), config);
    assert.equal(await readFile(join(dir, 'queue', '2026-10.jsonl'), 'utf8'), queue);
    const absent = join(dir, 'absent');
    await assert.rejects(readUsageReport!(absent, {}, { now }), /未找到|不存在/);
    assert.deepEqual((await readdir(dir)).sort(), before);
    await writeFile(join(dir, 'config.json'), '{broken');
    await assert.rejects(readUsageReport!(dir, {}, { now }), /配置/);
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), '{broken');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
