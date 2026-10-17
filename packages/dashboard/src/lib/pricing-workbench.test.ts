import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PricingCatalogRow } from './pricing-data.ts';
import { estimatePricingCost, getCacheReadSavings, togglePricingComparison, type PricingScenario } from './pricing-workbench.ts';

const row: PricingCatalogRow = { model: 'vendor/model', input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };
const scenario: PricingScenario = { input: 10_000_000, output: 1_000_000, cacheRead: 2_000_000, cacheWrite: 1_000_000 };

describe('pricing scenario estimates', () => {
  it('charges ordinary input, output, cache reads and writes once each in million-token units', () => {
    assert.deepEqual(estimatePricingCost(row, scenario), { status: 'ready', totalUsd: 32.9, missing: [] });
    assert.equal(estimatePricingCost({ ...row, input: 1 }, scenario).totalUsd, 22.9);
  });

  it('does not turn missing prices into free usage, but permits an unused missing cache rate', () => {
    assert.deepEqual(estimatePricingCost({ ...row, cacheWrite: null }, scenario), { status: 'missing', totalUsd: null, missing: ['cacheWrite'] });
    assert.equal(estimatePricingCost({ ...row, cacheWrite: null }, { ...scenario, cacheWrite: 0 }).totalUsd, 30.4);
    assert.equal(estimatePricingCost({ ...row, input: 0 }, scenario).totalUsd, 12.9);
  });

  it('never prices subscription quotas with API token rates', () => {
    assert.deepEqual(estimatePricingCost({ ...row, billingMode: 'subscription' }, scenario), { status: 'subscription', totalUsd: null, missing: [] });
  });

  it('rejects invalid quantities and totals rather than presenting a misleading estimate', () => {
    for (const input of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(estimatePricingCost(row, { ...scenario, input }).status, 'invalid');
    }
    assert.equal(estimatePricingCost({ ...row, input: Infinity }, scenario).status, 'missing');
  });

  it('only reports a cache saving for known API rates with a positive input baseline', () => {
    assert.equal(getCacheReadSavings(row), 90);
    assert.equal(getCacheReadSavings({ ...row, cacheRead: 0 }), 100);
    assert.equal(getCacheReadSavings({ ...row, cacheRead: null }), null);
    assert.equal(getCacheReadSavings({ ...row, input: 0 }), null);
    assert.equal(getCacheReadSavings({ ...row, cacheRead: 3 }), -50);
    assert.equal(getCacheReadSavings({ ...row, billingMode: 'subscription' }), null);
  });
});

describe('pricing comparison selection', () => {
  it('keeps at most four distinct models and still allows removal at the limit', () => {
    const selected = ['a', 'b', 'c', 'd'];
    assert.deepEqual(togglePricingComparison(selected, 'e'), selected);
    assert.deepEqual(togglePricingComparison(selected, 'b'), ['a', 'c', 'd']);
    assert.deepEqual(togglePricingComparison(['a'], 'b'), ['a', 'b']);
    assert.deepEqual(selected, ['a', 'b', 'c', 'd']);
  });
});
