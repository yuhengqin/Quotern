import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import * as pricing from '../src/pricing/index.js';
import type { QueueBucket } from '../src/types.js';

const row = (patch: Partial<QueueBucket> = {}): QueueBucket => ({
  source: 'codex', model: 'test-model', project: 'Quotern',
  hour_start: '2026-10-15T00:00:00Z', input_tokens: 100, output_tokens: 20,
  cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
  total_tokens: 120, conversation_count: 1, ...patch,
});
afterEach(() => pricing.resetPricingRuntime());

test('cost details retain exact model/table/publication time and existing numeric cost', () => {
  pricing.applyRemotePricingOverlay({ exact: { 'test-model': { input: 2, output: 10 } }, _meta: { generated_at: '2026-10-01T00:00:00Z' } });
  const explain = (pricing as unknown as { explainRowCost?: (value: QueueBucket) => any }).explainRowCost;
  assert.equal(typeof explain, 'function');
  const detail = explain!(row());
  assert.equal(detail.matchedModel, 'test-model');
  assert.equal(detail.matchMethod, 'exact');
  assert.equal(detail.priceTable, 'overlay');
  assert.equal(detail.priceUpdatedAt, '2026-10-01T00:00:00Z');
  assert.equal(detail.costUsd, pricing.computeRowCost(row()));
  assert.equal(detail.costKind, 'model_estimate');
});

test('default estimates are explicit and missing rates are not confirmed free', () => {
  const explain = (pricing as unknown as { explainRowCost?: (value: QueueBucket) => any }).explainRowCost;
  assert.equal(typeof explain, 'function');
  pricing.applyRemotePricingOverlay({ exact: { 'no-rate': {} }, default: { input: 1, output: 2 } });
  assert.equal(explain!(row({ model: 'unlisted-xyz-92873' })).costKind, 'default_estimate');
  const unknown = explain!(row({ model: 'no-rate' }));
  assert.equal(unknown.costUsd, null);
  assert.equal(unknown.unpricedTokens, 120);
  assert.equal(unknown.costKind, 'unpriced');
});

test('partial rate coverage and source-reported costs remain distinguishable', () => {
  const explain = (pricing as unknown as { explainRowCost?: (value: QueueBucket) => any }).explainRowCost;
  assert.equal(typeof explain, 'function');
  pricing.applyRemotePricingOverlay({ exact: { 'test-model': { input: 2 } } });
  const partial = explain!(row());
  assert.equal(partial.unpricedTokens, 20);
  assert.equal(partial.costUsd, 0.0002);
  assert.equal(partial.priceUpdatedAt, null);
  const reported = explain!(row({ source: 'cursor', reported_cost_usd: 1.25 }));
  assert.equal(reported.costKind, 'reported');
  assert.equal(reported.costUsd, 1.25);
  assert.equal(reported.unpricedTokens, 0);
  assert.equal(reported.matchedModel, null);
});
