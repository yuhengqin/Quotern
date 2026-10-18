import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSessionObservation, aggregateSessionActivity } from '../src/session-observation.js';
import * as timing from '../src/task-timing.js';
import type { SessionTimingEvent } from '../src/task-timing.js';

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
