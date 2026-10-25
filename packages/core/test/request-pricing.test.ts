import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import * as core from '../src/index.js';
import { normalizeClaudeUsage } from '../src/parsers/claude.js';
import { sumTokenTotals, bucketsFromState, accumulateBucket } from '../src/parsers/shared.js';
import type { QueueBucket } from '../src/types.js';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseClaudeIncremental } from '../src/parsers/claude.js';
import { pinHomeEnv } from './platform-fixtures.js';

const row = (patch: Partial<QueueBucket> = {}): QueueBucket => ({ source: 'claude', model: 'price-fixture', project: 'P', hour_start: '2026-10-18T00:00:00Z', input_tokens: 200, output_tokens: 20, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 220, conversation_count: 2, ...patch });
const fact = (id: string, input = 100, extra: object = {}) => ({ id, timestamp: '2026-10-18T00:00:00Z', input_tokens: input, output_tokens: 10, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, requestInputTokens: input, ...extra });
afterEach(() => core.resetPricingRuntime());
function overlay() {
  core.applyRemotePricingOverlay({ exact: { 'price-fixture': { input: 1, output: 2, cache_read: 0.1, cache_write: 1.25 } }, request_rules: [
    { model: 'price-fixture', source: 'claude', minInputTokens: 150, rates: { input: 3, output: 4 }, reference: 'https://example.test/prices' },
    { model: 'price-fixture', source: 'claude', serviceTier: 'fast', rates: { input: 5, output: 10 }, reference: 'https://example.test/fast' },
    { model: 'price-fixture', source: 'claude', rates: { cache_write_1h: 2 }, reference: 'https://example.test/cache' },
  ] } as any);
}
test('per-request thresholds do not price a bucket of small requests as one large request', () => {
  overlay();
  const bucket = row({ pricing_requests: [fact('a'), fact('b')] } as any);
  assert.equal(core.computeRowCost(bucket), 0.00024);
  assert.equal(core.computeRowCost(row({ pricing_requests: [fact('a', 200, { output_tokens: 20 })] } as any)), 0.00068);
});
test('TTL, tier, and effective-dated rules apply only to recorded request facts', () => {
  overlay();
  const bucket = row({ input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 100, pricing_requests: [fact('a', 100, { requestInputTokens: 200, serviceTier: 'fast', cache_creation_input_tokens: 100, cacheWrite1hTokens: 100 })] } as any);
  assert.equal(core.computeRowCost(bucket), 0.0008);
  assert.equal(core.explainRowCost(bucket).costUsd, core.computeRowCost(bucket));
  core.applyRemotePricingOverlay({ exact: { 'price-fixture': { input: 1, output: 2 } }, request_rules: [{ model: 'price-fixture', source: 'claude', effectiveFrom: '2026-10-19T00:00:00Z', rates: { input: 100 }, reference: 'https://example.test/future' }] } as any);
  assert.equal(core.computeRowCost(row({ pricing_requests: [fact('a'), fact('b')] } as any)), 0.00024);
});
test('request metadata survives bucket projection and replaces streamed snapshots by id', () => {
  const a = { ...normalizeClaudeUsage({ input_tokens: 10 }), pricing_requests: [fact('same', 10)] };
  const b = { ...normalizeClaudeUsage({ output_tokens: 10 }), pricing_requests: [fact('same', 10, { output_tokens: 20 })] };
  const merged = sumTokenTotals(a, b) as any;
  assert.equal(merged.pricing_requests.length, 1);
  assert.equal(merged.pricing_requests[0].output_tokens, 20);
  const state = new Map(); accumulateBucket(state, 'claude', 'price-fixture', 'P', '2026-10-18T00:00:00Z', merged);
  assert.equal((bucketsFromState(state, 'claude')[0] as any).pricing_requests.length, 1);
});

test('late TTL evidence emits a zero-token pricing update and preserves first request bucket across scans', async () => {
  const home = await mkdtemp(join(tmpdir(), 'quotern-request-'));
  const folder = join(home, '.claude', 'projects', 'fixture');
  await mkdir(folder, { recursive: true });
  const path = join(folder, 'stream.jsonl');
  const event = (stamp: string, output: number, ttl = false) => JSON.stringify({ type: 'assistant', timestamp: stamp, message: { id: 'stream', model: 'price-fixture', usage: { input_tokens: 100, output_tokens: output, cache_creation_input_tokens: 100, ...(ttl ? { cache_creation: { ephemeral_1h_input_tokens: 100 } } : {}) } } });
  await writeFile(path, `${event('2026-10-18T00:29:00Z', 10)}\n${event('2026-10-18T00:31:00Z', 20)}\n`);
  const restore = pinHomeEnv(home);
  try {
    const first = await parseClaudeIncremental({}, '2026-10-01');
    assert.equal(first.result.buckets[0]?.hour_start, '2026-10-18T00:00:00.000Z');
    await appendFile(path, `${event('2026-10-18T00:32:00Z', 20, true)}\n`);
    const second = await parseClaudeIncremental(first.cursors, '2026-10-01');
    assert.equal(second.result.buckets.length, 1);
    assert.equal(second.result.buckets[0]?.total_tokens, 0);
    assert.equal(second.result.buckets[0]?.pricing_requests?.[0]?.cacheWrite1hTokens, 100);
    await appendFile(path, `${event('2026-10-18T00:33:00Z', 30, true)}\n`);
    const third = await parseClaudeIncremental(second.cursors, '2026-10-01');
    assert.equal(third.result.buckets[0]?.hour_start, '2026-10-18T00:00:00.000Z');
  } finally { restore(); await rm(home, { recursive: true, force: true }); }
});

test('long-context modifiers preserve missing rates and permit explicit zero rates', () => {
  core.applyRemotePricingOverlay({ exact: { 'anthropic/claude-haiku-5-5': { input: 1 } } });
  const bucket = row({ model: 'anthropic/claude-haiku-5-5', input_tokens: 150000, output_tokens: 10, pricing_requests: [fact('a', 150000)] });
  assert.equal(core.explainRowCost(bucket).unpricedTokens, 10);
  core.applyRemotePricingOverlay({ exact: { 'anthropic/claude-haiku-5-5': { input: 1, output: 0 } } });
  assert.equal(core.explainRowCost(bucket).unpricedTokens, 0);
});

test('cost items retain each applicable request rate and cache lifetime without double counting', () => {
  overlay();
  const bucket = row({ input_tokens: 200, output_tokens: 20, cache_creation_input_tokens: 100,
    pricing_requests: [fact('standard', 100, { cache_creation_input_tokens: 100, cacheWrite1hTokens: 60, cacheWrite5mTokens: 40 }), fact('fast', 100, { serviceTier: 'fast' })] });
  const explanation = core.explainRowCost(bucket) as any;
  assert.ok(Array.isArray(explanation.items), 'the calculation exposes its category quantities and effective rates');
  const used = explanation.items.filter((item: any) => item.tokens > 0);
  assert.deepEqual(used.filter((item: any) => item.category === 'input').map((item: any) => [item.tokens, item.rateUsdPerMillion]), [[100, 1], [100, 5]]);
  assert.deepEqual(used.filter((item: any) => item.category.startsWith('cache_write')).map((item: any) => [item.category, item.tokens, item.rateUsdPerMillion]), [['cache_write_1h', 60, 2], ['cache_write_5m', 40, 1.25]]);
  assert.equal(used.reduce((total: number, item: any) => total + item.tokens, 0), 320);
  assert.ok(Math.abs(used.reduce((total: number, item: any) => total + item.costUsd, 0) - core.computeRowCost(bucket)) < 1e-8);
});

test('cost item prices distinguish missing rates from explicit free output', () => {
  const bucket = row({ input_tokens: 100, output_tokens: 10, pricing_requests: [fact('one')] });
  core.applyRemotePricingOverlay({ exact: { 'price-fixture': { input: 1 } } });
  let output = (core.explainRowCost(bucket) as any).items?.find((item: any) => item.category === 'output');
  assert.ok(output, 'output remains an explicit cost item');
  assert.equal(output.rateUsdPerMillion, null); assert.equal(output.costUsd, null);
  core.applyRemotePricingOverlay({ exact: { 'price-fixture': { input: 1, output: 0 } } });
  output = (core.explainRowCost(bucket) as any).items.find((item: any) => item.category === 'output');
  assert.equal(output.rateUsdPerMillion, 0); assert.equal(output.costUsd, 0);
});

test('cost items include a legacy remainder once without applying request modifiers to it', () => {
  overlay();
  const bucket = row({ input_tokens: 200, output_tokens: 20, pricing_requests: [fact('fast', 100, { serviceTier: 'fast' })] });
  const explanation = core.explainRowCost(bucket);
  assert.equal(explanation.items!.reduce((sum, item) => sum + item.tokens, 0), 220);
  assert.deepEqual(explanation.items!.filter(item => item.category === 'input').map(item => [item.tokens, item.rateUsdPerMillion]), [[100, 5], [100, 1]]);
  assert.ok(Math.abs(explanation.items!.reduce((sum, item) => sum + (item.costUsd ?? 0), 0) - core.computeRowCost(bucket)) < 1e-8);
});
