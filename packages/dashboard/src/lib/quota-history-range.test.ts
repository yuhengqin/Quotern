import test from 'node:test';
import assert from 'node:assert/strict';
import { quotaHistoryBounds, quotaHistorySegments } from './quota-history-presentation.ts';
import type { QuotaHistoryReport } from 'quotern-core';

test('history browsing is bounded and never joins reset or rollback segments', () => {
  const report = { observedAt: 10000, windows: [{ id: '5h', cycles: [
    { id: 'new', firstObservedAt: 9000, samples: [{ at: 9000, usedPercent: 2 }] },
    { id: 'old', firstObservedAt: 1000, samples: [{ at: 1000, usedPercent: 90 }, { at: 8500, usedPercent: 99 }] },
  ] }] } as unknown as QuotaHistoryReport;
  assert.deepEqual(quotaHistoryBounds(report, 2000, 11000), { from: 8000, to: 10000, canPrevious: true, canNext: false });
  assert.deepEqual(quotaHistoryBounds(report, 2000, 0), { from: 1000, to: 3000, canPrevious: false, canNext: true });
  const segments = quotaHistorySegments(report.windows, 8000, 10000);
  assert.equal(segments.length, 2);
  assert.notEqual(segments[0].key, segments[1].key);
  assert.deepEqual(segments[1].samples, [{ at: 8500, usedPercent: 99 }]);
});
