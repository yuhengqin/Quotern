import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardRangeScopeKey, dashboardRangeKey } from './dashboard-range-scope.js';
import { RangeQueryCache } from './range-query-cache.js';

test('a rolling window keeps its reading while revalidating across local midnight', async () => {
  const beforeMidnight = new Date('2026-10-14T15:59:30Z');
  const afterMidnight = new Date('2026-10-14T16:00:30Z');
  const firstRange = { start: '2026-10-13', end: '2026-10-14', fromTime: '2026-10-13T15:59:30.000Z', toTime: beforeMidnight.toISOString() };
  const nextRange = { start: '2026-10-14', end: '2026-10-15', fromTime: '2026-10-13T16:00:30.000Z', toTime: afterMidnight.toISOString() };
  const cache = new RangeQueryCache<number>();
  await cache.refresh(dashboardRangeScopeKey(1, firstRange), 'first', async () => 42);
  const nextKey = dashboardRangeScopeKey(1, nextRange);
  let finish!: (value: number) => void;
  const pending = cache.refresh(nextKey, 'next', () => new Promise<number>(resolve => { finish = resolve; }));
  await Promise.resolve();
  assert.deepEqual(cache.getSnapshot(nextKey), { data: 42, loading: false, error: false });
  finish(43);
  await pending;
  assert.equal(cache.getSnapshot(nextKey).data, 43);
  assert.notEqual(dashboardRangeKey(1, firstRange), dashboardRangeKey(1, nextRange));
});

test('fixed dates and relative filters use stable, distinct display scopes', () => {
  assert.equal(dashboardRangeScopeKey(2, { start: '2026-10-10', end: '2026-10-11' }), '2026-10-10:2026-10-11');
  assert.equal(dashboardRangeScopeKey(7), 'last:7');
  assert.notEqual(dashboardRangeScopeKey(7), dashboardRangeScopeKey(30));
  assert.notEqual(dashboardRangeScopeKey(2, { start: '2026-10-10', end: '2026-10-11' }), dashboardRangeScopeKey(2, { start: '2026-10-11', end: '2026-10-12' }));
});
