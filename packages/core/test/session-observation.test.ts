import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSessionObservation, aggregateSessionActivity, type ObservationContext } from '../src/session-observation.js';

test('Codex preserves recorded call usage, de-duplicates cumulative snapshots and records capacity', () => {
  const context: ObservationContext = { sessionId: 'a' };
  extractSessionObservation('codex', { type: 'session_meta', payload: { id: 'a', model_provider: 'openai', context_window: { window_id: 'uuid' } } }, context);
  const event = (total: number) => ({ timestamp: '2026-10-16T04:00:00Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total, output_tokens: 2, total_tokens: total + 2 }, last_token_usage: { input_tokens: 30, output_tokens: 2 }, model_context_window: 100 } } });
  const first = extractSessionObservation('codex', event(50), context)!;
  const duplicate = extractSessionObservation('codex', event(50), context)!;
  const next = extractSessionObservation('codex', event(60), context)!;
  assert.equal(first.tokens, 32); assert.equal(duplicate.tokens, 0); assert.equal(next.tokens, 32);
  assert.equal(first.context?.usedTokens, 32); assert.equal(first.context?.limitTokens, 100);
  assert.equal(first.billing.mode, 'unknown'); assert.equal(first.billing.service, 'openai');
});

test('billing aggregates each event rather than the last service in a session', () => {
  const context: ObservationContext = { sessionId: 'a' };
  const events = ['', 'anthropic', 'openai'].map((provider, i) => extractSessionObservation('pi', { type: 'message', id: String(i), timestamp: `2026-10-16T04:00:0${i}Z`, message: { role: 'assistant', provider, usage: { input: [100, 20, 30][i] } } }, context)!);
  const snapshot = aggregateSessionActivity(events, [], { totalTokens: 150 });
  assert.deepEqual(Object.fromEntries(snapshot.billing.map(row => [row.service, row.tokens])), { unknown: 100, anthropic: 20, openai: 30 });
  assert.equal(snapshot.sessions[0]?.billing.service, 'mixed');
});

test('recorded call cost and another estimated call cost are combined honestly', () => {
  const context: ObservationContext = { sessionId: 'a' };
  const a = extractSessionObservation('pi', { type: 'message', id: 'a', timestamp: '2026-10-16T04:00:00Z', message: { role: 'assistant', usage: { input: 10, cost: { total: 1 } } } }, context)!;
  const b = { ...a, id: 'b', costUsd: 2, costKind: 'estimated' as const };
  const result = aggregateSessionActivity([a, b], [], { totalTokens: 20 });
  assert.equal(result.sessions[0]?.costUsd, 3); assert.equal(result.sessions[0]?.costKind, 'mixed');
});

test('Codex cache-write aliases are disjoint from gross input', () => {
  for (const mode of ['last_token_usage', 'total_token_usage']) {
    const context: ObservationContext = { sessionId: 'a' };
    const usage = { input_tokens: 50, cache_read_input_tokens: 10, cache_write_input_tokens: 7, output_tokens: 10 };
    if (mode === 'total_token_usage') extractSessionObservation('codex', { type: 'event_msg', timestamp: '2026-10-16T03:00:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 0, output_tokens: 0 } } } }, context);
    const e = extractSessionObservation('codex', { type: 'event_msg', timestamp: '2026-10-16T04:00:00Z', payload: { type: 'token_count', info: { [mode]: usage } } }, context)!;
    assert.equal(e.tokens, 60);
  }
});

test('Codex fork replay ignores changed clocks, preserving later real repeat calls', () => {
  const parent: ObservationContext = { sessionId: 'p' }, child: ObservationContext = { sessionId: 'c', parentId: 'p' };
  const event = (stamp: string, input: number) => ({ type: 'event_msg', timestamp: stamp, payload: { type: 'token_count', info: { last_token_usage: { input_tokens: input, output_tokens: 10 } } } });
  const a = extractSessionObservation('codex', event('2026-10-15T04:00:00Z', 50), parent)!;
  const replayEvent = event('2026-10-16T04:00:00Z', 50);
  const replay = extractSessionObservation('codex', { ...replayEvent, payload: { ...replayEvent.payload, info: { ...replayEvent.payload.info, model_context_window: 200 } } }, child)!;
  const b = extractSessionObservation('codex', event('2026-10-16T04:01:00Z', 20), child)!;
  const repeat = extractSessionObservation('codex', event('2026-10-16T04:02:00Z', 50), child)!;
  const result = aggregateSessionActivity([a, replay, b, repeat], [], { fromDate: '2026-10-16', toDate: '2026-10-16', totalTokens: 90 });
  assert.equal(result.attributedTokens, 90); assert.equal(result.sessions[0]?.tokens, 90);
});

test('partial account metadata does not invent multiple billing services', () => {
  const context: ObservationContext = { sessionId: 'a' };
  extractSessionObservation('codex', { type: 'session_meta', payload: { id: 'a', model_provider: 'openai', creator_account_id: 'fixture-account' } }, context);
  extractSessionObservation('codex', { type: 'session_meta', payload: { id: 'a' } }, context);
  const event = extractSessionObservation('codex', { type: 'event_msg', timestamp: '2026-10-16T04:00:00Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 20 } } } }, context)!;
  assert.equal(event.billing.service, 'openai'); assert.ok(event.billing.accountRef);
  const withoutAccount = { ...event, id: 'b', billing: { ...event.billing, accountRef: null } };
  const result = aggregateSessionActivity([event, withoutAccount], [], { totalTokens: 40 });
  assert.equal(result.sessions[0]?.billing.service, 'openai'); assert.equal(result.sessions[0]?.billing.accountRef, null);
});

test('Claude compaction replaces old context without inventing capacity', () => {
  const context: ObservationContext = { sessionId: 'a' };
  const first = extractSessionObservation('claude', { type: 'assistant', sessionId: 'a', timestamp: '2026-10-16T04:00:00Z', message: { id: 'm', model: 'custom', usage: { input_tokens: 20, cache_read_input_tokens: 50, output_tokens: 5 } } }, context)!;
  const compacted = extractSessionObservation('claude', { type: 'system', subtype: 'compact_boundary', timestamp: '2026-10-16T04:01:00Z', compactMetadata: { postTokens: 12 } }, context)!;
  assert.equal(first.context?.usedTokens, 70); assert.equal(first.context?.limitTokens, null);
  assert.equal(compacted.context?.usedTokens, 12); assert.equal(compacted.context?.kind, 'post-compaction');
  assert.equal(first.billing.service, 'unknown');
});

test('compaction without postTokens clears the previous size instead of retaining it', () => {
  const context: ObservationContext = { sessionId: 'a' };
  const a = extractSessionObservation('claude', { type: 'assistant', timestamp: '2026-10-16T04:00:00Z', message: { id: 'm', usage: { input_tokens: 200 } } }, context)!;
  const b = extractSessionObservation('claude', { type: 'system', subtype: 'compact_boundary', timestamp: '2026-10-16T04:01:00Z', compactMetadata: {} }, context)!;
  assert.ok(b); assert.equal(b.context?.usedTokens, null);
  assert.equal(aggregateSessionActivity([a, b], [], { totalTokens: 200 }).sessions[0]?.context?.kind, 'post-compaction');
});

test('stream snapshots replace one call and unattributed tokens remain visible', () => {
  const context: ObservationContext = { sessionId: 'a' };
  const row = (tokens: number) => extractSessionObservation('pi', { type: 'message', id: 'm', timestamp: '2026-10-16T04:00:00Z', message: { role: 'assistant', model: 'unknown', provider: 'anthropic', usage: { input: tokens, output: 0 } } }, context)!;
  const result = aggregateSessionActivity([row(10), row(20)], [], { fromDate: '2026-10-16', toDate: '2026-10-16', totalTokens: 40 });
  assert.equal(result.sessions[0]?.tokens, 20); assert.equal(result.otherTokens, 20);
  assert.equal(result.sessions[0]?.sharePercent, 50); assert.equal(result.sessions[0]?.billing.mode, 'unknown');
});

test('invalid and future timestamps are excluded; quota share is never claimed', () => {
  const context: ObservationContext = { sessionId: 'a' };
  assert.equal(extractSessionObservation('pi', { type: 'message', message: { role: 'assistant', usage: { input: -1 } } }, context), null);
  const event = extractSessionObservation('pi', { type: 'message', id: 'x', timestamp: '2026-10-17T04:00:00Z', message: { role: 'assistant', usage: { input: 10 } } }, context)!;
  const result = aggregateSessionActivity([event], [], { fromDate: '2026-10-16', toDate: '2026-10-16', totalTokens: 0 });
  assert.equal(result.sessions.length, 0);
});

test('Codex billing uses recorded auth and plan evidence without guessing from missing limits', () => {
  const read = (auth: string, rateLimits?: unknown, provider = 'openai') => {
    const context: ObservationContext = { sessionId: 'billing' };
    extractSessionObservation('codex', { type: 'session_meta', payload: { model_provider: provider } }, context);
    extractSessionObservation('codex', { type: 'turn_context', payload: { auth_mode: auth } }, context);
    return extractSessionObservation('codex', { type: 'event_msg', timestamp: '2026-10-16T04:00:00Z', payload: { type: 'token_count', rate_limits: rateLimits, info: { last_token_usage: { input_tokens: 12 } } } }, context)!.billing.mode;
  };
  assert.equal(read('chatgpt'), 'subscription');
  assert.equal(read('', { plan_type: 'pro' }), 'subscription');
  assert.equal(read('', { plan_type: 'prolite' }), 'subscription');
  assert.equal(read('', { plan_type: 'api_key' }), 'api');
  assert.equal(read('api_key', { plan_type: 'pro' }), 'api');
  assert.equal(read('', { primary: { used_percent: 20 } }), 'unknown');
  assert.equal(read('', { plan_type: 'future-plan' }), 'unknown');
  assert.equal(read('', { plan_type: 'pro' }, 'custom-proxy'), 'unknown');
  assert.equal(read(''), 'unknown');
});
