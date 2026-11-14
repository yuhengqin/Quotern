import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergePricingSources } from '../src/pricing/pricing-sources.mjs';
import { priceRequest, type RequestPricingFact, type RequestPricingRule } from '../src/pricing/request-pricing.js';
import type { PricingData } from '../src/pricing/matcher.js';
import { applyPricingSnapshot, applyRemotePricingOverlay, computeRowCost, getPricingFingerprint, resetPricingRuntime } from '../src/pricing/index.js';

const model = 'openai/gpt-pricing-fixture';
const base = { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6, litellm_provider: 'openai', mode: 'chat' };
const context = { input_cost_per_token_above_272k_tokens: 2e-6, output_cost_per_token_above_272k_tokens: 3e-6 };
const fast = { input_cost_per_token_priority: 3e-6, output_cost_per_token_priority: 6e-6 };
const fact = (input: number, extra: Partial<RequestPricingFact> = {}): RequestPricingFact => ({
  id: 'fixture', timestamp: '2026-11-14T00:00:00Z', input_tokens: input, output_tokens: 1,
  cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
  requestInputTokens: input, serviceTier: 'standard', ...extra,
});
const converted = (entry: Record<string, unknown>, current: PricingData = { exact: {} }) =>
  mergePricingSources(current, { liteLlm: { 'gpt-pricing-fixture': { ...base, ...entry } } }, '2026-11-14T00:00:00Z');
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('imported context prices apply only strictly above the complete request threshold', () => {
  const table = converted(context), rules = table.request_rules ?? [];
  close(priceRequest(fact(272000), table.exact[model], rules).cost, 0.272002);
  close(priceRequest(fact(272001), table.exact[model], rules).cost, 0.544005);
});

test('explicit tier-context combinations use published fields rather than multiplying base tiers', () => {
  const table = converted({ ...context, ...fast,
    input_cost_per_token_above_272k_tokens_priority: 4e-6, output_cost_per_token_above_272k_tokens_priority: 9e-6,
    input_cost_per_token_flex: 0.5e-6, output_cost_per_token_flex: 1e-6,
    input_cost_per_token_above_272k_tokens_flex: 0.75e-6, output_cost_per_token_above_272k_tokens_flex: 1.25e-6,
  });
  close(priceRequest(fact(272001, { serviceTier: 'fast' }), table.exact[model], table.request_rules ?? []).cost, 1.088013);
  close(priceRequest(fact(272001, { serviceTier: 'flex' }), table.exact[model], table.request_rules ?? []).cost, 0.204002);
});

test('unpublished tier-context combinations stay unknown and curated rules can resolve them', () => {
  const table = converted({ ...context, ...fast });
  const missing = priceRequest(fact(272001, { serviceTier: 'fast' }), table.exact[model], table.request_rules ?? []);
  assert.equal(missing.unpricedTokens, 272002);
  assert.equal(missing.cost, 0);
  assert.equal(missing.items.find(item => item.category === 'input')?.rateUsdPerMillion, null);
  const curated: RequestPricingRule = { model, source: 'codex', serviceTier: 'fast', minInputTokens: 272000,
    rates: { input: 4, output: 9 }, reference: 'https://example.com/verified-pricing' };
  const verified = converted({ ...context, ...fast }, { exact: {}, request_rules: [curated] });
  close(priceRequest(fact(272001, { serviceTier: 'fast' }), verified.exact[model], verified.request_rules ?? []).cost, 1.088013);
});

test('published automatic relationships follow user base rates without changing absolute curated rules', () => {
  const table = converted(context);
  const adjusted = priceRequest(fact(272001), { input: 10, output: 20 }, table.request_rules ?? []);
  assert.equal(adjusted.items.find(item => item.category === 'input')?.rateUsdPerMillion, 20);
  assert.equal(adjusted.items.find(item => item.category === 'output')?.rateUsdPerMillion, 30);
});

test('a curated condition owns its historical date boundaries even before it becomes eligible', () => {
  const table = converted(fast, { exact: {}, request_rules: [{ model, source: 'codex', serviceTier: 'fast',
    effectiveFrom: '2026-12-01T00:00:00Z', rates: { input: 3, output: 6 }, reference: 'https://example.com/effective-pricing' }] });
  const priced = priceRequest(fact(1000, { serviceTier: 'fast' }), table.exact[model], table.request_rules ?? []);
  close(priced.cost, 0.001002);
});

test('automatic rates cannot fill missing effective base fields with stale absolute rates', () => {
  const table = converted(context);
  const priced = priceRequest(fact(272001), { input: 1 }, table.request_rules ?? []);
  close(priced.cost, 0.544002);
  assert.equal(priced.unpricedTokens, 1);
  assert.equal(priced.items.find(item => item.category === 'output')?.rateUsdPerMillion, null);
});

test('an explicit unknown TTL combination does not fall back to ordinary cache write', () => {
  const rule: RequestPricingRule = { model, source: 'codex', origin: 'litellm', serviceTier: 'fast', minInputTokens: 1000,
    rates: { cache_write: 2 }, unpriced: ['cache_write_1h'], reference: 'https://example.com/published-combinations' };
  const priced = priceRequest(fact(1001, { output_tokens: 0, cache_creation_input_tokens: 100, cacheWrite1hTokens: 100,
    requestInputTokens: 1101, serviceTier: 'fast' }), { input: 1, output: 2, cache_write: 1 }, [rule]);
  close(priced.cost, 0.001001);
  assert.equal(priced.unpricedTokens, 100);
  assert.equal(priced.items.find(item => item.category === 'cache_write_1h')?.rateUsdPerMillion, null);
});

test('a successful new automatic rule set replaces old bundled conditions in final cost calculation', () => {
  try {
    const builtin = converted(fast);
    const overlay = converted({}, builtin);
    applyPricingSnapshot({ builtin, overlay });
    const request = fact(1000, { serviceTier: 'fast' });
    const cost = computeRowCost({ source: 'codex', model, project: 'fixture', hour_start: request.timestamp,
      input_tokens: 1000, output_tokens: 1, cached_input_tokens: 0, cache_creation_input_tokens: 0,
      reasoning_output_tokens: 0, total_tokens: 1001, conversation_count: 1, pricing_requests: [request] });
    close(cost, 0.001002);
  } finally { applyPricingSnapshot(null); resetPricingRuntime(); }
});

test('Anthropic explicit fast and TTL rates retain distinct five-minute and one-hour prices', () => {
  const table = mergePricingSources({ exact: {} }, { liteLlm: { 'claude-pricing-fixture': {
    ...base, litellm_provider: 'anthropic', input_cost_per_token: 3e-6, output_cost_per_token: 15e-6,
    cache_creation_input_token_cost: 3.75e-6, cache_creation_input_token_cost_above_1hr: 6e-6,
    provider_specific_entry: { fast: 2 },
  } } });
  const priced = priceRequest(fact(0, { output_tokens: 0, cache_creation_input_tokens: 100,
    cacheWrite5mTokens: 40, cacheWrite1hTokens: 60, requestInputTokens: 100, serviceTier: 'fast' }),
  table.exact['anthropic/claude-pricing-fixture'], table.request_rules ?? []);
  close(priced.cost, 0.00102);
});

test('base-price conflicts cannot introduce secondary tier prices', () => {
  const table = converted({ ...context, ...fast }, { exact: { [model]: { input: 10, output: 20 } } });
  assert.equal(table.request_rules?.filter(rule => rule.model === model).length ?? 0, 0);
});

test('freshness metadata alone does not invalidate computed usage costs', () => {
  try {
    applyRemotePricingOverlay({ exact: { fixture: { input: 1, output: 2 } },
      _meta: { checked_at: '2026-11-14T00:00:00Z' }, price_metadata: { fixture: { source: 'models.dev', last_verified_at: '2026-11-14T00:00:00Z' } } });
    const initial = getPricingFingerprint();
    applyRemotePricingOverlay({ exact: { fixture: { input: 1, output: 2 } },
      _meta: { checked_at: '2026-11-15T00:00:00Z' }, price_metadata: { fixture: { source: 'models.dev', last_verified_at: '2026-11-15T00:00:00Z' } } });
    assert.equal(getPricingFingerprint(), initial);
    applyRemotePricingOverlay({ exact: { fixture: { input: 3, output: 2 } } });
    assert.notEqual(getPricingFingerprint(), initial);
  } finally { resetPricingRuntime(); }
});
