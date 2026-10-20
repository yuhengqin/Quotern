import assert from 'node:assert/strict';
import { it } from 'node:test';
import { fetchPricingCatalog } from './api.ts';

it('falls back to bundled prices when the local runtime is unavailable', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }));
  const catalog = await fetchPricingCatalog();
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(catalog.source, 'bundled');
  assert.ok(catalog.models.length > 0);
  assert.match(catalog.generatedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
});

it('uses runtime prices even when their timestamp is older than the browser bundle', async t => {
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL) => {
    assert.equal(url, '/functions/tud-pricing');
    return new Response(JSON.stringify({ success: true, data: {
      pricing: { _meta: { generated_at: '2000-01-01T00:00:00Z' }, exact: { 'openai/gpt-fixture': { input: 7, output: 21 } } },
      status: { updatedAt: '2026-10-21T01:00:00Z', hasOverlay: true, refreshing: true },
    } }));
  });
  const catalog = await fetchPricingCatalog();
  assert.equal(catalog.source, 'runtime');
  assert.equal(catalog.models.find(row => row.model === 'openai/gpt-fixture')?.input, 7);
  assert.equal((catalog as { refreshing?: boolean }).refreshing, true);
});

it('loads public Quotern prices without sending dashboard credentials', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(
    JSON.stringify({ exact: { 'test-model': { input: 2, output: 4 } } }),
    { headers: { 'last-modified': 'Tue, 13 Oct 2026 00:00:00 GMT' } },
  ));
  const catalog = await fetchPricingCatalog('https://prices.example.test/catalog.json');
  assert.equal(fetchMock.mock.calls[0].arguments[0],
    'https://prices.example.test/catalog.json');
  const init = fetchMock.mock.calls[0].arguments[1] as RequestInit | undefined;
  assert.equal(new Headers(init?.headers).has('Authorization'), false);
  assert.equal(init?.credentials, 'omit');
  assert.deepEqual(catalog.models, [
    { model: 'test-model', input: 2, output: 4, cacheRead: null, cacheWrite: null },
  ]);
  assert.equal(catalog.updatedAt, 'Tue, 13 Oct 2026 00:00:00 GMT');
  assert.equal(catalog.source, 'published');
});

it('preserves free rates, missing rates and the price-table generation date', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    _meta: { generated_at: '2099-10-15T00:00:00.000Z' },
    exact: { free: { input: 0, cache_read: 0 }, unknown: {} },
  })));
  const catalog = await fetchPricingCatalog('https://prices.example.test/catalog.json');
  assert.equal(catalog.generatedAt, '2099-10-15T00:00:00.000Z');
  assert.deepEqual(catalog.models, [
    { model: 'free', input: 0, output: null, cacheRead: 0, cacheWrite: null },
    { model: 'unknown', input: null, output: null, cacheRead: null, cacheWrite: null },
  ]);
});

for (const failure of ['network', 'http', 'invalid-json', 'invalid-rates', 'invalid-subscriptions', 'empty-catalog'] as const) {
  it(`shows bundled prices when the remote catalog has a ${failure} failure`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => {
      if (failure === 'network') throw new TypeError('offline');
      if (failure === 'http') return new Response(null, { status: 404 });
      if (failure === 'invalid-json') return new Response('not JSON');
      if (failure === 'empty-catalog') return new Response(JSON.stringify({ exact: {} }));
      if (failure === 'invalid-subscriptions') return new Response(JSON.stringify({ exact: { good: {} }, subscription_models: { bad: null } }));
      return new Response(JSON.stringify({ exact: { bad: { input: -1 } } }));
    });
    const catalog = await fetchPricingCatalog('https://prices.example.test/catalog.json');
    assert.equal(catalog.units, 'usd_per_million_tokens');
    assert.ok(catalog.models.length > 0);
    assert.ok(catalog.models.some((row) => (row.input ?? 0) > 0 && (row.output ?? 0) > 0));
    assert.equal(catalog.updatedAt, null);
    assert.equal(catalog.source, 'bundled');
    assert.match(catalog.generatedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
  });
}

it('retains release metadata and source-specific aliases in the catalog', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    exact: { 'test/new': { input: 2, output: 4 }, 'test/invalid': { input: 1, output: 2 } },
    model_metadata: { 'test/new': { release_date: '2026-09-29', featured: true }, 'test/invalid': { release_date: '2026-02-30', featured: false } },
    sourceAlias: { codex: { auto: 'test/new' } },
  })));
  const result = await fetchPricingCatalog('https://prices.example.test/catalog.json');
  const row = result.models.find(row => row.model === 'test/new');
  assert.ok(row);
  assert.equal(row.releaseDate, '2026-09-29');
  assert.equal(row.featured, true);
  assert.equal(result.models.find(row => row.model === 'test/invalid')?.releaseDate, undefined);
  assert.deepEqual(result.matching, { sourceAlias: { codex: { auto: 'test/new' } } });
});

it('projects only valid context windows into catalog rows', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    exact: {
      'test/valid': { input: 2, output: 4 },
      'test/fractional': { input: 1, output: 2 },
      'test/zero': { input: 0, output: 0 },
      'test/missing': { input: 3, output: 5 },
    },
    model_metadata: {
      'test/valid': { context_window: 65_536 },
      'test/fractional': { context_window: 65_536.5 },
      'test/zero': { context_window: 0 },
    },
  })));
  const result = await fetchPricingCatalog('https://prices.example.test/catalog.json');
  assert.equal(result.models.find(row => row.model === 'test/valid')?.contextWindow, 65_536);
  for (const model of ['test/fractional', 'test/zero', 'test/missing']) {
    assert.equal(result.models.find(row => row.model === model)?.contextWindow, undefined);
  }
});

it('keeps a newer bundled catalog instead of replacing it with an older published table', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    _meta: { generated_at: '2000-01-01T00:00:00.000Z' }, exact: { 'obsolete-only': { input: 1, output: 1 } },
  })));
  const result = await fetchPricingCatalog('https://prices.example.test/catalog.json');
  assert.ok(result.models.some(row => row.model === 'openai/gpt-6.1-sol'));
  assert.equal(result.models.some(row => row.model === 'obsolete-only'), false);
});
