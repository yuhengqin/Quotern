import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSessionObservation, aggregateSessionActivity } from '../src/session-observation.js';
import * as timing from '../src/task-timing.js';
import type { SessionTimingEvent } from '../src/task-timing.js';
import { applyRemotePricingOverlay, resetPricingRuntime } from '../src/pricing/index.js';

test('Claude session details share TTL fallback normalization and group each model in the selected period', () => {
  const context = { sessionId: 'same' };
  const event = (model: string, timestamp: string) => extractSessionObservation('claude', { type: 'assistant', timestamp, requestId: timestamp, message: { id: timestamp, model, usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5, cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: 4 } } } }, context)!;
  const observations = [event('claude-sonnet-4-5', '2026-10-17T15:59:00Z'), event('claude-sonnet-4-5', '2026-10-17T16:00:00Z'), event('claude-opus-4-6', '2026-10-18T00:00:00Z')];
  const snapshot = aggregateSessionActivity(observations, [], { fromDate: '2026-10-18', toDate: '2026-10-18', totalTokens: 48 });
  const row = snapshot.sessions[0] as any;
  assert.equal(row.tokens, 48);
  assert.equal(row.detailsComplete, true);
  assert.equal(row.models.length, 2);
  assert.equal(row.models.reduce((sum: number, m: any) => sum + m.cache_creation_input_tokens, 0), 14);
  assert.equal(row.models.reduce((sum: number, m: any) => sum + m.requests, 0), 2);
});

test('legacy totals remain readable without inventing model token splits', () => {
  const event = extractSessionObservation('claude', { type: 'assistant', timestamp: '2026-10-18T00:00:00Z', message: { id: 'a', model: 'claude-sonnet-4-5', usage: { input_tokens: 50, output_tokens: 2 } } }, { sessionId: 'a' })!;
  delete (event as any).tokenParts; delete (event as any).pricingFact;
  const row = aggregateSessionActivity([event], [], { totalTokens: 52 }).sessions[0] as any;
  assert.equal(row.tokens, 52);
  assert.equal(row.detailsComplete, false);
  assert.equal(row.models[0].input_tokens, null);
});

test('repeated Codex snapshots keep a known request count', () => {
  const context = { sessionId: 'a' };
  const event = (timestamp: string) => extractSessionObservation('codex', { type: 'event_msg', timestamp, payload: { type: 'token_count', info: { model: 'gpt-6.1-sol', total_token_usage: { input_tokens: 10, output_tokens: 2 }, last_token_usage: { input_tokens: 10, output_tokens: 2 } } } }, context)!;
  const row = aggregateSessionActivity([event('2026-10-18T00:00:00Z'), event('2026-10-18T00:01:00Z')], [], { totalTokens: 12 }).sessions[0]!;
  assert.equal(row.models?.[0]?.requests, 1);
});

test('model cost details keep effective rates apart and never allocate a source-reported total', () => {
  applyRemotePricingOverlay({ exact: { 'openai/gpt-6.1-sol': { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 } } });
  try {
    const event = (id: string, tier: string) => extractSessionObservation('codex', { type: 'event_msg', timestamp: '2026-10-19T00:00:00Z', payload: { type: 'token_count', service_tier: tier, info: { model: 'gpt-6.1-sol', total_token_usage: { input_tokens: 100, output_tokens: 20, reasoning_output_tokens: 5 }, last_token_usage: { input_tokens: 100, output_tokens: 20, reasoning_output_tokens: 5 } } } }, { sessionId: id })!;
    const standard = event('standard', 'default'), fast = event('fast', 'fast');
    fast.sessionId = standard.sessionId; fast.id += '-fast';
    const model = aggregateSessionActivity([standard, fast], [], { totalTokens: 240 }).sessions[0]!.models![0] as any;
    assert.ok(Array.isArray(model.costBreakdown), 'model details include grouped cost items');
    assert.deepEqual(model.costBreakdown.filter((item: any) => item.category === 'input' && item.tokens > 0).map((item: any) => item.rateUsdPerMillion).sort(), [2, 4]);
    assert.ok(Math.abs(model.costBreakdown.reduce((total: number, item: any) => total + (item.costUsd ?? 0), 0) - model.costUsd) < 1e-8);
    const recorded = { ...standard, costKind: 'recorded' as const, costUsd: 7 };
    const sourceModel = aggregateSessionActivity([recorded], [], { totalTokens: recorded.tokens }).sessions[0]!.models![0] as any;
    assert.equal(sourceModel.costUsd, 7);
    assert.ok(sourceModel.costBreakdown.every((item: any) => item.costUsd === null && item.knownCostUsd === 0), 'reference rates cannot invent recorded category charges');
    const legacy = { ...standard, tokenParts: undefined, pricingFact: undefined };
    const legacyModel = aggregateSessionActivity([legacy], [], { totalTokens: legacy.tokens }).sessions[0]!.models![0] as any;
    assert.ok(legacyModel.costBreakdown.every((item: any) => item.tokens === null && item.costUsd === null), 'missing token categories remain unknown');
  } finally { resetPricingRuntime(); }
});

test('fork task copies are attributed before calculating each session duration', () => {
  const inheritedTurn = '00000000-0000-0000-0000-000000000001', ownTurn = '00000000-0000-0000-0000-000000000002';
  const events: SessionTimingEvent[] = [
    { source: 'codex', sessionId: 'parent', id: 'p', kind: 'task-end', timestamp: '2026-10-18T00:01:00Z', turnId: inheritedTurn, durationMs: 60000 },
    { source: 'codex', sessionId: 'child', id: 'c', kind: 'task-end', timestamp: '2026-10-18T00:01:00Z', turnId: inheritedTurn, durationMs: 60000 },
    { source: 'codex', sessionId: 'child', id: 'n', kind: 'task-end', timestamp: '2026-10-18T00:02:00Z', turnId: ownTurn, durationMs: 10000 },
  ];
  const attribute = (timing as any).attributeTaskTimingEvents;
  assert.equal(typeof attribute, 'function');
  const attributed: SessionTimingEvent[] = attribute(events, new Map([['child', 'parent']]));
  const parent = timing.aggregateTaskTiming([], attributed.filter(e => e.sessionId === 'parent'), {});
  const child = timing.aggregateTaskTiming([], attributed.filter(e => e.sessionId === 'child'), {});
  assert.equal(parent.taskSeconds, 60); assert.equal(child.taskSeconds, 10);
  assert.equal(parent.taskSeconds! + child.taskSeconds!, timing.aggregateTaskTiming([], events, {}).taskSeconds);
});
