import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatPricingDisplayRate, formatPricingReleaseDate, formatPricingTokens, getPricingVariantSuffixes, getPricingVariantAliases, splitPricingHighlight } from './pricing-display.ts';

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

  it('formats displayed rates, calendar dates, and token counts for the active locale without changing values', () => {
    assert.equal(formatPricingDisplayRate(1234.5, 'USD', null, 'en').text, '≈$1,235');
    assert.equal(formatPricingDisplayRate(1234.5, 'USD', null, 'de-DE').text, '≈$1.235');
    assert.equal(formatPricingDisplayRate(1234.5, 'USD', null, 'de-DE').exact, '$1.234,5');
    assert.equal(formatPricingReleaseDate('2026-10-14', 'en'), '10/14/2026');
    assert.equal(formatPricingReleaseDate('2026-10', 'ja'), '2026/10');
    assert.equal(formatPricingReleaseDate('2026-10-14', 'ko'), '2026. 10. 14.');
    assert.equal(formatPricingTokens(10_000_000, 'ja'), '1000万');
  });

  it('keeps full calling IDs behind shortened labels, including equal labels across regions', () => {
    assert.deepEqual(getPricingVariantAliases('vendor/model', ['vendor/model-preview', 'vendor-cn/model-preview', 'vendor/model']), [
      { label: 'preview', models: ['vendor/model-preview', 'vendor-cn/model-preview'] },
    ]);
  });

  it('highlights literal case-insensitive matches without treating search input as a regex or HTML', () => {
    assert.deepEqual(splitPricingHighlight('Flash FLASH flash', ' flash '), [
      { text: 'Flash', match: true }, { text: ' ', match: false }, { text: 'FLASH', match: true },
      { text: ' ', match: false }, { text: 'flash', match: true },
    ]);
    assert.deepEqual(splitPricingHighlight('model [preview]', '[preview]'), [{ text: 'model ', match: false }, { text: '[preview]', match: true }]);
    assert.deepEqual(splitPricingHighlight('<script>', ''), [{ text: '<script>', match: false }]);
  });
});
