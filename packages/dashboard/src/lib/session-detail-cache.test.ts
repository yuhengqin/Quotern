import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionActivity } from 'quotern-core';
import { SessionDetailCache, sessionDetailQuery } from './session-detail-cache.ts';

const row = (sessionId: string, source = 'codex') => ({ source, sessionId, tokens: 123 }) as SessionActivity;

test('full snapshot rows open without loading and source is part of the identity', async () => {
  let calls = 0;
  const cached = row('same');
  const cache = new SessionDetailCache(async source => { calls++; return [row('same', source)]; }, [cached]);
  assert.equal(await cache.load(cached), cached);
  assert.equal(calls, 0);
  assert.equal((await cache.load(row('same', 'claude')))?.source, 'claude');
  assert.equal(calls, 1);
});

test('prefetch and clicks for siblings share a single source reading and retain full rows', async () => {
  let release!: (rows: SessionActivity[]) => void;
  let calls = 0;
  const cache = new SessionDetailCache(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  const first = cache.load(row('a')), second = cache.load(row('b'));
  await Promise.resolve();
  assert.equal(calls, 1);
  const a = row('a'), b = row('b');
  release([a, b]);
  assert.deepEqual(await Promise.all([first, second]), [a, b]);
  assert.equal(await cache.load(b), b);
  assert.equal(await cache.load(row('missing')), null);
  assert.equal(calls, 1);
});

test('failed prefetch can retry, and explicit retry refreshes a missing source snapshot', async () => {
  let calls = 0;
  const cache = new SessionDetailCache(async () => {
    calls++;
    if (calls === 1) throw Error('offline');
    return calls === 2 ? [] : [row('a')];
  });
  await assert.rejects(cache.load(row('a')), /offline/);
  assert.equal(await cache.load(row('a')), null);
  assert.equal((await cache.load(row('a'), true))?.sessionId, 'a');
  assert.equal(calls, 3);
});

test('source reads have bounded concurrency and separate dialog caches cannot mix periods', async () => {
  let active = 0, peak = 0;
  const cache = new SessionDetailCache(async source => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--; return [row('a', source)];
  });
  await Promise.all(['codex','claude','dsh'].map(source => cache.load(row('a', source))));
  assert.equal(peak, 2);
  const nextPeriod = new SessionDetailCache(async () => [{ ...row('a'), tokens: 456 }]);
  assert.equal((await nextPeriod.load(row('a')))?.tokens, 456);
  assert.equal(cache.get(row('a'))?.tokens, 123);
});

test('detail fallback queries freeze the parent calendar or exact instant window', () => {
  const calendar = new URL(sessionDetailQuery('codex', { fromDate: '2026-10-01', toDate: '2026-10-02', kind: 'selected' }), 'https://fixture.local');
  assert.equal(calendar.searchParams.get('sources'), 'codex');
  assert.equal(calendar.searchParams.get('fromDate'), '2026-10-01');
  assert.equal(calendar.searchParams.get('sessionId'), null, 'one reading supplies complete sibling rows');
  const instant = new URL(sessionDetailQuery('claude', { fromDate: '2026-10-01', toDate: '2026-10-02', fromTime: '2026-10-01T12:00:00Z', toTime: '2026-10-02T12:00:00Z', kind: 'selected' }), 'https://fixture.local');
  assert.equal(instant.searchParams.get('fromTime'), '2026-10-01T12:00:00Z');
  assert.equal(instant.searchParams.get('fromDate'), null);
});
