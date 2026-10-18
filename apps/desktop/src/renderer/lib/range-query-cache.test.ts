import assert from 'node:assert/strict';
import test from 'node:test';
import { RangeQueryCache } from './range-query-cache.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('visited ranges remain visible while refreshing and after a refresh failure', async () => {
  const cache = new RangeQueryCache<number>();
  assert.deepEqual(cache.getSnapshot('7D'), { data: null, loading: true, error: false });
  await cache.refresh('7D', 'first', async () => 7);
  await cache.refresh('30D', 'first', async () => 30);
  const update = deferred<number>();
  const pending = cache.refresh('7D', 'second', () => update.promise);
  assert.deepEqual(cache.getSnapshot('7D'), { data: 7, loading: false, error: false });
  assert.equal(cache.getSnapshot('30D').data, 30);
  update.reject(new Error('offline'));
  await pending;
  assert.deepEqual(cache.getSnapshot('7D'), { data: 7, loading: false, error: true });
  await cache.refresh('7D', 'third', async () => 8);
  assert.deepEqual(cache.getSnapshot('7D'), { data: 8, loading: false, error: false });
});

test('an unavailable first reading is distinct from a loading or successful zero reading', async () => {
  const cache = new RangeQueryCache<number>();
  await cache.refresh('empty', 1, async () => { throw new Error('offline'); });
  assert.deepEqual(cache.getSnapshot('empty'), { data: null, loading: false, error: true });
  await cache.refresh('empty', 2, async () => 0);
  assert.deepEqual(cache.getSnapshot('empty'), { data: 0, loading: false, error: false });
  assert.deepEqual(cache.getSnapshot('another-filter'), { data: null, loading: true, error: false });
});

test('late responses cannot replace a newer reading of the same rolling window', async () => {
  const cache = new RangeQueryCache<number>();
  const old = deferred<number>();
  const pending = cache.refresh('1D', '09:00', () => old.promise);
  await cache.refresh('1D', '09:01', async () => 11);
  old.resolve(10);
  await pending;
  assert.equal(cache.getSnapshot('1D').data, 11);
});

test('overlapping refresh triggers share the same request and notify subscribers on completion', async () => {
  const cache = new RangeQueryCache<number>();
  const result = deferred<number>();
  let calls = 0, updates = 0;
  const unsubscribe = cache.subscribe(() => { updates++; });
  const load = () => { calls++; return result.promise; };
  const first = cache.refresh('7D', 'same', load);
  const second = cache.refresh('7D', 'same', load);
  result.resolve(7);
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.ok(updates > 0);
  unsubscribe();
  const before = updates;
  await cache.refresh('30D', 'other', async () => 30);
  assert.equal(updates, before);
});

test('cache entries are bounded and recently refreshed ranges survive eviction', async () => {
  const cache = new RangeQueryCache<number>(2);
  await cache.refresh('1D', 1, async () => 1);
  await cache.refresh('7D', 1, async () => 7);
  await cache.refresh('1D', 2, async () => 2);
  await cache.refresh('30D', 1, async () => 30);
  assert.equal(cache.getSnapshot('7D').data, null);
  assert.equal(cache.getSnapshot('1D').data, 2);
  assert.equal(cache.getSnapshot('30D').data, 30);
});

test('an omitted freshness token can still start the first request', async () => {
  const cache = new RangeQueryCache<number>();
  await cache.refresh('7D', undefined, async () => 7);
  assert.equal(cache.getSnapshot('7D').data, 7);
});
