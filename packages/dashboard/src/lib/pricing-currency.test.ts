import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  createManualPricingExchangeRate,
  fetchPricingExchangeRate,
  formatConvertedPricingRate,
  formatPricingExchangeRate,
  needsPricingExchangeRateRefresh,
  readPricingExchangeRate,
  writePricingExchangeRate,
  type PricingExchangeRate,
} from './pricing-currency.ts';

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

it('formats small USD and CNY rates without losing significant digits', () => {
  assert.equal(formatConvertedPricingRate(0.0000001234567), '$0.000000123457');
  assert.equal(formatConvertedPricingRate(1.23456789, 'USD'), '$1.23457');
  assert.equal(formatConvertedPricingRate(1.25, 'CNY', 6.6874), '¥8.35925');
  assert.equal(formatConvertedPricingRate(1234.5, 'USD', null, 'de-DE'), '$1.234,5');
});

it('localizes the exchange-rate decimal separator without dropping quote precision', () => {
  assert.equal(formatPricingExchangeRate(6.6874, 'en'), '6.6874');
  assert.equal(formatPricingExchangeRate(6.6874, 'de-DE'), '6,6874');
});

it('formats all four CNY price fields with the same currency formatter', () => {
  const fields = [
    { value: 1.25, expected: '¥8.35925' },
    { value: 2.5, expected: '¥16.7185' },
    { value: 0.125, expected: '¥0.835925' },
    { value: 0.625, expected: '¥4.17963' },
  ];

  for (const { value, expected } of fields) {
    assert.equal(formatConvertedPricingRate(value, 'CNY', 6.6874), expected);
  }
});

it('keeps zero visible and marks unknown or invalid prices with a dash', () => {
  assert.equal(formatConvertedPricingRate(0), '$0');
  assert.equal(formatConvertedPricingRate(0, 'CNY', 6.6874), '¥0');
  for (const value of [null, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.equal(formatConvertedPricingRate(value), '—');
  }
  assert.equal(formatConvertedPricingRate(1, 'CNY', null), '—');
  assert.equal(formatConvertedPricingRate(1, 'CNY', 0), '—');
});

it('persists valid exchange rates and ignores corrupt or unavailable storage', () => {
  const storage = new MemoryStorage();
  const quote: PricingExchangeRate = {
    rate: 6.6874,
    date: '2026-10-14',
    source: 'frankfurter',
    fetchedAt: 1_792_000_000_000,
  };

  writePricingExchangeRate(quote, storage);
  assert.deepEqual(readPricingExchangeRate(storage), quote);
  assert.equal(readPricingExchangeRate(), null);

  const invalidQuotes = [
    '{',
    JSON.stringify({ ...quote, rate: 0 }),
    JSON.stringify({ ...quote, rate: Number.POSITIVE_INFINITY }),
    JSON.stringify({ ...quote, fetchedAt: -1 }),
    JSON.stringify({ ...quote, source: 'unknown' }),
    JSON.stringify({ ...quote, date: '2026-02-30' }),
    JSON.stringify({ ...quote, date: null }),
    JSON.stringify({ ...quote, source: 'manual', date: '2026-10-14' }),
  ];
  for (const value of invalidQuotes) {
    const corruptStorage = new MemoryStorage();
    corruptStorage.values.set('quotern.pricing.exchange-rate.v1', value);
    assert.equal(readPricingExchangeRate(corruptStorage), null);
  }

  const manualStorage = new MemoryStorage();
  manualStorage.values.set('quotern.pricing.exchange-rate.v1', JSON.stringify({
    rate: 7.1,
    date: null,
    source: 'manual',
    fetchedAt: 123,
  }));
  assert.deepEqual(readPricingExchangeRate(manualStorage), {
    rate: 7.1,
    date: null,
    source: 'manual',
    fetchedAt: 123,
  });

  const unavailableStorage = { getItem() { throw new Error('blocked'); } };
  assert.equal(readPricingExchangeRate(unavailableStorage), null);
  assert.doesNotThrow(() => writePricingExchangeRate(quote, {
    setItem() { throw new Error('blocked'); },
  }));
});

it('does not persist an invalid exchange rate', () => {
  let writes = 0;
  writePricingExchangeRate({
    rate: 0,
    date: '2026-10-14',
    source: 'frankfurter',
    fetchedAt: 1,
  }, { setItem() { writes += 1; } });
  assert.equal(writes, 0);
});

it('refreshes missing, stale, or too-far-future automatic rates', () => {
  const now = 1_792_000_000_000;
  const current: PricingExchangeRate = {
    rate: 6.6874,
    date: '2026-10-14',
    source: 'frankfurter',
    fetchedAt: now,
  };

  assert.equal(needsPricingExchangeRateRefresh(null, now), true);
  assert.equal(needsPricingExchangeRateRefresh(current, now), false);
  assert.equal(needsPricingExchangeRateRefresh({ ...current, fetchedAt: now - 12 * 60 * 60 * 1000 }, now), false);
  assert.equal(needsPricingExchangeRateRefresh({ ...current, fetchedAt: now - 12 * 60 * 60 * 1000 - 1 }, now), true);
  assert.equal(needsPricingExchangeRateRefresh({ ...current, fetchedAt: now + 5 * 60 * 1000 }, now), false);
  assert.equal(needsPricingExchangeRateRefresh({ ...current, fetchedAt: now + 5 * 60 * 1000 + 1 }, now), true);
});

it('never refreshes a manual exchange-rate override', () => {
  const manual = createManualPricingExchangeRate(7.1, 1_792_000_000_000);
  assert.ok(manual);
  assert.equal(manual.source, 'manual');
  assert.equal(manual.date, null);
  assert.equal(needsPricingExchangeRateRefresh({ ...manual, fetchedAt: 0 }, 1_792_000_000_000), false);
});

it('creates manual rates only for finite positive values', () => {
  assert.deepEqual(createManualPricingExchangeRate(7.1, 123), {
    rate: 7.1,
    date: null,
    source: 'manual',
    fetchedAt: 123,
  });
  for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(createManualPricingExchangeRate(rate, 123), null);
  }
});

it('fetches the public USD-to-CNY quote and records its source and time', async () => {
  let requestedUrl: unknown;
  let requestInit: RequestInit | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrl = input;
    requestInit = init;
    return new Response(JSON.stringify({
      date: '2026-10-14',
      base: 'USD',
      quote: 'CNY',
      rate: 6.6874,
    }));
  };

  const quote = await fetchPricingExchangeRate(fetcher, 1_792_000_000_000);
  assert.equal(requestedUrl, 'https://api.frankfurter.dev/v2/rate/USD/CNY');
  assert.deepEqual(Object.keys(requestInit ?? {}).sort(), ['signal']);
  assert.ok(requestInit?.signal instanceof AbortSignal);
  assert.deepEqual(quote, {
    rate: 6.6874,
    date: '2026-10-14',
    source: 'frankfurter',
    fetchedAt: 1_792_000_000_000,
  });
});

it('rejects failed or malformed exchange-rate responses with a short Chinese error', async () => {
  const responses: Array<() => Promise<Response>> = [
    async () => { throw new TypeError('offline'); },
    async () => new Response(null, { status: 503 }),
    async () => new Response('not JSON'),
    async () => new Response(JSON.stringify({ date: '2026-10-14', base: 'EUR', quote: 'CNY', rate: 6.7 })),
    async () => new Response(JSON.stringify({ date: '2026-10-14', base: 'USD', quote: 'JPY', rate: 6.7 })),
    async () => new Response(JSON.stringify({ date: '2026-02-30', base: 'USD', quote: 'CNY', rate: 6.7 })),
    async () => new Response(JSON.stringify({ date: '2026-10-14', base: 'USD', quote: 'CNY', rate: 0 })),
    async () => new Response(JSON.stringify({ date: '2026-10-14', base: 'USD', quote: 'CNY', rate: Number.NaN })),
  ];

  for (const respond of responses) {
    await assert.rejects(
      fetchPricingExchangeRate(async () => respond(), 1_792_000_000_000),
      (error: unknown) => error instanceof Error && /[\u4e00-\u9fff]/.test(error.message),
    );
  }
});
