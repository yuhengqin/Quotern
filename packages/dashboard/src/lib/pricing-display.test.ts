import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatPricingDisplayRate, getPricingVariantSuffixes } from './pricing-display.ts';

describe('pricing display', () => {
  it('preserves exact variant suffixes without translating or guessing their meaning', () => {
    assert.deepEqual(getPricingVariantSuffixes('moonshotai/kimi-k2.7-code', [
      'moonshotai-cn/kimi-k2.7-code-highspeed', 'moonshotai/kimi-k2.7-code-highspeed',
    ]), ['highspeed']);
    assert.deepEqual(getPricingVariantSuffixes('vendor/model', ['vendor/model-Preview-20261001']), ['Preview-20261001']);
    assert.deepEqual(getPricingVariantSuffixes('vendor/model', ['vendor-cn/model']), []);
    assert.deepEqual(getPricingVariantSuffixes('vendor/model', ['vendor/model2', 'vendor/other-route']), ['model2', 'other-route']);
  });

  it('marks rounded prices and retains precision while never rounding tiny nonzero prices to zero', () => {
    assert.deepEqual(formatPricingDisplayRate(1.77744), { text: '≈$1.777', exact: '$1.77744', approximate: true });
    assert.deepEqual(formatPricingDisplayRate(0.002962), { text: '$0.002962', exact: '$0.002962', approximate: false });
    assert.deepEqual(formatPricingDisplayRate(0.000000123456), { text: '≈$0.0000001235', exact: '$0.000000123456', approximate: true });
    assert.deepEqual(formatPricingDisplayRate(0), { text: '$0', exact: '$0', approximate: false });
    assert.deepEqual(formatPricingDisplayRate(null), { text: '—', exact: '—', approximate: false });
    assert.deepEqual(formatPricingDisplayRate(1, 'CNY', null), { text: '—', exact: '—', approximate: false });
    assert.deepEqual(formatPricingDisplayRate(0.1, 'CNY', 7.2), { text: '¥0.72', exact: '¥0.72', approximate: false });
    assert.deepEqual(formatPricingDisplayRate(1.77744, 'CNY', 7), { text: '≈¥12.44', exact: '¥12.44208', approximate: true });
  });
});
