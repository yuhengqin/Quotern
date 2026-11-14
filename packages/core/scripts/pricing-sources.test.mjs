import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeModelsDevPricing } from '../src/pricing/models-dev.mjs';

const checked = '2026-11-14T10:00:00.000Z';
const later = '2026-11-15T10:00:00.000Z';
const catalog = models => ({ providers: { openai: { models } } });
const model = cost => ({ modalities: { input: ['text'], output: ['text'] }, cost });
const ll = (input = 1e-6, output = 2e-6, extra = {}) => ({
  litellm_provider: 'openai', mode: 'chat', input_cost_per_token: input, output_cost_per_token: output, ...extra,
});
const merge = async (...args) => (await import('../src/pricing/pricing-sources.mjs')).mergePricingSources(...args);

test('models.dev omissions preserve compatible known cache rates without fabricating zeros', () => {
  const next = mergeModelsDevPricing({ exact: { 'openai/gpt-fixture': { input: 1, output: 2, cache_read: 0.1, cache_write: 1.25 } } },
    catalog({ 'gpt-fixture': model({ input: 1, output: 2 }) }), checked);
  assert.deepEqual(next.exact['openai/gpt-fixture'], { input: 1, output: 2, cache_read: 0.1, cache_write: 1.25 });
});

test('new base rates do not inherit incompatible old cache rates', () => {
  const next = mergeModelsDevPricing({ exact: { 'openai/gpt-fixture': { input: 9, output: 18, cache_read: 0.9 } } },
    catalog({ 'gpt-fixture': model({ input: 1, output: 2, cache_write: 0 }) }), checked);
  assert.deepEqual(next.exact['openai/gpt-fixture'], { input: 1, output: 2, cache_write: 0 });
});

test('LiteLLM adds qualified first-party text IDs and never claims a reseller bare name', async () => {
  const next = await merge({ exact: {} }, { liteLlm: {
    'gpt-new': ll(),
    'openai/gpt-new': ll(9e-6, 9e-6),
    'claude-resale': { ...ll(), litellm_provider: 'bedrock' },
    'azure/gpt-cloud': ll(),
    'gpt-embedding': ll(1e-6, 2e-6, { mode: 'embedding' }),
    'gpt-image': ll(1e-6, 2e-6, { mode: 'image_generation' }),
  } }, checked);
  assert.deepEqual(next.exact, { 'openai/gpt-new': { input: 1, output: 2 } });
  assert.equal(next.price_metadata['openai/gpt-new'].source, 'litellm');
  assert.equal(next.price_metadata['openai/gpt-new'].last_verified_at, checked);
});

test('primary prices win and only identical base rates permit a secondary cache fill', async () => {
  const next = await merge({ exact: { supplement: { input: 8, output: 9 } }, alias: { short: 'supplement' } }, {
    modelsDev: catalog({ 'gpt-same': model({ input: 1, output: 2 }), 'gpt-conflict': model({ input: 3, output: 6 }) }),
    liteLlm: { 'gpt-same': ll(1e-6, 2e-6, { cache_read_input_token_cost: 0.1e-6 }),
      'gpt-conflict': ll(9e-6, 18e-6, { cache_read_input_token_cost: 0.9e-6 }) },
  }, checked);
  assert.deepEqual(next.exact['openai/gpt-same'], { input: 1, output: 2, cache_read: 0.1 });
  assert.deepEqual(next.exact['openai/gpt-conflict'], { input: 3, output: 6 });
  assert.deepEqual(next.exact.supplement, { input: 8, output: 9 });
  assert.deepEqual(next.alias, { short: 'supplement' });
  assert.equal(next._meta.sync_report.conflicts, 1);
  assert.deepEqual(next.price_metadata['openai/gpt-same'].supplemental_fields, ['cache_read']);
});

test('a second sync updates fields owned by the secondary source and retains their provenance on failure', async () => {
  const primary = catalog({ 'gpt-fixture': model({ input: 1, output: 2 }) });
  const first = await merge({ exact: {} }, { modelsDev: primary, liteLlm: { 'gpt-fixture': ll(1e-6, 2e-6, { cache_read_input_token_cost: 0.1e-6 }) } }, checked);
  const next = await merge(first, { modelsDev: primary, liteLlm: { 'gpt-fixture': ll(1e-6, 2e-6, { cache_read_input_token_cost: 0.2e-6 }) } }, later);
  assert.equal(next.exact['openai/gpt-fixture'].cache_read, 0.2);
  assert.deepEqual(next.price_metadata['openai/gpt-fixture'].supplemental_fields, ['cache_read']);
  const offline = await merge(first, { modelsDev: primary, failedSources: ['litellm'] }, later);
  assert.equal(offline.exact['openai/gpt-fixture'].cache_read, 0.1);
  assert.deepEqual(offline.price_metadata['openai/gpt-fixture'].supplemental_fields, ['cache_read']);
});

test('secondary-owned cache fields yield to new explicit primary fields', async () => {
  const primary = catalog({ 'gpt-fixture': model({ input: 1, output: 2 }) });
  const first = await merge({ exact: {} }, { modelsDev: primary, liteLlm: { 'gpt-fixture': ll(1e-6, 2e-6, { cache_read_input_token_cost: 0.1e-6 }) } }, checked);
  const next = await merge(first, { modelsDev: catalog({ 'gpt-fixture': model({ input: 1, output: 2, cache_read: 0 }) }),
    liteLlm: { 'gpt-fixture': ll(1e-6, 2e-6, { cache_read_input_token_cost: 0.2e-6 }) } }, later);
  assert.equal(next.exact['openai/gpt-fixture'].cache_read, 0);
  assert.equal(next.price_metadata['openai/gpt-fixture'].supplemental_fields, undefined);
});

test('a repeated secondary snapshot preserves compatible cache fields omitted upstream', async () => {
  const first = await merge({ exact: {} }, { liteLlm: { 'gpt-fixture': ll(1e-6, 2e-6, { cache_read_input_token_cost: 0.1e-6 }) } }, checked);
  const next = await merge(first, { liteLlm: { 'gpt-fixture': ll() } }, later);
  assert.equal(next.exact['openai/gpt-fixture'].cache_read, 0.1);
});

test('an unavailable source does not turn last verified entries into deleted models', async () => {
  const old = await merge({ exact: {} }, { liteLlm: { 'gpt-old': ll() } }, checked);
  const failed = await merge(old, { modelsDev: catalog({ 'gpt-new': model({ input: 3, output: 4 }) }), failedSources: ['litellm'] }, later);
  assert.equal(failed.price_metadata['openai/gpt-old'].status, 'current');
  assert.equal(failed.price_metadata['openai/gpt-old'].last_verified_at, checked);
  const removed = await merge(old, { liteLlm: { 'gpt-new': ll() } }, later);
  assert.deepEqual(removed.exact['openai/gpt-old'], { input: 1, output: 2 });
  assert.equal(removed.price_metadata['openai/gpt-old'].status, 'carried');
  assert.equal(removed.price_metadata['openai/gpt-old'].last_verified_at, checked);
});

test('legacy supplements keep unknown provenance until observed in a successful source', async () => {
  const next = await merge({ exact: { manual: { input: 1, output: 2 } } }, { liteLlm: { 'gpt-new': ll() } }, checked);
  assert.equal(next.price_metadata.manual, undefined);
});

test('explicit zeros survive and invalid source rates never replace known values', async () => {
  const next = await merge({ exact: { 'openai/gpt-old': { input: 5, output: 6 } } }, { liteLlm: {
    'gpt-old': ll(-1, 2e-6), 'gpt-free': ll(0, 0, { cache_read_input_token_cost: 0 }),
    'gpt-overflow': ll(Number.MAX_VALUE, 2e-6),
    'gpt-unknown': ll(null, 1e-6), 'gpt-bad-cache': ll(1e-6, 2e-6, { cache_read_input_token_cost: -1 }),
  } }, checked);
  assert.deepEqual(next.exact['openai/gpt-old'], { input: 5, output: 6 });
  assert.deepEqual(next.exact['openai/gpt-free'], { input: 0, output: 0, cache_read: 0 });
  assert.equal(next.exact['openai/gpt-unknown'], undefined);
  assert.equal(next.exact['openai/gpt-overflow'], undefined);
  assert.equal(next.exact['openai/gpt-bad-cache'].cache_read, undefined);
});

test('quality summaries count changes fully while keeping details bounded', async () => {
  const existing = {}, upstream = {};
  for (let i = 0; i < 80; i++) { existing[`openai/gpt-${i}`] = { input: 1, output: 2 }; upstream[`gpt-${i}`] = model({ input: 10, output: 20 }); }
  const next = await merge({ exact: existing }, { modelsDev: catalog(upstream) }, checked);
  assert.equal(next._meta.sync_report.changed, 80);
  assert.equal(next._meta.sync_report.large_changes, 80);
  assert.ok(next._meta.sync_report.details.length <= 50);
});

test('partial source failures preserve usable primary data and are visible in the report', async () => {
  const { loadPricingSources } = await import('../src/pricing/pricing-sources.mjs');
  const next = await loadPricingSources({ exact: {} }, async url => {
    if (url.includes('models.dev')) return Response.json(catalog({ 'gpt-fixture': model({ input: 1, output: 2 }) }));
    return new Response('unavailable', { status: 503 });
  }, undefined, checked);
  assert.deepEqual(next.exact['openai/gpt-fixture'], { input: 1, output: 2 });
  assert.deepEqual(next._meta.sync_report.failed_sources, ['litellm']);
});

test('both invalid sources reject instead of stamping old prices as freshly verified', async () => {
  const { loadPricingSources } = await import('../src/pricing/pricing-sources.mjs');
  await assert.rejects(loadPricingSources({ exact: { old: { input: 1, output: 2 } } }, async () => Response.json({}), undefined, checked), /pricing sources/);
});
