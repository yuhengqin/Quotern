import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyManualPricing, readManualPricing, updateManualPricing, validateManualPricing } from '../src/pricing/manual-pricing.js';
import { applyRemotePricingOverlay, explainRowCost, getModelPricingRates, getReferencePricingData, getPricingEditPreview, resetPricingRuntime } from '../src/pricing/index.js';

test('manual rates preserve explicit zero, inherit missing fields and never contaminate reference pricing', () => {
  resetPricingRuntime();
  applyRemotePricingOverlay({ exact: { 'test-model': { input: 2, output: 6 } }, alias: { 'test-alias': 'test-model' } });
  applyManualPricing({ version: 1, models: { 'test-model': { input: 0 } } });
  assert.deepEqual(getModelPricingRates('test-alias'), { input: 0, output: 6 });
  assert.equal(getModelPricingRates('test-model-custom-channel')!.input, 2);
  assert.equal(getReferencePricingData().exact['test-model']!.input, 2);
  applyManualPricing({ version: 1, models: {} });
  assert.equal(getModelPricingRates('test-alias')!.input, 2);
  resetPricingRuntime();
});

test('manual unknown IDs only match explicitly and supplier reported costs retain priority', () => {
  resetPricingRuntime();
  const before = getModelPricingRates('new-custom-channel-suffix');
  applyManualPricing({ version: 1, models: { 'new-custom-channel': { input: 3, output: 0 } } });
  assert.equal(getModelPricingRates('new-custom-channel')!.input, 3);
  assert.deepEqual(getModelPricingRates('new-custom-channel-suffix'), before);
  const row = { source: 'cursor', model: 'new-custom-channel', reported_cost_usd: 2, input_tokens: 1_000_000 } as Parameters<typeof explainRowCost>[0];
  assert.equal(explainRowCost(row).costUsd, 2);
  resetPricingRuntime();
});

test('manual persistence rejects invalid rates and concurrent stale revisions; deleting restores empty state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'manual-pricing-'));
  try {
    for (const rates of [{ input: -1 }, { input: null }, { input: Infinity }, { extra: 1 }, {}]) assert.throws(() => validateManualPricing({ version: 1, models: { model: rates } }));
    const before = readManualPricing(dir);
    const next = await updateManualPricing(dir, before.revision, 'model', { input: 0 });
    assert.equal(next.document.models.model!.input, 0);
    await assert.rejects(updateManualPricing(dir, before.revision, 'model', { input: 1 }), /PRICING_CONFLICT/);
    const final = await updateManualPricing(dir, next.revision, 'model', null);
    assert.deepEqual(final.document.models, {});
  } finally { await rm(dir, { recursive: true, force: true }); resetPricingRuntime(); }
});

test('edit preview uses reference matching and removal reveals an alias target override', () => {
  resetPricingRuntime();
  try {
    applyRemotePricingOverlay({ exact: { 'test-model': { input: 2, output: 6 } }, alias: { 'test-alias': 'test-model' } });
    applyManualPricing({ version: 1, models: { 'test-model': { input: 3 }, 'test-alias': { output: 0 } } });
    assert.deepEqual(getPricingEditPreview('test-alias'), { reference: { input: 2, output: 6 }, effective: { input: 2, output: 0 }, restored: { input: 3, output: 6 } });
    assert.deepEqual(getModelPricingRates('test-alias'), { input: 2, output: 0 }, 'preview never mutates runtime prices');
  } finally { resetPricingRuntime(); }
});
