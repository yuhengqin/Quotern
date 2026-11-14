import assert from 'node:assert/strict';
import { it } from 'node:test';
import { pricingDataToCatalog } from './pricing-data.ts';

it('lists subscriptions with names and canonical IDs but never per-token prices', () => {
  const data = pricingDataToCatalog({
    exact: { 'moonshotai/kimi-k3': { input: 3, output: 15 }, 'api/free': { input: 0, output: 0 } },
    model_metadata: { 'moonshotai/kimi-k3': { display_name: 'Kimi K3', canonical_model_id: 'moonshotai/kimi-k3' } },
    subscription_models: { 'kimi-code-plan-cn/kimi-for-coding': {
      display_name: 'Kimi K2.8 Preview', canonical_model_id: 'moonshotai/kimi-k2.8-preview', context_window: 1_048_576,
    } },
  }, 'bundled', null);
  const plan = data.models.find(row => row.model === 'kimi-code-plan-cn/kimi-for-coding');
  assert.ok(plan);
  assert.equal(plan.billingMode, 'subscription');
  assert.equal(plan.displayName, 'Kimi K2.8 Preview');
  assert.equal(plan.canonicalModelId, 'moonshotai/kimi-k2.8-preview');
  assert.deepEqual([plan.input, plan.output, plan.cacheRead, plan.cacheWrite], [null, null, null, null]);
  assert.equal(data.models.find(row => row.model === 'api/free')?.input, 0);
});

it('replaces historical Kimi Code catalog estimates without changing cost rates', () => {
  const data = {
    exact: { 'moonshotai/kimi-for-coding': { input: 0.6, output: 3 } },
    subscription_models: { 'kimi-code-plan-cn/kimi-for-coding': { display_name: 'Kimi K2.8 Preview' } },
  };
  const result = pricingDataToCatalog(data, 'bundled', null);
  assert.deepEqual(result.models.map(row => row.model), ['kimi-code-plan-cn/kimi-for-coding']);
  assert.equal(data.exact['moonshotai/kimi-for-coding'].input, 0.6);
});

it('projects price provenance and bounded check counts without inventing legacy verification', () => {
  const result = pricingDataToCatalog({ exact: { known: { input: 1 }, legacy: { input: 2 } },
    price_metadata: { known: { source: 'litellm', status: 'carried', last_verified_at: '2026-11-13T01:00:00Z', supplemental_fields: ['cache_read'] } },
    _meta: { checked_at: '2026-11-14T01:00:00Z', sources: ['models.dev', 'litellm'], sync_report: { added: 2, changed: 3, carried: 1, conflicts: 4, large_changes: 1, failed_sources: ['litellm', 'https://private.invalid/token'] } },
  }, 'runtime', null);
  const known = result.models.find(row => row.model === 'known')!;
  assert.equal(known.priceSource, 'litellm');
  assert.equal(known.priceStatus, 'carried');
  assert.equal(known.priceVerifiedAt, '2026-11-13T01:00:00Z');
  assert.equal(result.models.find(row => row.model === 'legacy')?.priceVerifiedAt, undefined);
  assert.equal(result.checkedAt, '2026-11-14T01:00:00Z');
  assert.deepEqual(result.syncReport?.failedSources, ['litellm']);
  assert.equal(result.syncReport?.conflicts, 4);
});
