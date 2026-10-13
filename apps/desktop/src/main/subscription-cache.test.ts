import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubscriptionCache } from './subscription-cache';

test('switching away and back cannot reuse a previous generation in-flight reading', async () => {
  const cache = createSubscriptionCache<{ status: string; stale: boolean; message: string | null; value: number }>();
  const snapshot = (value: number) => ({ status: 'ready', stale: false, message: null, value });
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = cache('A', async () => { await gate; return snapshot(1); });
  await cache('B', async () => snapshot(2));
  const latest = await cache('A', async () => snapshot(3));
  release?.(); await original;
  assert.equal((await cache('A', async () => { assert.fail('latest must be cached'); })).value, latest.value);
});
