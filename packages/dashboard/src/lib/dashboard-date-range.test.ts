import assert from 'node:assert/strict';
import test from 'node:test';
import { appendDashboardRangeQuery, dashboardRangeCacheKey, dashboardRangeKey, dateRangeDays, dateRangeLookback, isDashboardDateRange, previousRollingRange, rollingDayRange } from './dashboard-date-range.ts';
import { resolveDashboardFetchDays } from './dashboard-fetch-days.ts';

const now = new Date('2026-10-14T01:00:00Z');
test('1D is a moving 24-hour interval, separate from today and serialized as instants', () => {
  const range = rollingDayRange(now);
  assert.deepEqual(range, { start: '2026-10-13', end: '2026-10-14', fromTime: '2026-10-13T01:00:00.000Z', toTime: '2026-10-14T01:00:00.000Z' });
  assert.equal(previousRollingRange(range).fromTime, '2026-10-12T01:00:00.000Z');
  assert.notEqual(dashboardRangeKey(1, range), dashboardRangeKey(1));
  assert.notEqual(dashboardRangeKey(1, range), dashboardRangeKey(1, rollingDayRange(new Date('2026-10-14T01:01:00Z'))));
  const params = new URLSearchParams(); appendDashboardRangeQuery(params, range);
  assert.equal(params.get('fromTime'), range.fromTime);
  assert.equal(params.has('fromDate'), false);
  assert.equal(isDashboardDateRange(range, now), false);
  const fetch = resolveDashboardFetchDays(1, null, now, range);
  assert.deepEqual(fetch.breakdownRange, range);
  assert.ok(fetch.hourlyRange!.start <= '2026-10-12');
});
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

test('display cache reuses moving 1D while keeping today and historical dates separate', () => {
  const first = rollingDayRange(now);
  const next = rollingDayRange(new Date('2026-10-14T01:01:00Z'));
  assert.equal(dashboardRangeCacheKey(1, first, now), dashboardRangeCacheKey(1, next, now));
  assert.notEqual(dashboardRangeCacheKey(1, first, now), dashboardRangeCacheKey(1, null, now));
  assert.notEqual(dashboardRangeCacheKey(7, null, now), dashboardRangeCacheKey(30, null, now));
  assert.notEqual(dashboardRangeCacheKey(1, { start: '2026-10-12', end: '2026-10-12' }, now), dashboardRangeCacheKey(1, { start: '2026-10-13', end: '2026-10-13' }, now));
  assert.notEqual(dashboardRangeCacheKey(7, null, now), dashboardRangeCacheKey(7, null, new Date('2026-10-15T01:00:00Z')));
});
