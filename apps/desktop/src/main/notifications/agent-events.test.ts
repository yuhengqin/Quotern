import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentNotificationEvents } from './agent-events.js';
import type { ActivityEvent } from '../../shared/agent-activity.js';
import type { DesktopNotice } from '../../shared/notifications.js';

test('log and hook completions coalesce while separate turns and sessions remain independent', () => {
  let now = 1_000_000; const sent: DesktopNotice[] = [];
  const events = new AgentNotificationEvents({ now: () => now, send: async value => { sent.push(value); }, dismiss: () => {}, text: () => ({ title: 'Agent', body: 'Response ended' }) });
  const event: ActivityEvent = { id: 'log', source: 'codex', sessionId: 's', timestamp: new Date(now).toISOString(), state: 'result', evidence: 'task_complete', notice: 'complete', terminal: true, turnId: 'turn' };
  events.accept(event); events.accept({ ...event, id: 'hook', turnId: undefined }); assert.equal(sent.length, 1);
  events.accept({ ...event, id: 'other', sessionId: 'other' }); assert.equal(sent.length, 2);
  now += 1000; events.accept({ ...event, id: 'start', timestamp: new Date(now).toISOString(), notice: undefined, terminal: false, newTurn: true });
  events.accept({ ...event, id: 'next', timestamp: new Date(now + 1).toISOString(), turnId: 'next' }); assert.equal(sent.length, 3);
});
test('request resolution matches its identity; stale confirmations never resurrect a finished turn', () => {
  const now = 1_000_000, active: DesktopNotice[] = [];
  const events = new AgentNotificationEvents({ now: () => now, send: async value => { active.push(value); }, dismiss: predicate => { for (let i = active.length - 1; i >= 0; i--) if (predicate(active[i]!)) active.splice(i, 1); }, text: () => ({ title: 'Agent', body: 'Check' }) });
  const event: ActivityEvent = { id: 'ask', source: 'claude', sessionId: 's', timestamp: new Date(now).toISOString(), state: 'waiting', evidence: 'question', notice: 'confirmation', requestId: 'one' };
  events.accept(event); events.accept({ ...event, id: 'other-ask', requestId: 'two' }); assert.equal(active.length, 2);
  events.accept({ ...event, id: 'resolved', notice: undefined, state: 'result', resolvedRequestId: 'one' }); assert.equal(active.length, 1); assert.equal(active[0]!.requestId, 'two');
  events.accept({ ...event, id: 'done', timestamp: new Date(now + 2).toISOString(), notice: 'complete', state: 'result', terminal: true });
  events.accept({ ...event, id: 'late', timestamp: new Date(now + 1).toISOString() });
  assert.equal(active.filter(value => value.category === 'agentConfirmation').length, 0);
  events.accept({ ...event, id: 'old', timestamp: new Date(now - 121_000).toISOString() }); assert.equal(active.length, 1);
});
test('a tool result resolves an approval lacking a call id without dismissing a different tool', () => {
  const now = Date.now(), active: DesktopNotice[] = [];
  const events = new AgentNotificationEvents({ now: () => now, send: async value => { active.push(value); }, dismiss: predicate => { for (let i = active.length - 1; i >= 0; i--) if (predicate(active[i]!)) active.splice(i, 1); }, text: () => ({ title: 'Input', body: 'Check' }) });
  const base: ActivityEvent = { id: 'one', source: 'codex', sessionId: 's', turnId: 'turn', timestamp: new Date(now).toISOString(), state: 'waiting', evidence: 'hook:PermissionRequest', notice: 'confirmation', requestId: 'Bash:turn' };
  events.accept(base); events.accept({ ...base, id: 'two', requestId: 'apply_patch:turn' });
  events.accept({ ...base, id: 'resolved', notice: undefined, resolvedRequestId: 'actual-call', resolvedRequestKey: 'Bash:turn' } as ActivityEvent);
  assert.equal(active.length, 1); assert.equal(active[0]!.requestId, 'apply_patch:turn');
});
test('an unrelated tool result cannot dismiss a question with no correlation id', () => {
  const now = Date.now(), active: DesktopNotice[] = [];
  const events = new AgentNotificationEvents({ now: () => now, send: async value => { active.push(value); }, dismiss: predicate => { for (let i = active.length - 1; i >= 0; i--) if (predicate(active[i]!)) active.splice(i, 1); }, text: () => ({ title: 'Question', body: 'Check' }) });
  const event: ActivityEvent = { id: 'question', source: 'codex', sessionId: 's', timestamp: new Date(now).toISOString(), state: 'waiting', evidence: 'question', notice: 'confirmation' };
  events.accept(event); events.accept({ ...event, id: 'output', state: 'result', notice: undefined, resolvedRequestId: 'unrelated' });
  assert.equal(active.length, 1);
});

test('a delayed previous-turn completion cannot notify after the next turn has started', () => {
  const now = Date.now(), sent: DesktopNotice[] = [];
  const events = new AgentNotificationEvents({ now: () => now, send: async value => { sent.push(value); }, dismiss: () => {}, text: () => ({ title: 'Agent', body: 'Response ended' }) });
  const base: ActivityEvent = { id: 'next-start', source: 'codex', sessionId: 's', turnId: 'next', timestamp: new Date(now).toISOString(), state: 'working', evidence: 'task_started', newTurn: true };
  events.accept(base);
  events.accept({ ...base, id: 'late-stop-hook', turnId: 'previous', timestamp: new Date(now - 500).toISOString(), state: 'result', newTurn: false, notice: 'complete', terminal: true });
  assert.equal(sent.length, 0);
});

test('a delayed start or terminal from another stream preserves a newer pending question', () => {
  const now = Date.now(), active: DesktopNotice[] = [];
  const events = new AgentNotificationEvents({ now: () => now, send: async value => { active.push(value); }, dismiss: predicate => { for (let i = active.length - 1; i >= 0; i--) if (predicate(active[i]!)) active.splice(i, 1); }, text: () => ({ title: 'Agent', body: 'Check' }) });
  const base: ActivityEvent = { id: 'ask', source: 'claude', sessionId: 's', timestamp: new Date(now).toISOString(), state: 'waiting', evidence: 'question', notice: 'confirmation', requestId: 'request' };
  events.accept(base);
  events.accept({ ...base, id: 'delayed-start', timestamp: new Date(now - 500).toISOString(), state: 'working', newTurn: true, notice: undefined });
  assert.equal(active.length, 1);
  events.accept({ ...base, id: 'delayed-terminal', timestamp: new Date(now - 250).toISOString(), state: 'result', terminal: true, notice: undefined });
  assert.equal(active.length, 1);
});
