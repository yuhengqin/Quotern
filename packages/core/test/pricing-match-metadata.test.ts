import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { lookupPricing, lookupPricingStacked, type LookupResult, type PricingData } from '../src/pricing/matcher.js';

type MetadataResult = LookupResult & { matchedModel?: string; table?: 'overlay' | 'builtin' };

function pricing(exact: PricingData['exact'], extra: Partial<PricingData> = {}): PricingData {
  return { exact, ...extra };
}

describe('pricing lookup match metadata', () => {
  test('reports the exact key for each successful match path without changing source or value', () => {
    const cases = [
      {
        model: 'vendor/model-v1',
        data: pricing({ 'vendor/model-v1': { input: 1 } }),
        source: 'exact',
        matchedModel: 'vendor/model-v1',
        value: { input: 1 },
      },
      {
        model: 'model-2-4',
        data: pricing({ 'Model-2.4': { input: 2 } }),
        source: 'exact-dot',
        matchedModel: 'Model-2.4',
        value: { input: 2 },
      },
      {
        model: 'prefix-core-2-4-suffix',
        data: pricing({ 'core-2.4': { input: 3 } }),
        source: 'exact-contained',
        matchedModel: 'core-2.4',
        value: { input: 3 },
      },
      {
        model: 'model-v1-high',
        data: pricing({ 'model-v1': { input: 4 } }),
        source: 'suffix-strip',
        matchedModel: 'model-v1',
        value: { input: 4 },
      },
      {
        model: 'model-v1',
        data: pricing({ 'provider/model-v1': { input: 5 } }),
        source: 'prefix-strip',
        matchedModel: 'provider/model-v1',
        value: { input: 5 },
      },
      {
        model: 'friendly-name',
        data: pricing({ canonical: { input: 6 } }, { alias: { 'friendly-name': 'canonical' } }),
        source: 'alias',
        matchedModel: 'canonical',
        value: { input: 6 },
      },
      {
        model: 'friendly-name',
        data: pricing({ canonical: { input: 7 } }, { sourceAlias: { agent: { 'friendly-name': 'canonical' } } }),
        source: 'sourceAlias:agent',
        matchedModel: 'canonical',
        value: { input: 7 },
        provider: 'agent',
      },
      {
        model: 'prefix-fuzzy-marker-suffix',
        data: pricing({ canonical: { input: 8 } }, { fuzzy: [{ match: 'fuzzy-marker', ref: 'canonical' }] }),
        source: 'fuzzy',
        matchedModel: 'canonical',
        value: { input: 8 },
      },
      {
        model: 'wrapped-canonical-model-token',
        data: pricing({ 'canonical-model': { input: 9 } }),
        source: 'fuzzy-litellm',
        matchedModel: 'canonical-model',
        value: { input: 9 },
      },
    ];

    for (const { model, data, source, matchedModel, value, provider } of cases) {
      const result = lookupPricing(model, data, provider) as MetadataResult;
      assert.equal(result.hit, true, `${model} should match`);
      assert.equal(result.source, source);
      assert.deepEqual(result.value, value);
      assert.equal(result.matchedModel, matchedModel);
    }
  });

  test('does not report matchedModel for default, miss, or empty input', () => {
    const builtin = pricing({}, { default: { input: 10 } });
    const fallback = lookupPricingStacked('unknown', null, builtin) as MetadataResult;
    assert.equal(fallback.hit, true);
    assert.equal(fallback.source, 'default');
    assert.deepEqual(fallback.value, { input: 10 });
    assert.equal(fallback.matchedModel, undefined);
    assert.equal(fallback.table, 'builtin');

    const miss = lookupPricing('unknown', pricing({})) as MetadataResult;
    assert.equal(miss.source, 'miss');
    assert.equal(miss.value, null);
    assert.equal(miss.matchedModel, undefined);

    const empty = lookupPricing('', pricing({})) as MetadataResult;
    assert.equal(empty.source, 'empty');
    assert.equal(empty.value, null);
    assert.equal(empty.matchedModel, undefined);
  });

  test('labels overlay, builtin, and fallback rate origins while preserving source and value', () => {
    const overlay = pricing(
      { 'overlay-model': { input: 11 } },
      { alias: { 'builtin-alias': 'builtin-model' }, default: { input: 12 } },
    );
    const builtin = pricing({ 'builtin-model': { input: 13 }, 'local-model': { input: 14 } }, { default: { input: 15 } });

    const overlayExact = lookupPricingStacked('overlay-model', overlay, builtin) as MetadataResult;
    assert.equal(overlayExact.source, 'exact');
    assert.deepEqual(overlayExact.value, { input: 11 });
    assert.equal(overlayExact.matchedModel, 'overlay-model');
    assert.equal(overlayExact.table, 'overlay');

    const overlayAliasToBuiltin = lookupPricingStacked('builtin-alias', overlay, builtin) as MetadataResult;
    assert.equal(overlayAliasToBuiltin.source, 'alias');
    assert.deepEqual(overlayAliasToBuiltin.value, { input: 13 });
    assert.equal(overlayAliasToBuiltin.matchedModel, 'builtin-model');
    assert.equal(overlayAliasToBuiltin.table, 'builtin');

    const local = lookupPricingStacked('local-model', overlay, builtin) as MetadataResult;
    assert.equal(local.source, 'exact');
    assert.deepEqual(local.value, { input: 14 });
    assert.equal(local.matchedModel, 'local-model');
    assert.equal(local.table, 'builtin');

    const overlayDefault = lookupPricingStacked('unknown', overlay, builtin) as MetadataResult;
    assert.equal(overlayDefault.source, 'default');
    assert.deepEqual(overlayDefault.value, { input: 12 });
    assert.equal(overlayDefault.matchedModel, undefined);
    assert.equal(overlayDefault.table, 'overlay');
  });
});
