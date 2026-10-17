import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUsageReport } from 'quotern-core';
import { parseUsageArgs } from '../dist/usage-args.js';
import { formatUsageReport } from '../dist/usage-output.js';
import { sessionBuckets, sessionContext, sessionModelTotals } from './fixtures/usage-session.js';

test('seven-day session regression preserves all models and provenance in a smaller single result', (t) => {
  const parsed = parseUsageArgs(['models', '--days', '7', '--format', 'json', '--compact']);
  const report = buildUsageReport(sessionBuckets(), parsed.query, sessionContext);
  const output = formatUsageReport(report, parsed.format, { compact: parsed.compact });
  const compact = JSON.parse(output);
  assert.equal(compact.fromDate, '2026-10-11');
  assert.equal(compact.toDate, '2026-10-17');
  assert.equal(compact.timeZone, 'Asia/Shanghai');
  assert.equal(compact.summary.tokens, 1638602967);
  assert.deepEqual(compact.rows.map((row) => [row.source, row.model, row.tokens]), sessionModelTotals);
  assert.deepEqual(compact.summary.costExplanation.tokenQualityTokens, {
    recorded: 0, estimated: 0, ledger: 6716020, mixed: 0, unknown: 1631886947,
  });
  assert.equal(compact.coverage.display.lastSyncAt, '2026-10-17 16:55:21 (Asia/Shanghai)');
  assert.equal(compact.coverage.display.readAt, '2026-10-17 20:03:01 (Asia/Shanghai)');
  assert.equal(compact.coverage.snapshot, 'persisted');
  assert.equal(compact.coverage.limited, false);
  assert.equal(compact.coverage.invalidRows, 0);
  // Compare minified data too: removing whitespace alone cannot pass this check.
  const fullBytes = Buffer.byteLength(JSON.stringify(report));
  const compactBytes = Buffer.byteLength(output);
  assert.ok(compactBytes < fullBytes * 0.6, `${compactBytes} / ${fullBytes}`);
  t.diagnostic(`session fixture JSON bytes: full=${fullBytes}, compact=${compactBytes}`);
});
