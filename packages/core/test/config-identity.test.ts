import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  alignLookbackFloors,
  bakedPricingConfig,
  DEFAULT_STATS_SINCE_DAYS,
  daysAgoIso,
  ensureIdentity,
  ensurePricingAligned,
  resolveLocalCollectSince,
  touchStatsSince,
} from '../src/config.js';
import {
  BAKED_PRICING_TTL_MS,
  BAKED_PRICING_URL,
  resolvePricingRefreshConfig,
} from '../src/pricing/index.js';
import type { TudConfig } from '../src/types.js';

function baseConfig(partial?: Partial<TudConfig>): TudConfig {
  return {
    deviceId: '550e8400-e29b-41d4-a716-446655440000',
    statsSince: '2026-01-01T00:00:00.000Z',
    hostname: 'test',
    dataDir: '/tmp',
    pricing: bakedPricingConfig(),
    serverPort: 8452,
    lastSyncAt: null,
    ...partial,
  };
}

test('ensureIdentity seeds pricing when missing', () => {
  const config = baseConfig();
  delete config.pricing;
  const { changed } = ensureIdentity(config);
  assert.equal(changed, true);
  assert.deepEqual(config.pricing, {
    url: BAKED_PRICING_URL,
    ttlMs: BAKED_PRICING_TTL_MS,
  });
});

test('ensureIdentity preserves an explicit pricing source and its refresh configuration', () => {
  const config = baseConfig({
    pricing: {
      url: 'https://old.example/pricing.json',
      ttlMs: 60_000,
    },
  });
  const { changed } = ensureIdentity(config);
  assert.equal(changed, false);
  assert.deepEqual(config.pricing, { url: 'https://old.example/pricing.json', ttlMs: 60_000 });
});

test('the retired built-in pricing URL migrates to bundled mode idempotently', () => {
  const config = baseConfig({ pricing: {
    url: 'https://raw.githubusercontent.com/yuhengqin/Quotern/main/packages/core/src/pricing/pricing.json', ttlMs: 120_000,
  } });
  assert.equal(ensurePricingAligned(config), true);
  assert.deepEqual(config.pricing, { url: '', ttlMs: 120_000 });
  assert.equal(ensurePricingAligned(config), false);
});

test('ensurePricingAligned no-op when already matching bake', () => {
  const config = baseConfig({ pricing: bakedPricingConfig() });
  assert.equal(ensurePricingAligned(config), false);
});

test('daysAgoIso and resolveLocalCollectSince helpers', () => {
  assert.equal(DEFAULT_STATS_SINCE_DAYS, 90);
  const fixed = Date.parse('2026-08-05T12:00:00.000Z');
  assert.equal(daysAgoIso(7, fixed), '2026-07-29T12:00:00.000Z');
  const withLocal = baseConfig({
    statsSince: '2026-08-01T00:00:00.000Z',
    localCollectSince: '2026-07-01T00:00:00.000Z',
  });
  assert.equal(resolveLocalCollectSince(withLocal), '2026-07-01T00:00:00.000Z');
  const legacy = baseConfig({ statsSince: '2026-08-01T00:00:00.000Z' });
  delete legacy.localCollectSince;
  assert.equal(resolveLocalCollectSince(legacy), '2026-08-01T00:00:00.000Z');
});

test('touchStatsSince defaults to now-90d and seeds localCollectSince', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-stats-'));
  try {
    const config = baseConfig({
      statsSince: '',
      dataDir: dir,
    });
    delete config.localCollectSince;
    const before = Date.now();
    await touchStatsSince(dir, config);
    const after = Date.now();
    const expectedMin = before - DEFAULT_STATS_SINCE_DAYS * 86_400_000 - 1000;
    const expectedMax = after - DEFAULT_STATS_SINCE_DAYS * 86_400_000 + 1000;
    const sinceMs = Date.parse(config.statsSince);
    assert.ok(sinceMs >= expectedMin && sinceMs <= expectedMax);
    assert.equal(config.localCollectSince, config.statsSince);
    const saved = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')) as TudConfig;
    assert.equal(saved.statsSince, config.statsSince);
    assert.equal(saved.localCollectSince, config.statsSince);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('touchStatsSince does not overwrite existing statsSince', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-stats-'));
  try {
    const config = baseConfig({
      statsSince: '2026-01-01T00:00:00.000Z',
      dataDir: dir,
    });
    delete config.localCollectSince;
    await touchStatsSince(dir, config);
    assert.equal(config.statsSince, '2026-01-01T00:00:00.000Z');
    assert.equal(config.localCollectSince, '2026-01-01T00:00:00.000Z');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('alignLookbackFloors only moves floors earlier toward 90d', () => {
  const nowMs = Date.parse('2026-08-19T00:00:00.000Z');
  const config = baseConfig({
    statsSince: '2026-08-12T00:00:00.000Z',
    localCollectSince: '2026-08-12T00:00:00.000Z',
  });
  const { changed, collectExpanded } = alignLookbackFloors(config, { nowMs });
  assert.equal(changed, true);
  assert.equal(collectExpanded, true);
  assert.equal(config.statsSince, daysAgoIso(90, nowMs));
  assert.equal(config.localCollectSince, daysAgoIso(90, nowMs));

  const alreadyWide = baseConfig({
    statsSince: '2026-01-01T00:00:00.000Z',
    localCollectSince: '2026-01-01T00:00:00.000Z',
  });
  const again = alignLookbackFloors(alreadyWide, { nowMs });
  assert.equal(again.changed, false);
  assert.equal(alreadyWide.statsSince, '2026-01-01T00:00:00.000Z');
});

test('resolvePricingRefreshConfig prefers env over config', () => {
  const prevUrl = process.env.TUD_PRICING_URL;
  const prevTtl = process.env.TUD_PRICING_TTL_MS;
  process.env.TUD_PRICING_URL = 'https://env.example/p.json';
  process.env.TUD_PRICING_TTL_MS = '120000';
  try {
    const r = resolvePricingRefreshConfig({
      url: 'https://config.example/p.json',
      ttlMs: 999_000,
    });
    assert.equal(r.url, 'https://env.example/p.json');
    assert.equal(r.ttlMs, 120_000);
  } finally {
    if (prevUrl === undefined) delete process.env.TUD_PRICING_URL;
    else process.env.TUD_PRICING_URL = prevUrl;
    if (prevTtl === undefined) delete process.env.TUD_PRICING_TTL_MS;
    else process.env.TUD_PRICING_TTL_MS = prevTtl;
  }
});

test('resolvePricingRefreshConfig falls back to baked when config empty', () => {
  const prevUrl = process.env.TUD_PRICING_URL;
  const prevPricing = process.env.PRICING_URL;
  delete process.env.TUD_PRICING_URL;
  delete process.env.PRICING_URL;
  try {
    const r = resolvePricingRefreshConfig({ url: '', ttlMs: null });
    assert.equal(r.url, null);
    assert.equal(r.ttlMs, BAKED_PRICING_TTL_MS);
  } finally {
    if (prevUrl === undefined) delete process.env.TUD_PRICING_URL;
    else process.env.TUD_PRICING_URL = prevUrl;
    if (prevPricing === undefined) delete process.env.PRICING_URL;
    else process.env.PRICING_URL = prevPricing;
  }
});
