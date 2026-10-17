import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergePricingModelMetadata } from './pricing-metadata.mjs';

test('imports release dates only for models in the final price table', () => {
  const result = mergePricingModelMetadata({}, { vendor: { models: {
    current: { release_date: '2026-09-29', featured: true },
    excluded: { release_date: '2026-10-14' },
    invalid: { release_date: '2026-02-30' },
  } } }, { 'vendor/current': {}, 'vendor/invalid': {} });
  assert.deepEqual(result, { 'vendor/current': { release_date: '2026-09-29', release_date_source: 'models.dev' } });
});

test('preserves curated flagship flags and manual date corrections', () => {
  const result = mergePricingModelMetadata({
    'vendor/current': { featured: true, release_date: '2026-08-04', release_date_source: 'https://vendor.example/announcement' },
    'vendor/old': { featured: false, release_date: '2026-01-01', release_date_source: 'models.dev' },
    'vendor/removed': { featured: true },
  }, { vendor: { models: { current: { release_date: '2026-09-01' }, old: { release_date: '2026-02' } } } }, { 'vendor/current': {}, 'vendor/old': {} });
  assert.deepEqual(result, {
    'vendor/current': { featured: true, release_date: '2026-08-04', release_date_source: 'https://vendor.example/announcement' },
    'vendor/old': { featured: false, release_date: '2026-02', release_date_source: 'models.dev' },
  });
});

test('keeps the last known date when upstream omits or corrupts it', () => {
  const result = mergePricingModelMetadata({
    'vendor/current': { release_date: '2026-02-28', release_date_source: 'models.dev' },
  }, { vendor: { models: { current: { release_date: '2026-02-30' } } } }, { 'vendor/current': {} });
  assert.deepEqual(result, { 'vendor/current': { release_date: '2026-02-28', release_date_source: 'models.dev' } });
});

test('imports context windows only for exact final provider/model keys', () => {
  const result = mergePricingModelMetadata({}, {
    vendor: { models: {
      current: { limit: { context: 65_536 } },
      'nested/path': { limit: { context: 131_072 } },
      excluded: { limit: { context: 262_144 } },
      alias: { limit: { context: 524_288 } },
      fractional: { limit: { context: 32_768.5 } },
      unsafe: { limit: { context: Number.MAX_SAFE_INTEGER + 1 } },
    } },
  }, {
    'vendor/current': {},
    'vendor/nested/path': {},
    'vendor/fractional': {},
    'vendor/unsafe': {},
    'vendor/missing': {},
  });

  assert.deepEqual(result, {
    'vendor/current': { context_window: 65_536, context_window_source: 'models.dev' },
    'vendor/nested/path': { context_window: 131_072, context_window_source: 'models.dev' },
  });
});

test('preserves manual context windows and refreshes models.dev values', () => {
  const result = mergePricingModelMetadata({
    'vendor/manual': { context_window: 32_768, context_window_source: 'https://vendor.example/docs' },
    'vendor/upstream': { context_window: 65_536, context_window_source: 'models.dev' },
    'vendor/new': {},
  }, { vendor: { models: {
    manual: { limit: { context: 131_072 } },
    upstream: { limit: { context: 262_144 } },
    new: { limit: { context: 524_288 } },
  } } }, { 'vendor/manual': {}, 'vendor/upstream': {}, 'vendor/new': {} });

  assert.deepEqual(result, {
    'vendor/manual': { context_window: 32_768, context_window_source: 'https://vendor.example/docs' },
    'vendor/upstream': { context_window: 262_144, context_window_source: 'models.dev' },
    'vendor/new': { context_window: 524_288, context_window_source: 'models.dev' },
  });
});

test('retains the last valid context window when upstream context is missing or invalid', () => {
  const result = mergePricingModelMetadata({
    'vendor/missing': { context_window: 65_536, context_window_source: 'models.dev' },
    'vendor/zero': { context_window: 32_768, context_window_source: 'models.dev' },
    'vendor/negative': { context_window: 32_768, context_window_source: 'models.dev' },
    'vendor/fractional': { context_window: 32_768, context_window_source: 'models.dev' },
    'vendor/unsafe': { context_window: 32_768, context_window_source: 'models.dev' },
  }, { vendor: { models: {
    zero: { limit: { context: 0 } },
    negative: { limit: { context: -1 } },
    fractional: { limit: { context: 12.5 } },
    unsafe: { limit: { context: Number.MAX_SAFE_INTEGER + 1 } },
  } } }, {
    'vendor/missing': {}, 'vendor/zero': {}, 'vendor/negative': {},
    'vendor/fractional': {}, 'vendor/unsafe': {},
  });

  assert.deepEqual(result, {
    'vendor/missing': { context_window: 65_536, context_window_source: 'models.dev' },
    'vendor/zero': { context_window: 32_768, context_window_source: 'models.dev' },
    'vendor/negative': { context_window: 32_768, context_window_source: 'models.dev' },
    'vendor/fractional': { context_window: 32_768, context_window_source: 'models.dev' },
    'vendor/unsafe': { context_window: 32_768, context_window_source: 'models.dev' },
  });
});

test('imports canonical display names without changing the provider model identity', () => {
  const result = mergePricingModelMetadata({}, { vendor: { models: {
    'call-id': { name: 'Call ID', canonical_model_id: 'lab/standard-id' },
    'other-id': { name: 'Official Display Name' },
  } } }, { 'vendor/call-id': {}, 'vendor/other-id': {} }, {
    'lab/standard-id': { name: 'Standard Model', release_date: '2026-09-11', limit: { context: 1_048_576 } },
  });
  assert.deepEqual(result, {
    'vendor/call-id': {
      display_name: 'Standard Model', canonical_model_id: 'lab/standard-id',
      release_date: '2026-09-11', release_date_source: 'models.dev',
      context_window: 1_048_576, context_window_source: 'models.dev',
    },
    'vendor/other-id': { display_name: 'Official Display Name' },
  });
});
