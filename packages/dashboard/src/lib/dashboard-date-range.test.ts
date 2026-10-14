import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardRangeKey, dateRangeDays, dateRangeLookback, isDashboardDateRange } from './dashboard-date-range.ts';
import { resolveDashboardFetchDays } from './dashboard-fetch-days.ts';

const now = new Date('2026-10-14T01:00:00Z');
test('custom dates use inclusive calendar days and reject invalid or future selections', () => {
  const range = { start: '2026-10-06', end: '2026-10-08' };
  assert.equal(dateRangeDays(range), 3);
  assert.equal(dateRangeLookback(range, now), 9);
  assert.equal(isDashboardDateRange(range, now), true);
  assert.equal(isDashboardDateRange({ start: '2026-02-30', end: '2026-03-01' }, now), false);
  assert.equal(isDashboardDateRange({ start: '2026-10-14', end: '2026-10-15' }, now), false);
  assert.equal(isDashboardDateRange({ start: '2025-10-14', end: '2026-10-14' }, now), false);
  assert.equal(isDashboardDateRange({ start: '2026-10-08', end: '2026-10-06' }, now), false);
});
test('equally long historical ranges have distinct query identities and exact breakdown bounds', () => {
  const first = { start: '2026-10-06', end: '2026-10-08' };
  const second = { start: '2026-10-09', end: '2026-10-11' };
  assert.notEqual(dashboardRangeKey(3, first), dashboardRangeKey(3, second));
  const fetch = resolveDashboardFetchDays(3, null, now, first);
  assert.deepEqual(fetch.breakdownRange, first);
  assert.equal(fetch.hourlyRange?.start, '2026-10-05');
  assert.equal(fetch.dailyRange?.end, '2026-10-14');
});
