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
