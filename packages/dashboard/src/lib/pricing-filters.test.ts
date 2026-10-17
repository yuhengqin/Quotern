import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { PricingCatalogRow } from './pricing-data.ts';
import { filterPricingCatalog, formatContextWindow, getRecentReleaseRange } from './pricing-filters.ts';

const rows: PricingCatalogRow[] = [
  { model: 'openai/recent', input: 1, output: 2, cacheRead: null, cacheWrite: null, contextWindow: 1_050_000, releaseDate: '2026-10-14' },
  { model: 'anthropic/month', input: 2, output: 4, cacheRead: 0, cacheWrite: null, contextWindow: 200_000, releaseDate: '2026-09' },
  { model: 'google/old', input: 0, output: 1, cacheRead: 0, cacheWrite: null, contextWindow: 32_000, releaseDate: '2025-01-01' },
  { model: 'openai/unknown', input: 1, output: 2, cacheRead: null, cacheWrite: null },
];

it('combines multiple providers, minimum context and an inclusive release interval', () => {
  const result = filterPricingCatalog(rows, { providers: ['openai', 'anthropic'], minContext: 128_000, releasedAfter: '2026-09-01', releasedBefore: '2026-10-14' });
  assert.deepEqual(result.map(row => row.model), ['openai/recent', 'anthropic/month']);
  assert.deepEqual(filterPricingCatalog(rows, { providers: ['openai'], minContext: 1_000_000 }).map(row => row.model), ['openai/recent']);
  assert.deepEqual(filterPricingCatalog(rows, {}), rows);
});

it('excludes unknown metadata only when its corresponding filter is active', () => {
  assert.equal(filterPricingCatalog(rows, { providers: ['openai'] }).length, 2);
  assert.equal(filterPricingCatalog(rows, { minContext: 1 }).length, 3);
  assert.deepEqual(filterPricingCatalog(rows, { releasedBefore: '2026-10-14' }).map(row => row.model), ['openai/recent', 'anthropic/month', 'google/old']);
});

it('matches month-precision dates by interval overlap without inventing an exact release day', () => {
  assert.deepEqual(filterPricingCatalog(rows, { releasedAfter: '2026-09-15', releasedBefore: '2026-09-16' }).map(row => row.model), ['anthropic/month']);
  assert.deepEqual(filterPricingCatalog(rows, { releasedAfter: '2026-10-01', releasedBefore: '2026-10-14' }).map(row => row.model), ['openai/recent']);
  assert.equal(filterPricingCatalog(rows, { releasedAfter: '2026-10-14', releasedBefore: '2026-09-01' }).length, 0);
});

it('uses inclusive local calendar days for recent-release shortcuts', () => {
  assert.deepEqual(getRecentReleaseRange(30, new Date(2026, 9, 14, 12)), { releasedAfter: '2026-09-15', releasedBefore: '2026-10-14' });
  assert.deepEqual(getRecentReleaseRange(2, new Date(2024, 2, 1, 12)), { releasedAfter: '2024-02-29', releasedBefore: '2024-03-01' });
});

it('formats context capacity while preserving unknown as a dash', () => {
  assert.equal(formatContextWindow(1_050_000), '1.05M');
  assert.equal(formatContextWindow(200_000), '200K');
  assert.equal(formatContextWindow(8192), '8.19K');
  assert.equal(formatContextWindow(undefined), '—');
  assert.equal(formatContextWindow(0), '—');
    assert.equal(formatContextWindow(1_050_000, 'de-DE'), '1,05M');
});
