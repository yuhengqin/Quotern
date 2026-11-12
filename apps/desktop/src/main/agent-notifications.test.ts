import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseActivityRecord } from './dsh-pet/activity.js';

const now = Date.now(), timestamp = new Date(now).toISOString();
const context = (source: string) => ({ source, sessionId: 'session', now });
const parse = (source: string, record: Record<string, unknown>) => parseActivityRecord({ timestamp, ...record }, context(source)) as ReturnType<typeof parseActivityRecord> & { notice?: string; requestId?: string; resolvedRequestId?: string };

test('Codex turn completion is a notification without claiming goal success', () => {
  const event = parse('codex', { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn' } });
  assert.equal(event?.state, 'result');
  assert.equal(event?.notice, 'complete');
  assert.equal(event?.turnId, 'turn');
  assert.equal(parse('codex', { type: 'event_msg', payload: { type: 'turn_aborted' } })?.notice, undefined);
});

test('Codex explicit questions carry call identity and matching outputs resolve them', () => {
  const event = parse('codex', { type: 'response_item', payload: { type: 'function_call', name: 'functions.request_user_input', call_id: 'call' } });
  assert.equal(event?.notice, 'confirmation'); assert.equal(event?.requestId, 'call');
  assert.equal(parse('codex', { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'other' } })?.notice, undefined);
  assert.equal(parse('codex', { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call', output: 'anything' } })?.resolvedRequestId, 'call');
});

test('explicit Codex errors notify; ordinary tool output and interruptions do not', () => {
  assert.equal(parse('codex', { type: 'event_msg', payload: { type: 'error', message: 'API failed' } })?.notice, 'error');
  assert.equal(parse('codex', { type: 'response_item', payload: { type: 'function_call_output', output: 'Error: expected fixture' } })?.notice, undefined);
});

test('durable Codex terminal errors never become completion notices, including v2 aliases', () => {
  for (const type of ['task_complete', 'turn_complete']) {
    const failed = parse('codex', { type: 'event_msg', payload: { type, turn_id: 'failed-turn', error: { message: 'rate limited', codex_error_info: 'usage_limit_exceeded' } } });
    assert.equal(failed?.notice, 'error');
    assert.equal(failed?.state, 'error');
    assert.equal(failed?.terminal, true);
    assert.equal(parse('codex', { type: 'event_msg', payload: { type, error: null } })?.notice, 'complete');
  }
  assert.equal(parse('codex', { type: 'event_msg', payload: { type: 'turn_started' } })?.newTurn, true);
});

test('Claude final responses, questions and explicit API errors are separate signals', () => {
  assert.equal(parse('claude', { type: 'assistant', sessionId: 'claude-session', message: { stop_reason: 'end_turn', content: [] } })?.notice, 'complete');
  const question = parse('claude', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'ask', name: 'AskUserQuestion' }] } });
  assert.equal(question?.notice, 'confirmation'); assert.equal(question?.requestId, 'ask');
  assert.equal(parse('claude', { type: 'assistant', isApiErrorMessage: true, message: { content: [] } })?.notice, 'error');
  assert.equal(parse('claude', { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } })?.notice, undefined);
  assert.equal(parse('claude', { type: 'user', message: { content: [{ type: 'tool_result', content: 'Error is just text', tool_use_id: 'ask' }] } })?.resolvedRequestId, 'ask');
});
