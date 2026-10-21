import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PricingCatalogRow } from './pricing-data.ts';
import bundledPricing from 'quotern-core/pricing-data' with { type: 'json' };
import type { PricingData } from 'quotern-core/pricing-matcher';
import { pricingDataToCatalog } from './pricing-data.ts';
import { DEFAULT_PRICING_SORT } from './pricing-catalog.ts';
import { filterPricingCatalog } from './pricing-filters.ts';
import { filterAndSortPricingGroups, formatPricingContext, groupPricingCatalog } from './pricing-groups.ts';

const api: PricingCatalogRow = {
  model: 'moonshotai/kimi-k3', canonicalModelId: 'moonshotai/kimi-k3', displayName: 'Kimi K3',
  billingMode: 'api', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3,
  contextWindow: 1_048_576, releaseDate: '2026-07-16', usageTokens: 10,
};
const regionalApi = { ...api, model: 'moonshotai-cn/kimi-k3', usageTokens: 20 };
const plans: PricingCatalogRow[] = ['cn', 'global'].flatMap(region => [262_144, 1_048_576].map(contextWindow => ({
  ...api, model: `kimi-code-plan-${region}/k3${contextWindow === 262_144 ? '-256k' : ''}`,
  billingMode: 'subscription' as const, input: null, output: null, cacheRead: null, cacheWrite: null,
  contextWindow, usageTokens: 30,
})));

describe('pricing model groups', () => {
  it('shows one supplier/model, merges equal API regions, and retains subscription context variants', () => {
    const rows = [api, regionalApi, ...plans];
    const before = structuredClone(rows);
    const groups = groupPricingCatalog(rows);
    assert.equal(groups.length, 1);
    const group = groups[0]!;
    assert.equal(group.entries.length, 6);
    assert.equal(group.apiVariants.length, 1);
    assert.deepEqual(group.apiVariants[0]!.regions, ['中国', '国际']);
    assert.equal(group.input, 3);
    assert.equal(group.usageTokens, 150);
    assert.deepEqual(group.subscriptionVariants.map(variant => variant.row.contextWindow), [262_144, 1_048_576]);
    assert.ok(group.subscriptionVariants.every(variant => variant.entries.length === 2));
    assert.deepEqual(rows, before);
  });

  it('never groups different suppliers or guesses identity from equal display names', () => {
    assert.equal(groupPricingCatalog([api, { ...api, model: 'azure/kimi-k3' }]).length, 2);
    assert.equal(groupPricingCatalog([api, { ...api, model: 'moonshotai/kimi-k2', canonicalModelId: 'moonshotai/kimi-k2' }]).length, 2);
    assert.equal(groupPricingCatalog([
      { ...api, canonicalModelId: undefined }, { ...regionalApi, model: 'moonshotai-cn/unrelated', canonicalModelId: undefined },
    ]).length, 2);
  });

  it('groups real MiniMax regional APIs and plans without losing their distinct API rates', () => {
    const ids = new Set(['minimax/MiniMax-M2.5', 'minimax-cn/MiniMax-M2.5', 'minimax-coding-plan/MiniMax-M2.5', 'minimax-cn-coding-plan/MiniMax-M2.5']);
    const entries = pricingDataToCatalog(bundledPricing as PricingData, 'bundled', null).models.filter(row => ids.has(row.model));
    assert.equal(entries.length, 4);
    const groups = groupPricingCatalog(entries);
    assert.equal(groups.length, 1);
    const apiRates = new Map(entries.filter(row => row.billingMode !== 'subscription').map(row =>
      [row.model, [row.input, row.output, row.cacheRead, row.cacheWrite]] as const));
    assert.equal(apiRates.size, 2);
    const groupedApiRates = groups[0]!.apiVariants.flatMap(variant => variant.entries.map(entry =>
      [entry.model, [variant.row.input, variant.row.output, variant.row.cacheRead, variant.row.cacheWrite]] as const));
    assert.equal(groupedApiRates.length, apiRates.size);
    assert.deepEqual(new Map(groupedApiRates), apiRates);
    assert.equal(groups[0]!.subscriptionVariants.length, 1);
    assert.deepEqual(groups[0]!.subscriptionVariants[0]!.regions, ['中国', '国际']);
  });

  it('uses unique canonical evidence for a matching calling ID and leaves conflicting identities separate', () => {
    const withoutCanonical = { ...regionalApi, canonicalModelId: undefined };
    assert.equal(groupPricingCatalog([api, withoutCanonical]).length, 1);
    const conflicting = { ...plans[0]!, model: 'kimi-code-plan-cn/kimi-k3', canonicalModelId: 'moonshotai/different' };
    assert.equal(groupPricingCatalog([api, conflicting, withoutCanonical]).length, 3);
  });

  it('keeps differences in raw cache rates, context, and unknown versus zero visible', () => {
    for (const difference of [{ input: 3.1 }, { output: 15.1 }, { cacheRead: 0.3000001 }, { contextWindow: 262_144 }, { cacheWrite: null }, { cacheRead: 0 }]) {
      const group = groupPricingCatalog([api, { ...regionalApi, ...difference }])[0]!;
      assert.equal(group.apiVariants.length, 2);
    }
    const group = groupPricingCatalog([api, { ...regionalApi, billingMode: 'subscription' }])[0]!;
    assert.equal(group.apiVariants.length, 1);
    assert.equal(group.subscriptionVariants.length, 1);
  });

  it('keeps subscription product types and subscription-only models separate from API rates', () => {
    const groups = groupPricingCatalog([
      { ...plans[0]!, model: 'alibaba-coding-plan-cn/k3' },
      { ...plans[0]!, model: 'alibaba-token-plan-cn/k3' },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.billingMode, 'subscription');
    assert.equal(groups[0]!.input, null);
    assert.equal(groups[0]!.apiVariants.length, 0);
    assert.equal(groups[0]!.subscriptionVariants.length, 2);
  });

  it('searches every channel ID and sorts by combined usage without losing context filtering', () => {
    const groups = groupPricingCatalog([api, regionalApi, ...plans, {
      ...api, model: 'openai/another', canonicalModelId: 'openai/another', usageTokens: 100,
    }]);
    assert.equal(filterAndSortPricingGroups(groups, '', DEFAULT_PRICING_SORT)[0]!.canonicalModelId, api.canonicalModelId);
    const found = filterAndSortPricingGroups(groups, '  KIMI-CODE-PLAN-CN/K3-256K ', DEFAULT_PRICING_SORT);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.entries.length, 6);
    const filtered = groupPricingCatalog(filterPricingCatalog([api, regionalApi, ...plans], { minContext: 1_000_000 }));
    assert.deepEqual(filtered[0]!.subscriptionVariants.map(variant => variant.row.contextWindow), [1_048_576]);
  });

  it('labels binary context sizes as 256K and 1M while retaining decimal sizes', () => {
    assert.equal(formatPricingContext(262_144), '256K');
    assert.equal(formatPricingContext(1_048_576), '1M');
    assert.equal(formatPricingContext(200_000), '200K');
    assert.equal(formatPricingContext(undefined), '—');
  });

  it('filters by recent matched group usage while retaining unused regional and subscription channels', () => {
    const groups = groupPricingCatalog([
      { ...api, usageTokens: 7 }, { ...regionalApi, usageTokens: 0 }, ...plans.map(plan => ({ ...plan, usageTokens: 0 })),
      { ...api, model: 'openai/unused', canonicalModelId: 'openai/unused', usageTokens: 0 },
    ]);
    const visible = filterAndSortPricingGroups(groups, '', DEFAULT_PRICING_SORT, true);
    assert.equal(visible.length, 1);
    assert.equal(visible[0]!.entries.length, 6);
    assert.equal(filterAndSortPricingGroups(groups, 'unused', DEFAULT_PRICING_SORT, true).length, 0);
  });
});
