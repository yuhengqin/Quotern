import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DshPetActivityMonitor, parseActivityRecord } from './activity.js';
import type { ActivityEvent } from '../../shared/dsh-pet.js';

test('only observes new complete records, preserves real session IDs and stops on disposal', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-activity-'));
  const file = path.join(root, 'rollout.jsonl');
  const now = Date.parse('2026-10-19T10:00:00Z');
  const header = { type: 'session_meta', payload: { id: 'real-session' } };
  const record = { type: 'event_msg', timestamp: new Date(now).toISOString(), payload: { type: 'task_started', turn_id: 'turn' } };
  await writeFile(file, `${JSON.stringify(header)}\n${JSON.stringify(record)}\n`);
  const events: ActivityEvent[] = [];
  const monitor = new DshPetActivityMonitor({ roots: [{ source: 'codex', path: file }], now: () => now, onEvent: event => events.push(event), intervalMs: 60_000 });
  try {
    await monitor.start(); assert.equal(events.length, 0);
    const line = JSON.stringify(record);
    await appendFile(file, line.slice(0, 20)); await monitor.poll(); assert.equal(events.length, 0);
    await appendFile(file, line.slice(20) + '\n'); await monitor.poll();
    assert.equal(events.length, 1); assert.equal(events[0]!.sessionId, 'real-session'); assert.equal(events[0]!.state, 'working');
    await appendFile(file, line + '\n'); await monitor.poll(); assert.equal(events.length, 1);
    monitor.dispose(); await appendFile(file, JSON.stringify({ ...record, payload: { type: 'turn_aborted', turn_id: 'turn' } }) + '\n'); await monitor.poll(); assert.equal(events.length, 1);
  } finally { monitor.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('does not interpret generic task completion, tool output or silence as verified success', () => {
  const context = { source: 'codex', sessionId: 's', now: Date.now() };
  const at = new Date(context.now).toISOString();
  assert.equal(parseActivityRecord({ type: 'event_msg', timestamp: at, payload: { type: 'task_complete', turn_id: 't' } }, context)?.state, 'result');
  assert.equal(parseActivityRecord({ type: 'event_msg', timestamp: at, payload: { type: 'turn_aborted', turn_id: 't' } }, context)?.state, null);
  assert.equal(parseActivityRecord({ type: 'Stop', timestamp: at }, context), null);
  assert.equal(parseActivityRecord({ type: 'event_msg', timestamp: '2020-01-01T00:00:00Z', payload: { type: 'task_started' } }, context), null);
  assert.equal(parseActivityRecord({ type: 'user', timestamp: at, sessionId: 'c', message: { content: [{ type: 'tool_result' }] } }, { ...context, source: 'claude' })?.state, 'result');
  assert.equal(parseActivityRecord({ type: 'tool/call', time: context.now, data: { name: 'ask_user_question' } }, { ...context, source: 'dsh' })?.state, 'waiting');
  assert.equal(parseActivityRecord({ type: 'turn/end', time: context.now, data: { reason: { kind: 'completed' } } }, { ...context, source: 'dsh' })?.state, 'success');
});
