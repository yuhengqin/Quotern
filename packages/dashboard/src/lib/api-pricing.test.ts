import assert from 'node:assert/strict';
import { it } from 'node:test';
import { fetchPricingCatalog } from './api.ts';

it('loads public Quotern prices without sending dashboard credentials', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(
    JSON.stringify({ exact: { 'test-model': { input: 2, output: 4 } } }),
    { headers: { 'last-modified': 'Tue, 13 Oct 2026 00:00:00 GMT' } },
  ));
  const catalog = await fetchPricingCatalog();
  assert.equal(fetchMock.mock.calls[0].arguments[0],
    'https://raw.githubusercontent.com/yuhengqin/Quotern/main/packages/core/src/pricing/pricing.json');
  const init = fetchMock.mock.calls[0].arguments[1] as RequestInit | undefined;
  assert.equal(new Headers(init?.headers).has('Authorization'), false);
  assert.deepEqual(catalog.models, [
    { model: 'test-model', input: 2, output: 4, cacheRead: 0, cacheWrite: 0 },
  ]);
  assert.equal(catalog.updatedAt, 'Tue, 13 Oct 2026 00:00:00 GMT');
});

for (const failure of ['network', 'http', 'invalid-json', 'invalid-rates'] as const) {
  it(`shows bundled prices when the remote catalog has a ${failure} failure`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => {
      if (failure === 'network') throw new TypeError('offline');
      if (failure === 'http') return new Response(null, { status: 404 });
      if (failure === 'invalid-json') return new Response('not JSON');
      return new Response(JSON.stringify({ exact: { bad: { input: -1 } } }));
    });
    const catalog = await fetchPricingCatalog();
    assert.equal(catalog.units, 'usd_per_million_tokens');
    assert.ok(catalog.models.length > 0);
    assert.ok(catalog.models.some((row) => row.input > 0 && row.output > 0));
    assert.equal(catalog.updatedAt, null);
  });
}
