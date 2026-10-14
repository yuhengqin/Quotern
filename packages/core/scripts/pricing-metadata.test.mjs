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
