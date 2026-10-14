import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateSessionMetrics, type SessionMessage } from '../src/session-metrics.js';
import { extractSessionMessage, type SessionFileContext } from '../src/session-sources.js';
import { mkdtemp, writeFile, appendFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncSessionSource, readSessionMetrics } from '../src/session-collector.js';
import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore, createApplyAfterSync } from '../src/server/state.js';
import type { TudConfig } from '../src/types.js';

const message = (id: string, timestamp: string, role: 'user' | 'assistant' = 'assistant', source = 'codex', sessionId = 's1'): SessionMessage => ({ id, timestamp, role, source, sessionId });

test('session metrics deduplicate logical messages and namespace identical session ids by source', () => {
  const rows = [message('u1', '2026-10-14T00:00:00Z', 'user'), message('a1', '2026-10-14T00:01:00Z'), message('a1', '2026-10-14T00:01:00Z'), message('u1', '2026-10-14T00:00:00Z', 'user', 'claude'), message('a1', '2026-10-14T00:02:00Z', 'assistant', 'claude')];
  const result = aggregateSessionMetrics(rows);
  assert.equal(result.sessionCount, 2);
  assert.equal(result.messageCount, 4);
  assert.equal(result.durationSeconds, 180);
  assert.equal(result.activeSeconds, null);
});

test('session range filters use local dates and count a cross-day session once', () => {
  const rows = [message('u1', '2026-10-13T15:59:00Z', 'user'), message('a1', '2026-10-13T16:01:00Z'), message('u2', '2026-10-14T00:00:00Z', 'user'), message('a2', '2026-10-14T00:01:00Z')];
  const day = aggregateSessionMetrics(rows, { fromDate: '2026-10-14', toDate: '2026-10-14', timeZone: 'Asia/Shanghai' });
  assert.equal(day.sessionCount, 1);
  assert.equal(day.messageCount, 3);
  assert.equal(day.durationSeconds, 28800);
  assert.equal(aggregateSessionMetrics(rows, { fromDate: '2026-10-13', toDate: '2026-10-14', timeZone: 'Asia/Shanghai' }).sessionCount, 1);
});

test('source filters exclude unselected messages and coverage gaps', () => {
  const rows = [message('u', '2026-10-14T00:00:00Z', 'user'), message('a', '2026-10-14T00:01:00Z'), message('x', '2026-10-14T00:00:00Z', 'user', 'claude')];
  const result = aggregateSessionMetrics(rows, { sources: ['codex'], missingSources: ['cursor'] });
  assert.equal(result.sessionCount, 1);
  assert.equal(result.messageCount, 2);
  assert.equal(result.durationSeconds, 60);
  assert.equal(result.complete, true);
  assert.deepEqual(result.missingSources, []);
});

test('unavailable timing stays unknown and invalid timestamps are not counted', () => {
  const result = aggregateSessionMetrics([message('a', 'invalid')], { missingSources: ['cursor'] });
  assert.equal(result.sessionCount, 0);
  assert.equal(result.messageCount, 0);
  assert.equal(result.activeSeconds, null);
  assert.equal(result.complete, false);
});

test('Claude counts logical messages once and excludes tool result and metadata records', () => {
  const context: SessionFileContext = { sessionId: 's' };
  const user = extractSessionMessage('claude', { type: 'user', uuid: 'u', timestamp: '2026-10-14T00:00:00Z', message: { content: [{ type: 'text', text: 'hello' }] } }, context);
  const assistant = { type: 'assistant', timestamp: '2026-10-14T00:01:00Z', message: { id: 'a', content: [{ type: 'text', text: 'done' }] } };
  const rows = [user, extractSessionMessage('claude', assistant, context), extractSessionMessage('claude', assistant, context)].filter((row): row is SessionMessage => Boolean(row));
  assert.equal(aggregateSessionMetrics(rows).messageCount, 2);
  assert.equal(extractSessionMessage('claude', { type: 'user', uuid: 'tool', timestamp: assistant.timestamp, message: { content: [{ type: 'tool_result', content: 'result' }] } }, context), null);
  assert.equal(extractSessionMessage('claude', { type: 'system', timestamp: assistant.timestamp }, context), null);
});

test('Codex metadata, usage and event mirrors do not become logical messages', () => {
  const context: SessionFileContext = { sessionId: 'fallback' };
  assert.equal(extractSessionMessage('codex', { type: 'session_meta', payload: { id: 'thread' } }, context), null);
  assert.equal(context.sessionId, 'thread');
  assert.equal(extractSessionMessage('codex', { type: 'event_msg', timestamp: '2026-10-14T00:00:00Z', payload: { type: 'user_message', message: 'hello' } }, context), null);
  assert.equal(extractSessionMessage('codex', { type: 'response_item', timestamp: '2026-10-14T00:00:00Z', payload: { type: 'function_call', name: 'exec_command' } }, context), null);
  assert.equal(extractSessionMessage('codex', { type: 'response_item', timestamp: '2026-10-14T00:00:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] } }, context)?.role, 'user');
});

test('Kimi request completions are not treated as messages', () => {
  const context: SessionFileContext = { sessionId: 'kimi' };
  assert.equal(extractSessionMessage('kimi', { type: 'usage.record', time: 1791936000000, usage: {} }, context), null);
  assert.equal(extractSessionMessage('kimi', { type: 'context.append_loop_event', time: 1791936000000, event: { type: 'step.end' } }, context), null);
});

test('Kimi user messages and assistant text fragments are counted without injections or thinking/tool events', () => {
  const context: SessionFileContext = { sessionId: 's' };
  const now = Date.parse('2026-10-14T00:00:00Z');
  const rows = [
    { type: 'context.append_message', time: now, message: { role: 'user', content: 'environment', origin: { kind: 'injection' } } },
    { type: 'context.append_message', time: now + 1000, message: { role: 'user', content: 'hello', origin: { kind: 'user' } } },
    { type: 'context.append_loop_event', time: now + 2000, event: { type: 'content.part', stepUuid: 'step1', part: { type: 'think', think: 'internal' } } },
    { type: 'context.append_loop_event', time: now + 3000, event: { type: 'content.part', stepUuid: 'step1', part: { type: 'text', text: 'hel' } } },
    { type: 'context.append_loop_event', time: now + 4000, event: { type: 'content.part', stepUuid: 'step1', part: { type: 'text', text: 'lo' } } },
    { type: 'context.append_loop_event', time: now + 5000, event: { type: 'tool.result', result: {} } },
  ].map((record) => extractSessionMessage('kimi', record, context)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  assert.equal(rows.filter((row) => row.role === 'user').length, 1);
  assert.equal(aggregateSessionMetrics(rows).sessionCount, 1);
  assert.equal(aggregateSessionMetrics(rows).messageCount, 2);
  assert.equal(aggregateSessionMetrics(rows).durationSeconds, 3);
});

test('missing clocks on real messages disclose incomplete coverage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-missing-clock-'));
  const file = join(dir, 's.jsonl');
  await writeFile(file, [JSON.stringify({ type: 'user', uuid: 'u', timestamp: '2026-10-01T00:00:00Z', message: { content: 'hello' } }), JSON.stringify({ type: 'assistant', message: { id: 'a', content: 'done' } })].join('\n'));
  await syncSessionSource(dir, 'claude', { inputs: [{ path: file, sessionId: 's', kind: 'jsonl' }], complete: true });
  assert.equal((await readSessionMetrics(dir, ['claude'])).complete, false);
});

test('known empty Kimi context logs do not create a false coverage gap', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-empty-kimi-'));
  const file = join(dir, 'wire.jsonl');
  await writeFile(file, [JSON.stringify({ type: 'metadata', protocol_version: '1.5' }), JSON.stringify({ type: 'context.append_message', time: Date.parse('2026-10-01T00:00:00Z'), message: { role: 'user', content: 'environment', origin: { kind: 'injection' } } })].join('\n'));
  await syncSessionSource(dir, 'kimi', { inputs: [{ path: file, sessionId: 's', kind: 'jsonl' }], complete: true });
  const result = await readSessionMetrics(dir, [], { sources: ['kimi'] });
  assert.equal(result.complete, true);
  assert.equal(result.messageCount, 0);
});

test('legacy Codex event-only conversations disclose unsupported message coverage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-legacy-codex-'));
  const file = join(dir, 's.jsonl');
  await writeFile(file, JSON.stringify({ type: 'event_msg', timestamp: '2026-10-01T00:00:00Z', payload: { type: 'user_message', message: 'hello' } }) + '\n');
  await syncSessionSource(dir, 'codex', { inputs: [{ path: file, sessionId: 's', kind: 'jsonl' }], complete: true });
  assert.equal((await readSessionMetrics(dir, [], { sources: ['codex'] })).complete, false);
});

test('independent session backfill is persistent, incremental and retries incomplete JSONL tails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-session-'));
  const file = join(dir, 's.jsonl');
  const user = { type: 'user', uuid: 'u1', timestamp: '2026-10-14T00:00:00Z', message: { content: 'private prompt' } };
  const ai = { type: 'assistant', timestamp: '2026-10-14T00:01:00Z', message: { id: 'a1', content: 'private reply' } };
  await writeFile(file, JSON.stringify(user) + '\n' + JSON.stringify(ai) + '\n');
  const inputs = [{ path: file, kind: 'jsonl' as const, sessionId: 's' }];
  assert.equal(await syncSessionSource(dir, 'claude', { inputs, complete: true }), true);
  assert.equal(await syncSessionSource(dir, 'claude', { inputs, complete: true }), false);
  let result = await readSessionMetrics(dir, ['claude']);
  assert.equal(result.messageCount, 2);
  assert.equal(result.durationSeconds, 60);
  await appendFile(file, '{"type":"user","uuid":"u2",');
  await syncSessionSource(dir, 'claude', { inputs, complete: true });
  assert.equal((await readSessionMetrics(dir, ['claude'])).messageCount, 2);
  await appendFile(file, '"timestamp":"2026-10-14T00:03:00Z","message":{"content":"next"}}\n');
  await syncSessionSource(dir, 'claude', { inputs, complete: true });
  result = await readSessionMetrics(dir, ['claude']);
  assert.equal(result.messageCount, 3);
  assert.equal(result.durationSeconds, 180);
  const persisted = await readFile(join(dir, 'sessions', 'claude.json'), 'utf8');
  assert.equal(persisted.includes('private prompt'), false);
  assert.equal(persisted.includes('private reply'), false);
  await writeFile(file, JSON.stringify(user) + '\n');
  await syncSessionSource(dir, 'claude', { inputs, complete: true });
  assert.equal((await readSessionMetrics(dir, ['claude'])).messageCount, 1);
});

test('fork replay and duplicate physical files do not recount copied messages', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-fork-'));
  const parent = join(dir, 'parent.jsonl'), child = join(dir, 'child.jsonl'), copy = join(dir, 'copy.jsonl');
  const meta = (id: string, forked_from_id?: string) => ({ type: 'session_meta', timestamp: '2026-10-14T00:02:00Z', payload: { id, forked_from_id } });
  const msg = (role: string, text: string, timestamp: string) => ({ type: 'response_item', timestamp, payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
  const original = [msg('user', 'hello', '2026-10-14T00:00:00Z'), msg('assistant', 'done', '2026-10-14T00:01:00Z')];
  await writeFile(parent, [meta('p'), ...original].map((row) => JSON.stringify(row)).join('\n') + '\n');
  await writeFile(copy, [meta('p'), ...original].map((row) => JSON.stringify(row)).join('\n') + '\n');
  await writeFile(child, [meta('c', 'p'), ...original, msg('user', 'new', '2026-10-14T00:03:00Z'), msg('assistant', 'new reply', '2026-10-14T00:04:00Z')].map((row) => JSON.stringify(row)).join('\n') + '\n');
  await syncSessionSource(dir, 'codex', { inputs: [parent, child, copy].map((path) => ({ path, sessionId: path, kind: 'jsonl' as const })), complete: true });
  const result = await readSessionMetrics(dir, ['codex']);
  assert.equal(result.sessionCount, 2);
  assert.equal(result.messageCount, 4);
  assert.equal(result.durationSeconds, 120);
});

test('a new prompt repeating parent text after a fork remains a real child message', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-fork-repeat-'));
  const parent = join(dir, 'p.jsonl'), child = join(dir, 'c.jsonl');
  const record = (role: string, text: string, timestamp: string) => ({ type: 'response_item', timestamp, payload: { type: 'message', role, content: [{ type: 'text', text }] } });
  await writeFile(parent, [{ type: 'session_meta', payload: { id: 'p' } }, record('user', 'continue', '2026-10-01T00:00:00Z'), record('assistant', 'first', '2026-10-01T00:01:00Z')].map((row) => JSON.stringify(row)).join('\n'));
  await writeFile(child, [{ type: 'session_meta', payload: { id: 'c', forked_from_id: 'p' } }, record('user', 'continue', '2026-10-01T00:02:00Z'), record('assistant', 'different', '2026-10-01T00:03:00Z')].map((row) => JSON.stringify(row)).join('\n'));
  await syncSessionSource(dir, 'codex', { inputs: [parent, child].map((path) => ({ path, sessionId: path, kind: 'jsonl' as const })), complete: true });
  assert.equal((await readSessionMetrics(dir, ['codex'])).messageCount, 4);
});

test('session API validates bounds/sources and returns persisted metadata without token buckets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-session-api-'));
  const file = join(dir, 's.jsonl');
  await writeFile(file, [{ type: 'user', uuid: 'u', timestamp: '2026-01-01T00:00:00Z', message: { content: 'hello' } }, { type: 'assistant', timestamp: '2026-01-01T00:01:00Z', message: { id: 'a', content: 'done' } }].map((row) => JSON.stringify(row)).join('\n'));
  await syncSessionSource(dir, 'claude', { inputs: [{ path: file, kind: 'jsonl', sessionId: 's' }], complete: true });
  const config = { dataDir: dir, statsSince: '2025-01-01T00:00:00Z' } as TudConfig;
  const app = createLocalApiApp({ dataDir: dir, getConfig: () => config, bucketStore: new BucketStore() });
  const response = await app.request('/functions/tud-usage-sessions?fromDate=2026-01-01&toDate=2026-01-01&sources=claude');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.sessionCount, 1);
  assert.equal(body.data.messageCount, 2);
  assert.equal(body.data.durationSeconds, 60);
  assert.equal(body.data.activeSeconds, null);
  assert.equal((await app.request('/functions/tud-usage-sessions?fromDate=2026-02-30&toDate=2026-03-01')).status, 400);
  assert.equal((await app.request('/functions/tud-usage-sessions?sources=../../private')).status, 400);
});

test('session-only synchronization notifies the panel without changing token buckets', async () => {
  let notified = 0;
  const store = new BucketStore();
  const apply = createApplyAfterSync({ getBucketStore: () => store, getAggregateCache: () => undefined, onApplied: () => notified++ });
  await apply([{ source: 'claude', eventsParsed: 0, filesProcessed: 0, bucketsWritten: 0, writtenBuckets: [], sessionsChanged: true }]);
  assert.equal(notified, 1);
  assert.deepEqual(store.getRows(), []);
});

test('damaged complete JSONL records keep coverage incomplete across unchanged scans', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-damaged-'));
  const file = join(dir, 's.jsonl');
  await writeFile(file, JSON.stringify({ type: 'user', uuid: 'u', timestamp: '2026-10-01T00:00:00Z', message: { content: 'hello' } }) + '\n{invalid}\n');
  const input = { inputs: [{ path: file, sessionId: 's', kind: 'jsonl' as const }], complete: true };
  await syncSessionSource(dir, 'claude', input);
  assert.equal((await readSessionMetrics(dir, ['claude'])).complete, false);
  await syncSessionSource(dir, 'claude', input);
  assert.equal((await readSessionMetrics(dir, ['claude'])).complete, false);
});

test('an explicitly selected unsupported source stays unknown without token buckets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-unsupported-'));
  const result = await readSessionMetrics(dir, [], { sources: ['cursor'] });
  assert.equal(result.complete, false);
  assert.deepEqual(result.missingSources, ['cursor']);
});

test('session API applies the same statistics floor as token APIs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-floor-'));
  const file = join(dir, 's.jsonl');
  await writeFile(file, [{ type: 'user', uuid: 'old', timestamp: '2026-09-01T00:00:00Z', message: { content: 'old' } }, { type: 'assistant', timestamp: '2026-10-01T00:00:00Z', message: { id: 'new', content: 'new' } }].map((row) => JSON.stringify(row)).join('\n'));
  await syncSessionSource(dir, 'claude', { inputs: [{ path: file, sessionId: 's', kind: 'jsonl' }], complete: true });
  const config = { dataDir: dir, statsSince: '2026-10-01T00:00:00Z' } as TudConfig;
  const app = createLocalApiApp({ dataDir: dir, getConfig: () => config, bucketStore: new BucketStore() });
  const response = await app.request('/functions/tud-usage-sessions?fromDate=2026-09-01&toDate=2026-10-01&sources=claude');
  const body = await response.json();
  assert.equal(body.data.messageCount, 1);
  assert.equal(body.data.durationSeconds, 0);
});

test('rewriting the middle of a JSONL file before appending rebuilds message dates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-rewrite-'));
  const file = join(dir, 's.jsonl');
  const filler = (JSON.stringify({ type: 'system', content: 'x'.repeat(200) }) + '\n').repeat(40);
  const user = (timestamp: string) => JSON.stringify({ type: 'user', uuid: 'u', timestamp, message: { content: 'hello' } }) + '\n';
  const ai = JSON.stringify({ type: 'assistant', timestamp: '2026-01-02T00:00:00Z', message: { id: 'a', content: 'done' } }) + '\n';
  const input = { inputs: [{ path: file, sessionId: 's', kind: 'jsonl' as const }], complete: true };
  await writeFile(file, filler + user('2026-01-01T00:00:00Z') + filler + ai);
  await syncSessionSource(dir, 'claude', input);
  await writeFile(file, filler + user('2026-02-01T00:00:00Z') + filler + ai + JSON.stringify({ type: 'user', uuid: 'tail', timestamp: '2026-02-02T00:00:00Z', message: { content: 'next' } }) + '\n');
  await syncSessionSource(dir, 'claude', input);
  const result = await readSessionMetrics(dir, ['claude'], { fromDate: '2026-01-01', toDate: '2026-01-31' });
  assert.equal(result.messageCount, 1);
  assert.equal(result.durationSeconds, 0);
});

test('a coverage gap in a source outside the displayed window does not mark unrelated sources partial', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-coverage-window-'));
  const file = join(dir, 's.jsonl');
  await writeFile(file, JSON.stringify({ type: 'context.append_message', time: Date.parse('2026-09-01T00:00:00Z'), message: { id: 'u', role: 'user', content: 'hello' } }) + '\n');
  await syncSessionSource(dir, 'kimi', { inputs: [{ path: file, sessionId: 's', kind: 'jsonl' }], complete: false });
  assert.equal((await readSessionMetrics(dir, [], { fromDate: '2026-10-01', toDate: '2026-10-14' })).complete, true);
  assert.equal((await readSessionMetrics(dir, ['kimi'], { fromDate: '2026-09-01', toDate: '2026-09-01' })).complete, false);
});
