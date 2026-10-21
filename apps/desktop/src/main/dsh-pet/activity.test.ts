import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
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
  const todo = parseActivityRecord({ type: 'todo/write', time: context.now, data: { todos: [{ status: 'in_progress', content: 'Old' }, { status: 'in_progress', content: 'Current' }] } }, { ...context, source: 'dsh' });
  assert.equal(todo?.taskOnly, true); assert.equal(todo?.task, 'Current');
  assert.equal(parseActivityRecord({ type: 'turn/start', time: context.now }, { ...context, source: 'dsh' })?.task, null);
});

test('does not reopen unchanged files, including an incomplete trailing record', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-unchanged-'));
  const file = path.join(root, 'rollout.jsonl');
  const now = Date.now();
  const events: ActivityEvent[] = [];
  const line = JSON.stringify({ type: 'event_msg', timestamp: new Date(now).toISOString(), payload: { type: 'task_started' } });
  await writeFile(file, JSON.stringify({ type: 'session_meta', payload: { id: 'unchanged-session' } }) + '\n');
  const opened = t.mock.method(fsPromises, 'open');
  syncBuiltinESMExports();
  const monitor = new DshPetActivityMonitor({ roots: [{ source: 'codex', path: file }], now: () => now, onEvent: event => events.push(event), intervalMs: 60_000 });
  try {
    await monitor.start();
    assert.equal(opened.mock.callCount(), 1);
    await monitor.poll(); await monitor.poll();
    assert.equal(opened.mock.callCount(), 1, 'unchanged files must not be opened again');
    await appendFile(file, line.slice(0, 20)); await monitor.poll();
    assert.equal(opened.mock.callCount(), 2);
    assert.equal(events.length, 0);
    await monitor.poll();
    assert.equal(opened.mock.callCount(), 2, 'an unchanged partial line must remain buffered without opening the file');
    await appendFile(file, line.slice(20) + '\n'); await monitor.poll();
    assert.equal(opened.mock.callCount(), 3);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.sessionId, 'unchanged-session');
    await monitor.poll();
    assert.equal(opened.mock.callCount(), 3);
    assert.equal(events.length, 1);
  } finally { monitor.dispose(); opened.mock.restore(); syncBuiltinESMExports(); await rm(root, { recursive: true, force: true }); }
});

test('rebaselines truncated files without replaying history and observes subsequent appends', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-truncated-'));
  const file = path.join(root, 'rollout.jsonl');
  const now = Date.now();
  const record = { type: 'event_msg', timestamp: new Date(now).toISOString(), payload: { type: 'task_started' } };
  const header = (id: string) => JSON.stringify({ type: 'session_meta', payload: { id } }) + '\n';
  const events: ActivityEvent[] = [];
  await writeFile(file, header('old-session') + JSON.stringify(record) + '\n');
  const monitor = new DshPetActivityMonitor({ roots: [{ source: 'codex', path: file }], now: () => now, onEvent: event => events.push(event), intervalMs: 60_000 });
  try {
    await monitor.start();
    await writeFile(file, header('new-session')); await monitor.poll(); await monitor.poll();
    assert.equal(events.length, 0);
    await appendFile(file, JSON.stringify(record) + '\n'); await monitor.poll();
    assert.equal(events.length, 1);
    assert.equal(events[0]!.sessionId, 'new-session');
  } finally { monitor.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('rebaselines a same-size replacement when its creation time changes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-replaced-'));
  const file = path.join(root, 'rollout.jsonl');
  const now = Date.now();
  const header = (id: string) => JSON.stringify({ type: 'session_meta', payload: { id } }) + '\n';
  await writeFile(file, header('session-a'));
  const initial = await fsPromises.stat(file);
  const originalStat = fsPromises.stat;
  let replaced = false;
  // Model a replacement's creation time deterministically; filesystem timestamp precision varies by platform.
  const inspected = t.mock.method(fsPromises, 'stat', async (...args: Parameters<typeof fsPromises.stat>) => {
    const info = await originalStat(...args);
    if (args[0] === file && replaced) Object.assign(info, { birthtimeMs: initial.birthtimeMs + 1000 });
    return info;
  });
  syncBuiltinESMExports();
  const events: ActivityEvent[] = [];
  const monitor = new DshPetActivityMonitor({ roots: [{ source: 'codex', path: file }], now: () => now, onEvent: event => events.push(event), intervalMs: 60_000 });
  try {
    await monitor.start();
    await writeFile(file, header('session-b')); replaced = true;
    assert.equal((await fsPromises.stat(file)).size, initial.size);
    await monitor.poll(); await monitor.poll();
    assert.equal(events.length, 0);
    await appendFile(file, JSON.stringify({ type: 'event_msg', timestamp: new Date(now).toISOString(), payload: { type: 'task_started' } }) + '\n');
    await monitor.poll();
    assert.equal(events.length, 1);
    assert.equal(events[0]!.sessionId, 'session-b');
  } finally { monitor.dispose(); inspected.mock.restore(); syncBuiltinESMExports(); await rm(root, { recursive: true, force: true }); }
});
