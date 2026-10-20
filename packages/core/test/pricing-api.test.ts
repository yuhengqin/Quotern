import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore } from '../src/server/state.js';
import { applyRemotePricingOverlay, computeRowCost, resetPricingRuntime } from '../src/pricing/index.js';
import type { TudConfig } from '../src/types.js';

test('pricing endpoint returns the effective prices used by runtime cost calculation without syncing', async () => {
  try {
    applyRemotePricingOverlay({ exact: { 'openai/gpt-fixture': { input: 7, output: 21 } }, model_metadata: { 'openai/gpt-fixture': { display_name: 'Runtime fixture' } } });
    const app = createLocalApiApp({ dataDir: 'unused-pricing-test', getConfig: () => ({} as TudConfig), bucketStore: new BucketStore(), runSyncViaRunner: async () => { throw new Error('must not sync'); } });
    const response = await app.request('/functions/tud-pricing');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { data } = await response.json();
    assert.equal('url' in data.status, false, 'custom source URLs can contain credentials and must stay private');
    assert.equal(data.pricing.exact['openai/gpt-fixture'].input, 7);
    assert.equal(data.pricing.model_metadata['openai/gpt-fixture'].display_name, 'Runtime fixture');
    assert.ok(data.pricing.exact['anthropic/claude-sonnet-4-5']);
    assert.equal(computeRowCost({ hour_start: '', source: 'codex', model: 'openai/gpt-fixture', project: '', input_tokens: 1_000_000, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 1_000_000, conversation_count: 1 }), 7);
  } finally { resetPricingRuntime(); }
});
