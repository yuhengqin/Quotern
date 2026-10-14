import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PricingCatalogRow } from './api.ts';
import {
  DEFAULT_PRICING_SORT,
  PRICING_PAGE_SIZE,
  filterAndSortPricingCatalog,
  filterDirectPricingCatalog,
  isGatewayPricingModel,
  getPageCount,
  getPaginationItems,
  getPricingModelName,
  getPricingPage,
  getPricingProvider,
  getPricingChannel,
  formatPricingRate,
} from './pricing-catalog.ts';

const rows: PricingCatalogRow[] = [
  { model: 'Beta', input: 2, output: 3, cacheRead: 0, cacheWrite: 0 },
  { model: 'alpha-mini', input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
  { model: 'Alpha', input: 2, output: 1, cacheRead: 0, cacheWrite: 1 },
];

describe('pricing catalog helpers', () => {
  it('defaults to the highest input price first with stable model-name ties', () => {
    assert.deepEqual(DEFAULT_PRICING_SORT, {
      column: 'input',
      direction: 'descending',
    });
    const result = filterAndSortPricingCatalog(rows, '', DEFAULT_PRICING_SORT);
    assert.deepEqual(result.map((row) => row.model), ['Alpha', 'Beta', 'alpha-mini']);
  });

  it('filters model names case-insensitively after trimming the query', () => {
    const result = filterAndSortPricingCatalog(rows, '  ALPHA ', DEFAULT_PRICING_SORT);
    assert.deepEqual(result.map((row) => row.model), ['Alpha', 'alpha-mini']);
  });

  it('keeps only the final model path segment for display', () => {
    assert.equal(getPricingModelName('azure/eu/gpt-5.4'), 'gpt-5.4');
    assert.equal(getPricingModelName('claude-sonnet-4-6'), 'claude-sonnet-4-6');
  });

  it('hides known gateway prices from the direct pricing catalog', () => {
    assert.equal(isGatewayPricingModel('openrouter/openai/gpt-5.5-pro'), true);
    assert.equal(isGatewayPricingModel('POE/openai/o1-pro'), true);
    assert.equal(isGatewayPricingModel('openai/gpt-5.5-pro'), false);
    assert.equal(isGatewayPricingModel('gpt-5.5'), false);

    assert.deepEqual(
      filterDirectPricingCatalog([
        { model: 'openrouter/openai/gpt-5.5-pro', input: 30, output: 180, cacheRead: 0, cacheWrite: 0 },
        { model: 'openai/gpt-5.5-pro', input: 30, output: 180, cacheRead: 0, cacheWrite: 0 },
      ]).map((row) => row.model),
      ['openai/gpt-5.5-pro'],
    );
  });

  it('sorts output prices independently of input prices', () => {
    const result = filterAndSortPricingCatalog(rows, '', {
      column: 'output',
      direction: 'descending',
    });
    assert.deepEqual(result.map((row) => row.model), ['Beta', 'alpha-mini', 'Alpha']);
  });

  it('keeps unknown rates last in either direction and preserves zero as a price', () => {
    const samples = [
      { ...rows[0], model: 'unknown', cacheRead: null },
      { ...rows[0], model: 'free', cacheRead: 0 },
      { ...rows[0], model: 'paid', cacheRead: 1 },
    ];
    assert.deepEqual(filterAndSortPricingCatalog(samples, '', {
      column: 'cacheRead', direction: 'ascending',
    }).map((row) => row.model), ['free', 'paid', 'unknown']);
    assert.deepEqual(filterAndSortPricingCatalog(samples, '', {
      column: 'cacheRead', direction: 'descending',
    }).map((row) => row.model), ['paid', 'free', 'unknown']);
    assert.equal(formatPricingRate(null), '—');
    assert.equal(formatPricingRate(0), '$0');
    assert.equal(formatPricingRate(0.04), '$0.04');
  });

  it('groups model families and regional channels under the supplying company', () => {
    assert.equal(getPricingProvider('openai/gpt-5.3-codex').key, 'openai');
    assert.equal(getPricingProvider('anthropic/claude-sonnet-4').key, 'anthropic');
    assert.equal(getPricingProvider('moonshotai/kimi-k2').key, 'moonshot');
    assert.equal(getPricingProvider('moonshotai-cn/kimi-k2').key, 'moonshot');
    assert.equal(getPricingProvider('alibaba-cn/qwen-plus').key, 'alibaba');
    assert.equal(getPricingProvider('xiaomi/mimo-v2').key, 'xiaomi');
    assert.equal(getPricingProvider('zai/glm-5').key, 'zhipu');
    assert.equal(getPricingProvider('zhipuai/glm-5').key, 'zhipu');
    assert.equal(getPricingChannel('alibaba-cn/qwen-plus'), '中国');
    assert.equal(getPricingChannel('alibaba/qwen-plus'), '国际');
    assert.equal(getPricingChannel('openai/gpt-5'), null);
  });

  it('uses 100 rows per page and creates compact page links', () => {
    assert.equal(PRICING_PAGE_SIZE, 100);
    assert.equal(getPageCount(101), 2);
    assert.deepEqual(getPricingPage(rows, 2, 2).map((row) => row.model), ['Alpha']);
    assert.deepEqual(getPaginationItems(10, 5), [1, 'ellipsis', 4, 5, 6, 'ellipsis', 10]);
  });
});
