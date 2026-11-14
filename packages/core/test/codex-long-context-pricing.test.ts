import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { AggregateCache } from '../src/aggregate-cache.js';
import * as core from '../src/pricing/index.js';
import type { RequestPricingFact } from '../src/pricing/request-pricing.js';
import { prepareSessionObservations, type SessionObservation } from '../src/session-observation.js';
import { buildUsageReport } from '../src/usage-report.js';
import type { QueueBucket } from '../src/types.js';

const timestamp = '2026-11-13T04:00:00Z';
const sol = 'openai/gpt-6.1-sol';
const rates = {
  [sol]: { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 },
  'openai/gpt-6-astra': { input: 10, output: 50, cache_read: 1, cache_write: 12.5 },
  'openai/gpt-6-luna': { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125 },
};
function fact(patch: Partial<RequestPricingFact> = {}): RequestPricingFact {
  return { id: 'request', timestamp, input_tokens: 10_000, cached_input_tokens: 280_000,
    cache_creation_input_tokens: 1_000, output_tokens: 6_000, reasoning_output_tokens: 4_000,
    requestInputTokens: 291_000, serviceTier: 'standard', ...patch };
}
function bucket(requests = [fact()], patch: Partial<QueueBucket> = {}): QueueBucket {
  return { source: 'codex', model: sol, project: 'pricing-fixture', hour_start: timestamp,
    input_tokens: requests.reduce((sum, r) => sum + r.input_tokens, 0),
    output_tokens: requests.reduce((sum, r) => sum + r.output_tokens, 0),
    cached_input_tokens: requests.reduce((sum, r) => sum + r.cached_input_tokens, 0),
    cache_creation_input_tokens: requests.reduce((sum, r) => sum + r.cache_creation_input_tokens, 0),
    reasoning_output_tokens: requests.reduce((sum, r) => sum + r.reasoning_output_tokens, 0),
    total_tokens: 0, conversation_count: requests.length, pricing_requests: requests, ...patch };
}
afterEach(() => core.resetPricingRuntime());

for (const [model, tier, expected] of [
  [sol, 'standard', 0.251], [sol, 'fast', 0.502], [sol, 'flex', 0.1255],
  ['openai/gpt-6-astra', 'standard', 1.535], ['openai/gpt-6-astra', 'fast', 3.07], ['openai/gpt-6-astra', 'flex', 0.7675],
  ['openai/gpt-6-luna', 'standard', 0.01535], ['openai/gpt-6-luna', 'fast', 0.0307], ['openai/gpt-6-luna', 'flex', 0.007675],
] as const) {
  test(`${model} ${tier} combines whole-request long-context and tier prices`, () => {
    core.applyRemotePricingOverlay({ exact: rates });
    const row = bucket([fact({ serviceTier: tier })], { model });
    assert.equal(core.computeRowCost(row), expected);
    const explanation = core.explainRowCost(row);
    assert.equal(explanation.costUsd, expected);
    assert.equal(explanation.unpricedTokens, 0);
    assert.equal(explanation.items!.reduce((sum, item) => sum + item.tokens, 0), 301_000);
    assert.ok(explanation.requestPricing!.ruleReferences.includes('https://developers.openai.com/api/docs/pricing'));
  });
}

test('272K is short context and one more cached input token reprices the entire request', () => {
  core.applyRemotePricingOverlay({ exact: rates });
  assert.equal(core.computeRowCost(bucket([fact({ cached_input_tokens: 261_000, requestInputTokens: 272_000 })])), 0.1486);
  assert.equal(core.computeRowCost(bucket([fact({ cached_input_tokens: 261_001, requestInputTokens: 272_001 })])), 0.2472002);
});

test('a bucket of short requests does not acquire a long-context surcharge', () => {
  core.applyRemotePricingOverlay({ exact: rates });
  const small = fact({ cached_input_tokens: 200_000, cache_creation_input_tokens: 0,
    output_tokens: 50, reasoning_output_tokens: 50, requestInputTokens: 210_000 });
  assert.equal(core.computeRowCost(bucket([small, { ...small, id: 'second' }])), 0.082);
});

test('unknown complete input keeps tier pricing and unannotated legacy quantities keep base pricing', () => {
  core.applyRemotePricingOverlay({ exact: rates });
  assert.equal(core.computeRowCost(bucket([fact({ requestInputTokens: undefined, serviceTier: 'fast' })])), 0.301);
  assert.equal(core.computeRowCost(bucket([], { input_tokens: 300_000 })), 0.6);
  assert.equal(core.computeRowCost(bucket([fact({ serviceTier: 'unknown' })])), 0.251);
});

test('current long-context reference pricing does not invent a historical effective date', () => {
  core.applyRemotePricingOverlay({ exact: rates });
  const old = fact({ timestamp: '2026-09-30T04:00:00Z', serviceTier: 'fast' });
  assert.equal(core.computeRowCost(bucket([old])), 0.251, 'the existing Fast effective-date boundary remains in force');
});

test('manual base rates and explicit zero rates receive the applicable combined modifiers', () => {
  core.applyRemotePricingOverlay({ exact: rates });
  core.applyManualPricing({ version: 1, models: { [sol]: { input: 3, output: 0, cache_read: 0.2, cache_write: 0 } } });
  const row = bucket([fact({ serviceTier: 'fast' })]);
  assert.equal(core.computeRowCost(row), 0.344);
  assert.equal(core.explainRowCost(row).unpricedTokens, 0);
});

test('long-context estimates retain missing component prices as unknown', () => {
  const row = bucket();
  core.applyRemotePricingOverlay({ exact: { [sol]: { input: 2 } } });
  assert.equal(core.computeRowCost(row), 0.04);
  assert.equal(core.explainRowCost(row).unpricedTokens, 291_000);
  assert.equal(core.explainRowCost(row).items!.find(item => item.category === 'output')!.costUsd, null);
  core.applyRemotePricingOverlay({ exact: { [sol]: { input: 2, output: 0, cache_read: 0, cache_write: 0 } } });
  assert.equal(core.computeRowCost(row), 0.04);
  assert.equal(core.explainRowCost(row).unpricedTokens, 0);
});

test('an explicit matching tier-and-length rule still overrides the generated rates', () => {
  core.applyRemotePricingOverlay({ exact: rates, request_rules: [{ model: sol, source: 'codex',
    serviceTier: 'fast', minInputTokens: 272_000,
    rates: { input: 7, output: 11, cache_read: 0.3, cache_write: 6 },
    reference: 'https://example.test/custom-context-price' }] });
  assert.equal(core.computeRowCost(bucket([fact({ serviceTier: 'fast' })])), 0.27);
});

test('the new built-in modifiers do not spread to other sources or third-party pricing IDs', () => {
  core.applyRemotePricingOverlay({ exact: { ...rates, 'other/gpt-6.1-sol': rates[sol] } });
  assert.equal(core.computeRowCost(bucket(undefined, { source: 'pi' })), 0.1505);
  assert.equal(core.computeRowCost(bucket(undefined, { model: 'other/gpt-6.1-sol' })), 0.1505);
});

test('persisted subscription estimates reprice from facts while source-reported amounts are preserved', () => {
  core.applyRemotePricingOverlay({ exact: rates });
  const request = fact();
  const event: SessionObservation = { id: 'stored', source: 'codex', sessionId: 'session', timestamp,
    model: sol, tokens: 301_000, usageKnown: true, tokenParts: request, pricingFact: request,
    requestKnown: true, costBasis: 'request-facts', costUsd: 0.1505, costKind: 'estimated',
    billing: { service: 'openai', mode: 'subscription', accountRef: null, evidence: 'recorded' } };
  const original = structuredClone(event);
  assert.equal(prepareSessionObservations([event]).events[0]!.costUsd, 0.251);
  assert.equal(prepareSessionObservations([{ ...event, costKind: 'recorded', costUsd: 0.123 }]).events[0]!.costUsd, 0.123);
  assert.deepEqual(event, original);
  const report = buildUsageReport([bucket()], { period: 'summary', fromDate: '2026-11-13', toDate: '2026-11-13' },
    { collectSince: '2026-01-01', now: new Date('2026-11-14T04:00:00Z') });
  assert.equal(report.summary.knownCostUsd, 0.251);
});

test('a sealed cache with the old table-only fingerprint is rejected and rebuilt from request facts', async () => {
  core.applyRemotePricingOverlay({ exact: rates });
  const dir = await mkdtemp(join(tmpdir(), 'quotern-context-price-'));
  try {
    await new AggregateCache(dir).rebuildFromRows([bucket([fact({ requestInputTokens: undefined })])]);
    const path = join(dir, 'cache', 'daily-sealed.json');
    const sealed = JSON.parse(await readFile(path, 'utf8'));
    sealed.pricingFingerprint = createHash('sha256').update(JSON.stringify(core.getPricingSnapshot())).digest('hex');
    await writeFile(path, JSON.stringify(sealed));
    const cache = new AggregateCache(dir);
    await cache.ensureLoaded();
    assert.equal(cache.getUsageSummary([bucket()], '2026-01-01').totalCostUsd, 0.251);
    await cache.onBucketsChanged([bucket()]);
    assert.equal(cache.getUsageSummary([bucket()], '2026-01-01').totalCostUsd, 0.251);
    assert.notEqual(JSON.parse(await readFile(path, 'utf8')).pricingFingerprint, sealed.pricingFingerprint);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
