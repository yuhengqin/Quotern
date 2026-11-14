import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as turn } from 'node:timers/promises';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startPricingRefresh, resetPricingRuntime, getModelPricing, getPricingStatus, getPricingFingerprint } from '../src/pricing/index.js';

const HOUR = 3_600_000, DAY = 24 * HOUR;
const body = (rate: number) => Response.json({ exact: { 'cycle-fixture': { input: rate, output: 2 } } });
type Refreshable = ReturnType<typeof startPricingRefresh> & { refreshIfStale(): Promise<boolean> };
test.afterEach(() => resetPricingRuntime());

test('a long-running runtime refreshes after 24h and fresh resume checks do not fetch', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-11-14T00:00:00Z') });
  let calls = 0;
  const handle = startPricingRefresh({ url: 'https://fixture.invalid/prices', firstFetchTimeoutMs: 1000,
    fetchImpl: async () => body(++calls) }) as Refreshable;
  assert.equal(await handle.ready, true);
  assert.equal(typeof handle.refreshIfStale, 'function');
  t.mock.timers.tick(DAY - 1); await turn();
  assert.equal(await handle.refreshIfStale(), false);
  assert.equal(getModelPricing('cycle-fixture').input, 1);
  t.mock.timers.tick(1); await turn();
  assert.equal(getModelPricing('cycle-fixture').input, 2);
  assert.equal(calls, 2);
  handle();
  t.mock.timers.tick(DAY); await turn(); assert.equal(calls, 2);
});

test('timer and concurrent resume checks share one in-flight request', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-11-14T00:00:00Z') });
  let calls = 0, release!: (value: Response) => void;
  const handle = startPricingRefresh({ url: 'https://fixture.invalid/prices', firstFetchTimeoutMs: 1000,
    fetchImpl: async () => ++calls === 1 ? body(1) : new Promise(resolve => { release = resolve; }) }) as Refreshable;
  await handle.ready;
  assert.equal(typeof handle.refreshIfStale, 'function');
  t.mock.timers.tick(DAY); await turn();
  const a = handle.refreshIfStale(), b = handle.refreshIfStale();
  assert.equal(calls, 2); release(body(4));
  await Promise.all([a, b]);
  assert.equal(getModelPricing('cycle-fixture').input, 4);
  assert.equal(calls, 2); handle();
});

test('failed refreshes retain prices and cannot retry on each resume within one hour', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-11-14T00:00:00Z') });
  let calls = 0;
  const handle = startPricingRefresh({ url: 'https://fixture.invalid/prices', firstFetchTimeoutMs: 1000,
    fetchImpl: async () => ++calls === 1 ? body(7) : new Response('offline', { status: 503 }) }) as Refreshable;
  await handle.ready; assert.equal(typeof handle.refreshIfStale, 'function');
  t.mock.timers.tick(DAY); await turn();
  assert.equal(calls, 2); assert.equal(getModelPricing('cycle-fixture').input, 7);
  await handle.refreshIfStale(); t.mock.timers.tick(HOUR - 1); await handle.refreshIfStale();
  assert.equal(calls, 2);
  t.mock.timers.tick(1); await turn(); assert.equal(calls, 3); handle();
});

test('successful metadata-only revalidation advances freshness without invalidating usage costs', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-11-14T00:00:00Z') });
  const changes: boolean[] = [];
  const handle = startPricingRefresh({ url: 'https://models.dev/catalog.json', firstFetchTimeoutMs: 1000,
    fetchImpl: async url => String(url).includes('models.dev') ? Response.json({ providers: { openai: { models: { 'gpt-cycle': { cost: { input: 1, output: 2 } } } } } }) : new Response('', { status: 503 }),
    onUpdate: (_status, change?: { ratesChanged: boolean }) => changes.push(change?.ratesChanged ?? true),
  });
  await handle.ready; const initial = getPricingFingerprint();
  t.mock.timers.tick(DAY); await turn();
  assert.equal(getPricingFingerprint(), initial);
  assert.equal(changes.filter(Boolean).length, 1);
  assert.equal((getPricingStatus() as { checkedAt?: string }).checkedAt, '2026-11-15T00:00:00.000Z');
  handle();
});

test('a stopped delayed refresh cannot replace the new generation on disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-price-generation-'));
  try {
    let release!: (response: Response) => void;
    const old = startPricingRefresh({ url: 'https://fixture.invalid/old', dataDir: dir,
      fetchImpl: async () => new Promise(resolve => { release = resolve; }) });
    old();
    const current = startPricingRefresh({ url: 'https://fixture.invalid/new', dataDir: dir, firstFetchTimeoutMs: 1000,
      fetchImpl: async () => body(9) });
    await current.ready; release(body(1)); await turn();
    assert.equal(JSON.parse(await readFile(join(dir, 'pricing-overlay.json'), 'utf8')).exact['cycle-fixture'].input, 9);
    current();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
