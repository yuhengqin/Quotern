import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, appendFile, readFile, unlink } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aggregateSessionMetrics, type SessionMessage } from '../src/session-metrics.js';
import { syncSessionSource, readSessionMetrics } from '../src/session-collector.js';

const turn = '01a0c8e9-76f1-7113-a8e2-53e2b7d42fc9';
const message = (id: string, timestamp: string, role: 'user' | 'assistant', source = 'codex'): SessionMessage => ({ source, sessionId: 's', id, role, timestamp });
type TaskFields = { taskSeconds: number | null; taskTimingKind: string; estimatedTaskSources: string[]; missingTaskSources: string[] };

test('Codex task duration keeps TTFT and tool time and deduplicates copied turn ids', () => {
  const rows = [message('u', '2026-10-14T00:00:00Z', 'user'), message('a', '2026-10-14T00:02:02.905Z', 'assistant')];
  const end = { source: 'codex', sessionId: 's', id: `task-end:${turn}`, kind: 'task-end' as const, turnId: turn, timestamp: '2026-10-14T00:02:02.905Z', durationMs: 122905 };
  const options = { fromDate: '2026-10-14', timingEvents: [end, { ...end, sessionId: 'fork' }] };
  const result = aggregateSessionMetrics(rows, options) as ReturnType<typeof aggregateSessionMetrics> & TaskFields;
  assert.equal(result.taskSeconds, 123);
  assert.equal(result.taskTimingKind, 'recorded');
  assert.deepEqual(result.estimatedTaskSources, []);
  assert.equal(result.messageCount, 2);
});

test('native task intervals are clipped at selected local midnight even without a message that day', () => {
  const options = { fromDate: '2026-10-14', toDate: '2026-10-14', timeZone: 'Asia/Shanghai', timingEvents: [
    { source: 'codex', sessionId: 's', id: 'end', kind: 'task-end' as const, turnId: turn, timestamp: '2026-10-13T16:00:30Z', durationMs: 60000 },
  ] };
  const result = aggregateSessionMetrics([], options) as ReturnType<typeof aggregateSessionMetrics> & TaskFields;
  assert.equal(result.taskSeconds, 30);
});

test('task range clipping respects a 23-hour daylight-saving day', () => {
  const options = { fromDate: '2026-03-08', toDate: '2026-03-08', timeZone: 'America/New_York', timingEvents: [
    { source: 'codex', sessionId: 's', id: 'end', kind: 'task-end' as const, turnId: turn, timestamp: '2026-03-09T05:00:00Z', durationMs: 86400000 },
  ] };
  assert.equal((aggregateSessionMetrics([], options) as ReturnType<typeof aggregateSessionMetrics> & TaskFields).taskSeconds, 82800);
});

test('paired millisecond task events take precedence over coarse started_at seconds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-task-precision-'));
  const file = join(dir, 's.jsonl');
  await writeFile(file, [
    { timestamp: '2026-10-14T00:00:00.800Z', type: 'session_meta', payload: { id: 's' } },
    { timestamp: '2026-10-14T00:00:00.800Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turn, started_at: Date.parse('2026-10-14T00:00:00Z') / 1000 } },
    { timestamp: '2026-10-14T00:02:01.200Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: turn, started_at: Date.parse('2026-10-14T00:00:00Z') / 1000 } },
  ].map(r => JSON.stringify(r)).join('\n') + '\n');
  await syncSessionSource(dir, 'codex', { inputs: [{ path: file, sessionId: 's', kind: 'jsonl' }], complete: true });
  assert.equal(((await readSessionMetrics(dir, [])) as Awaited<ReturnType<typeof readSessionMetrics>> & TaskFields).taskSeconds, 120);
});

test('other agents estimate user-to-last-work-event spans without prompt idle gaps', () => {
  const rows = [message('u1', '2026-10-14T00:00:00Z', 'user', 'kimi'), message('a1', '2026-10-14T00:00:10Z', 'assistant', 'kimi')];
  const options = { fromDate: '2026-10-14', timingEvents: [
    { source: 'kimi', sessionId: 's', id: 'u1', kind: 'user' as const, timestamp: '2026-10-14T00:00:00Z' },
    { source: 'kimi', sessionId: 's', id: 'tool', kind: 'activity' as const, timestamp: '2026-10-14T00:00:20Z' },
    { source: 'kimi', sessionId: 's', id: 'u2', kind: 'user' as const, timestamp: '2026-10-14T01:00:00Z' },
    { source: 'kimi', sessionId: 's', id: 'done', kind: 'activity' as const, timestamp: '2026-10-14T01:00:30Z' },
  ] };
  const result = aggregateSessionMetrics(rows, options) as ReturnType<typeof aggregateSessionMetrics> & TaskFields;
  assert.equal(result.taskSeconds, 50);
  assert.equal(result.taskTimingKind, 'estimated');
  assert.deepEqual(result.estimatedTaskSources, ['kimi']);
  assert.equal(result.messageCount, 2);
});

test('source selection excludes task timing and distinguishes missing Codex evidence from known empty data', () => {
  const rows = [message('u', '2026-10-14T00:00:00Z', 'user'), message('a', '2026-10-14T00:01:00Z', 'assistant', 'claude')];
  const options = { sources: ['claude'], timingEvents: [
    { source: 'codex', sessionId: 's', id: 'end', kind: 'task-end' as const, turnId: turn, timestamp: '2026-10-14T00:01:00Z', durationMs: 60000 },
  ] };
  assert.equal((aggregateSessionMetrics(rows, options) as ReturnType<typeof aggregateSessionMetrics> & TaskFields).taskSeconds, 0);
  const unknown = aggregateSessionMetrics([rows[0]!]) as ReturnType<typeof aggregateSessionMetrics> & TaskFields;
  assert.equal(unknown.taskSeconds, null);
  assert.deepEqual(unknown.missingTaskSources, ['codex']);
  assert.equal((aggregateSessionMetrics([]) as ReturnType<typeof aggregateSessionMetrics> & TaskFields).taskSeconds, 0);
});

test('a later day task does not turn unknown historical Codex timing into zero', () => {
  const rows = [message('u', '2026-10-13T00:00:00Z', 'user'), message('a', '2026-10-13T00:01:00Z', 'assistant')];
  const options = { fromDate: '2026-10-13', toDate: '2026-10-13', timingEvents: [
    { source: 'codex', sessionId: 's', id: 'start', kind: 'task-start' as const, turnId: turn, timestamp: '2026-10-14T00:00:00Z' },
  ] };
  const result = aggregateSessionMetrics(rows, options) as ReturnType<typeof aggregateSessionMetrics> & TaskFields;
  assert.equal(result.taskSeconds, null);
  assert.deepEqual(result.missingTaskSources, ['codex']);
  const pendingOptions = { ...options, timingEvents: [{ ...options.timingEvents[0]!, timestamp: '2026-10-13T00:00:00Z' }] };
  const pending = aggregateSessionMetrics(rows, pendingOptions) as ReturnType<typeof aggregateSessionMetrics> & TaskFields;
  assert.equal(pending.taskSeconds, 0);
  assert.deepEqual(pending.missingTaskSources, []);
});

test('Codex incremental completion changes task metrics without increasing logical message counts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-task-timing-'));
  const file = join(dir, 's.jsonl');
  const start = Date.parse('2026-10-14T00:00:00Z');
  const record = (timestamp: number, type: string, payload: object) => JSON.stringify({ timestamp: new Date(timestamp).toISOString(), type, payload });
  await writeFile(file, [record(start, 'session_meta', { id: 's' }), record(start, 'event_msg', { type: 'task_started', turn_id: turn, started_at: start / 1000 }), record(start, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'private prompt' }] })].join('\n') + '\n');
  const discovery = { inputs: [{ path: file, sessionId: 's', kind: 'jsonl' as const }], complete: true };
  await syncSessionSource(dir, 'codex', discovery);
  await appendFile(file, record(start + 30000, 'event_msg', { type: 'task_complete', turn_id: turn, started_at: start / 1000, completed_at: (start + 30000) / 1000, duration_ms: 30000, time_to_first_token_ms: 5000, last_agent_message: 'private result' }) + '\n');
  assert.equal(await syncSessionSource(dir, 'codex', discovery), true);
  const result = await readSessionMetrics(dir, ['codex']) as Awaited<ReturnType<typeof readSessionMetrics>> & TaskFields;
  assert.equal(result.taskSeconds, 30);
  assert.equal(result.taskTimingKind, 'recorded');
  assert.equal(result.messageCount, 1);
  const stored = await readFile(join(dir, 'sessions/codex.json'), 'utf8');
  assert.equal(stored.includes('private prompt'), false);
  assert.equal(stored.includes('private result'), false);
  await appendFile(file, record(start + 18 * 86400000, 'event_msg', { type: 'thread_settings_applied' }) + '\n');
  await syncSessionSource(dir, 'codex', discovery);
  assert.equal(((await readSessionMetrics(dir, ['codex'])) as Awaited<ReturnType<typeof readSessionMetrics>> & TaskFields).taskSeconds, 30);
});

test('task end timestamps and aborted turns pair with their own start and never the next prompt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-task-pair-'));
  const file = join(dir, 's.jsonl');
  await writeFile(file, [
    { timestamp: '2026-10-14T00:00:00Z', type: 'session_meta', payload: { id: 's' } },
    { timestamp: '2026-10-14T00:00:00Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'legacy-1' } },
    { timestamp: '2026-10-14T00:00:40Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'legacy-1' } },
    { timestamp: '2026-10-14T01:00:00Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'legacy-2' } },
    { timestamp: '2026-10-14T01:00:15Z', type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 'legacy-2' } },
    { timestamp: '2026-10-14T02:00:00Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'pending' } },
  ].map(r => JSON.stringify(r)).join('\n') + '\n');
  await syncSessionSource(dir, 'codex', { inputs: [{ path: file, sessionId: 's', kind: 'jsonl' }], complete: true });
  const result = await readSessionMetrics(dir, []) as Awaited<ReturnType<typeof readSessionMetrics>> & TaskFields;
  assert.equal(result.taskSeconds, 55);
  assert.equal(result.messageCount, 0);
});

test('Kimi thinking and tool events extend estimates while injections and later settings do not', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-task-kimi-'));
  const file = join(dir, 'wire.jsonl');
  const start = Date.parse('2026-10-14T00:00:00Z');
  await writeFile(file, [
    { type: 'metadata', protocol_version: '1.5' },
    { type: 'context.append_message', time: start, message: { role: 'user', content: 'hello', origin: { kind: 'user' } } },
    { type: 'context.append_loop_event', time: start + 3000, event: { type: 'content.part', stepUuid: 'step', part: { type: 'think', think: 'private thinking' } } },
    { type: 'context.append_loop_event', time: start + 15000, event: { type: 'tool.result', stepUuid: 'step', result: 'private tool result' } },
    { type: 'context.append_loop_event', time: start + 30000, event: { type: 'step.end', stepUuid: 'step' } },
    { type: 'settings.changed', time: start + 18 * 86400000 },
  ].map(r => JSON.stringify(r)).join('\n') + '\n');
  await syncSessionSource(dir, 'kimi', { inputs: [{ path: file, sessionId: 's', kind: 'jsonl' }], complete: true });
  const result = await readSessionMetrics(dir, ['kimi']) as Awaited<ReturnType<typeof readSessionMetrics>> & TaskFields;
  assert.equal(result.taskSeconds, 30);
  assert.equal(result.taskTimingKind, 'estimated');
  assert.equal(result.messageCount, 1);
  const stored = await readFile(join(dir, 'sessions/kimi.json'), 'utf8');
  assert.equal(stored.includes('private thinking'), false);
  assert.equal(stored.includes('private tool result'), false);
});

test('SQLite execution parts extend assistant clocks while file and settings parts do not', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-task-db-'));
  const file = join(dir, 'opencode.db');
  const start = Date.parse('2026-10-14T00:00:00Z');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE message (id TEXT, session_id TEXT, data TEXT); CREATE TABLE part (id TEXT, message_id TEXT, data TEXT)');
  const insert = db.prepare('INSERT INTO message VALUES (?, ?, ?)');
  insert.run('u', 's', JSON.stringify({ role: 'user', time: { created: start } }));
  insert.run('a', 's', JSON.stringify({ role: 'assistant', time: { created: start + 10000, completed: start + 20000 } }));
  const part = db.prepare('INSERT INTO part VALUES (?, ?, ?)');
  part.run('tool', 'a', JSON.stringify({ type: 'tool', state: { time: { start: start + 20000, end: start + 45000 } } }));
  part.run('file', 'a', JSON.stringify({ type: 'file', time: { start, end: start + 18 * 86400000 } }));
  db.close();
  await syncSessionSource(dir, 'opencode', { inputs: [{ path: file, sessionId: 'db', kind: 'sqlite' }], complete: true });
  const result = await readSessionMetrics(dir, ['opencode']) as Awaited<ReturnType<typeof readSessionMetrics>> & TaskFields;
  assert.equal(result.taskSeconds, 45);
  assert.equal(result.taskTimingKind, 'estimated');
  assert.equal(result.messageCount, 2);
});

test('schema backfill preserves archived logical messages when their raw files are removed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-task-migrate-'));
  const file = join(dir, 's.jsonl');
  await writeFile(file, JSON.stringify({ type: 'user', uuid: 'u', timestamp: '2026-10-14T00:00:00Z', message: { content: 'hello' } }) + '\n');
  await syncSessionSource(dir, 'claude', { inputs: [{ path: file, sessionId: 's', kind: 'jsonl' }], complete: true });
  const cache = join(dir, 'sessions/claude.json');
  const previous = JSON.parse(await readFile(cache, 'utf8'));
  previous.version = 3;
  for (const entry of Object.values(previous.files) as { timings?: unknown }[]) delete entry.timings;
  await writeFile(cache, JSON.stringify(previous));
  await unlink(file);
  await syncSessionSource(dir, 'claude', { inputs: [], complete: true });
  assert.equal(JSON.parse(await readFile(cache, 'utf8')).version, 10);
  assert.equal((await readSessionMetrics(dir, ['claude'])).messageCount, 1);
});
