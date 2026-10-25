import assert from 'node:assert/strict';
import { test } from 'node:test';

test('demo runtime uses pre-render metadata, freezes a fresh clock value and namespaces saved preferences', async () => {
  const mod = await import('./demo-runtime.ts').catch(() => ({})) as Record<string, any>;
  assert.equal(typeof mod.dashboardNow, 'function');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  try {
    const metadata = { schemaVersion: 1, readOnly: true, exportedAt: '2026-10-22T09:00:00Z', referenceTime: '2020-01-05T12:00:00Z' };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => ({ textContent: JSON.stringify(metadata) }) } });
    assert.equal(mod.isDemoMode(), true); assert.equal(mod.dashboardNow().toISOString(), metadata.referenceTime.replace('Z', '.000Z'));
    const clock = mod.dashboardNow(); clock.setFullYear(2001); assert.equal(mod.dashboardNow().getUTCFullYear(), 2020);
    assert.notEqual(mod.demoStorageKey('tud.dashboardRange'), 'tud.dashboardRange');
    const { rollingDayRange } = await import('./dashboard-date-range.ts');
    assert.equal(rollingDayRange().toTime, '2020-01-05T12:00:00.000Z');
    const { rangeDateBounds } = await import('./time-range.ts');
    assert.deepEqual(rangeDateBounds(7), { start: '2019-12-30', end: '2020-01-05' });
    const { getRecentReleaseRange } = await import('./pricing-filters.ts');
    assert.deepEqual(getRecentReleaseRange(30), { releasedAfter: '2019-12-07', releasedBefore: '2020-01-05' });
    const { readPricingExchangeRate, writePricingExchangeRate, PRICING_EXCHANGE_RATE_STORAGE_KEY } = await import('./pricing-currency.ts');
    const normalQuote = { rate: 7, date: null, source: 'manual' as const, fetchedAt: 123 };
    const demoQuote = { ...normalQuote, rate: 8 };
    const values = new Map([[PRICING_EXCHANGE_RATE_STORAGE_KEY, JSON.stringify(normalQuote)]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    assert.equal(readPricingExchangeRate(storage), null);
    writePricingExchangeRate(demoQuote, storage);
    assert.deepEqual(readPricingExchangeRate(storage), demoQuote);
    assert.equal(values.get(PRICING_EXCHANGE_RATE_STORAGE_KEY), JSON.stringify(normalQuote));
    assert.equal(values.get(mod.demoStorageKey(PRICING_EXCHANGE_RATE_STORAGE_KEY)), JSON.stringify(demoQuote));
  } finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); }
  assert.equal(mod.isDemoMode(), false); assert.equal(mod.demoStorageKey('tud.dashboardRange'), 'tud.dashboardRange');
  assert.ok(Math.abs(mod.dashboardNow().getTime() - Date.now()) < 1000);
});

test('invalid demo metadata fails closed before normal preferences or mutation paths can run', async () => {
  const mod = await import('./demo-runtime.ts').catch(() => ({})) as Record<string, any>;
  assert.equal(typeof mod.getDemoMetadata, 'function');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => ({ textContent: '{"schemaVersion":99}' }) } });
    assert.throws(() => mod.getDemoMetadata(), /demo|演示/i);
  } finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); }
});
