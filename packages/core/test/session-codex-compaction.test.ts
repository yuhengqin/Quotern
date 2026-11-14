import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aggregateSessionActivity, extractSessionObservation, type ObservationContext } from '../src/session-observation.js';
import { readSessionHistory, syncSessionSource } from '../src/session-collector.js';
import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore } from '../src/server/state.js';
import type { TudConfig } from '../src/types.js';
import { createDataBackup, restoreDataBackup, verifyDataBackup } from '../src/backup.js';
import { createHash } from 'node:crypto';

type Row = Record<string, unknown>;
const stamp = '2026-11-13T04:14:04.673Z';
const usage = { input_tokens: 453785, cached_input_tokens: 453632, output_tokens: 6348, reasoning_output_tokens: 0, total_tokens: 460133 };
const response = (id = 'private-response-id', value: Row = usage, timestamp = stamp, extra: Row = {}): Row => ({
  type: 'token_usage_record', timestamp, payload: { response_id: id, usage: value, ...extra },
});
const marker = (id = 'private-response-id'): Row => ({ type: 'compacted', timestamp: '2026-11-13T04:14:06Z', payload: { compaction_response_id: id, replacement_history: 'PRIVATE_COMPACTION_TEXT' } });
const ordinary = (value: Row, total?: Row, timestamp = '2026-11-13T04:14:05Z'): Row => ({
  type: 'event_msg', timestamp, payload: { type: 'token_count', info: { last_token_usage: value, ...(total ? { total_token_usage: total } : {}) } },
});
function context(sessionId = 'session', parentId?: string): ObservationContext {
  const ctx: ObservationContext = { sessionId, parentId, projectLabel: 'fixture' };
  extractSessionObservation('codex', { type: 'session_meta', payload: { id: sessionId, model_provider: 'openai', creator_account_id: 'PRIVATE_ACCOUNT' } }, ctx);
  extractSessionObservation('codex', { type: 'turn_context', payload: { model: 'gpt-6.1-sol', auth_mode: 'chatgpt' } }, ctx);
  return ctx;
}
const project = (rows: Row[], ctx = context()) => rows.flatMap(row => {
  const event = extractSessionObservation('codex', row, ctx);
  return event ? [event] : [];
});

test('Codex session includes the standalone compaction request with its original numerical evidence', () => {
  const events = project([response(), marker()]);
  const result = aggregateSessionActivity(events, [], { totalTokens: 460133 });
  const session = result.sessions[0]!;
  assert.equal(session?.tokens, 460133);
  assert.equal(session.models?.[0]?.requests, 1);
  assert.deepEqual(events[0]?.tokenParts, { input_tokens: 153, output_tokens: 6348, cached_input_tokens: 453632, cache_creation_input_tokens: 0, reasoning_output_tokens: 0 });
  assert.equal(events[0]?.timestamp, stamp);
  assert.equal(events[0]?.billing.mode, 'subscription');
  assert.ok(events[0]?.billing.accountRef);
  assert.ok(Math.abs(session.costUsd! - 0.1091492) < 1e-9);
  assert.equal(result.otherTokens, 0);
});

test('ordinary Codex notifications cover a response regardless of the compaction marker order', () => {
  for (const rows of [
    [response(), ordinary(usage), marker()],
    [response(), marker(), ordinary(usage)],
    [marker(), response(), ordinary(usage)],
  ]) {
    const result = aggregateSessionActivity(project(rows), [], { totalTokens: 460133 });
    assert.equal(result.attributedTokens, 460133);
    assert.equal(result.sessions[0]?.models?.[0]?.requests, 1);
  }
});

test('only the latest matching Codex response can be covered by an ordinary notification', () => {
  const events = project([response('old', { input_tokens: 40 }), response('latest', { input_tokens: 50 }), ordinary({ input_tokens: 40 }), marker('old')]);
  const result = aggregateSessionActivity(events, [], { totalTokens: 80 });
  assert.equal(result.attributedTokens, 80);
  assert.equal(result.sessions[0]?.models?.[0]?.requests, 2);
});

test('Codex thread totals can prove ordinary coverage without changing the ordinary cumulative baseline', () => {
  const events = project([
    ordinary({ input_tokens: 100 }, { input_tokens: 100, total_tokens: 100 }, '2026-11-13T04:00:00Z'),
    response('covered', { input_tokens: 40 }, stamp, { thread_token_usage: { input_tokens: 105, total_tokens: 105 } }),
    ordinary({ input_tokens: 5 }, { input_tokens: 105, total_tokens: 105 }), marker('covered'),
    response('standalone', { input_tokens: 30 }), marker('standalone'),
    { type: 'event_msg', timestamp: '2026-11-13T04:15:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 125, total_tokens: 125 } } } },
  ]);
  assert.equal(aggregateSessionActivity(events, [], { totalTokens: 155 }).attributedTokens, 155);
});

test('compaction keeps the request model, tier and date when its marker arrives after settings change', () => {
  const ctx = context();
  const events = project([
    { type: 'thread_settings_applied', payload: { service_tier: 'fast' } },
    response('delayed', { input_tokens: 100, output_tokens: 20, reasoning_output_tokens: 5 }, '2026-11-13T15:59:00Z'),
    { type: 'turn_context', payload: { model: 'gpt-6-astra', service_tier: 'default' } }, marker('delayed'),
  ], ctx);
  const beforeMidnight = aggregateSessionActivity(events, [], { fromDate: '2026-11-13', toDate: '2026-11-13', totalTokens: 120 });
  assert.equal(beforeMidnight.attributedTokens, 120);
  assert.equal(beforeMidnight.sessions[0]?.models?.[0]?.model, 'gpt-6.1-sol');
  assert.deepEqual(beforeMidnight.sessions[0]?.models?.[0]?.serviceTiers, ['fast']);
  assert.equal(aggregateSessionActivity(events, [], { fromDate: '2026-11-14', toDate: '2026-11-14', totalTokens: 0 }).attributedTokens, 0);
});

test('compaction normalizes cache-write aliases and does not retain raw response ids or content', () => {
  const ctx = context();
  const events = project([response('PRIVATE_RESPONSE_ID', { input_tokens: 50, cache_read_input_tokens: 10, cache_write_input_tokens: 7, output_tokens: 10, reasoning_output_tokens: 3, prompt: 'PRIVATE_USAGE_TEXT' }), marker('PRIVATE_RESPONSE_ID')], ctx);
  assert.deepEqual(events[0]?.tokenParts, { input_tokens: 33, output_tokens: 7, cached_input_tokens: 10, cache_creation_input_tokens: 7, reasoning_output_tokens: 3 });
  const saved = JSON.stringify({ events, ctx });
  for (const secret of ['PRIVATE_RESPONSE_ID', 'PRIVATE_ACCOUNT', 'PRIVATE_USAGE_TEXT', 'PRIVATE_COMPACTION_TEXT']) assert.equal(saved.includes(secret), false);
});

test('compaction inherits recorded subscription evidence only for the same provider and account', () => {
  const ctx: ObservationContext = { sessionId: 'session', observationModel: 'gpt-6.1-sol' };
  const meta = (account: string): Row => ({ type: 'session_meta', payload: { id: 'session', model_provider: 'openai', creator_account_id: account } });
  const proof: Row = { ...ordinary({ input_tokens: 10 }), payload: { type: 'token_count', rate_limits: { plan_type: 'pro' }, info: { last_token_usage: { input_tokens: 10 } } } };
  const events = project([meta('account-a'), proof, response('same-account'), marker('same-account'), meta('account-b'), response('new-account'), marker('new-account')], ctx);
  assert.equal(events[1]?.billing.mode, 'subscription');
  assert.equal(events[1]?.billing.accountRef, events[0]?.billing.accountRef);
  assert.equal(events[2]?.billing.mode, 'unknown');
  assert.notEqual(events[2]?.billing.accountRef, events[0]?.billing.accountRef);
});

test('unmarked and malformed response records do not invent session usage', () => {
  assert.equal(project([response()]).length, 0);
  assert.equal(project([response('', usage), marker('')]).length, 0);
  assert.equal(project([response('bad', { input_tokens: 'invalid' }), marker('bad')]).length, 0);
  const repeated = project([response(), marker(), response(' private-response-id '), marker(' private-response-id ')]);
  assert.equal(aggregateSessionActivity(repeated, [], { totalTokens: 460133 }).attributedTokens, 460133);
});

test('Codex fork replay drops inherited compaction but retains a new response with identical usage', () => {
  const parent = project([response('inherited'), marker('inherited')], context('parent'));
  const child = project([response('inherited'), marker('inherited'), response('new', usage, '2026-11-14T04:00:00Z'), marker('new')], context('child', 'parent'));
  const result = aggregateSessionActivity([...parent, ...child], [], { fromDate: '2026-11-14', toDate: '2026-11-14', totalTokens: 460133 });
  assert.equal(result.attributedTokens, 460133);
  assert.equal(result.sessions[0]?.sessionId, 'child');
  assert.equal(result.sessions[0]?.models?.[0]?.requests, 1);
});

test('a copied compaction response is billed once even when the child has no inherited-prefix metadata', () => {
  const original = project([response('shared'), marker('shared')], context('original'));
  const copy = project([response('shared', usage, '2026-11-14T04:00:00Z'), marker('shared')], context('copy'));
  const all = aggregateSessionActivity([...original, ...copy], [], { totalTokens: 460133 });
  assert.equal(all.attributedTokens, 460133);
  assert.equal(aggregateSessionActivity([...original, ...copy], [], { fromDate: '2026-11-14', toDate: '2026-11-14', totalTokens: 0 }).attributedTokens, 0);
});

test('Codex compaction pairs across persisted scans and refreshes list, detail and CSV consistently', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'quotern-session-compaction-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const input = join(dataDir, 'rollout.jsonl');
  const initial = [{ type: 'session_meta', payload: { id: 'session', model_provider: 'openai' } }, { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } }, response()];
  await writeFile(input, initial.map(row => JSON.stringify(row)).join('\n') + '\n');
  const discovered = { complete: true, inputs: [{ path: input, sessionId: 'session', kind: 'jsonl' as const }] };
  await syncSessionSource(dataDir, 'codex', discovered);
  assert.equal((await readSessionHistory(dataDir, ['codex'])).observations.length, 0);
  await appendFile(input, JSON.stringify(marker()) + '\n');
  await syncSessionSource(dataDir, 'codex', discovered);
  const app = createLocalApiApp({ dataDir, bucketStore: new BucketStore(), getConfig: () => ({ statsSince: '2026-01-01T00:00:00Z' } as TudConfig) });
  const bounds = 'fromDate=2026-11-13&toDate=2026-11-13';
  const list = (await (await app.request(`/functions/tud-session-list?${bounds}`)).json()).data;
  const detail = (await (await app.request(`/functions/tud-session-detail?${bounds}&source=codex&sessionId=session`)).json()).data;
  assert.equal(list.sessions[0]?.tokens, 460133);
  assert.equal(detail.session?.tokens, 460133);
  assert.equal(detail.session?.models[0]?.requests, 1);
  const csv = await (await app.request(`/functions/tud-session-list?${bounds}&format=csv`)).text();
  assert.ok(csv.includes('460133'));
  await appendFile(input, JSON.stringify(ordinary(usage)) + '\n');
  await syncSessionSource(dataDir, 'codex', discovered);
  const history = await readSessionHistory(dataDir, ['codex']);
  assert.equal(aggregateSessionActivity(history.observations, [], { totalTokens: 460133 }).attributedTokens, 460133);
  assert.equal(await syncSessionSource(dataDir, 'codex', discovered), false);
  const saved = await readFile(join(dataDir, 'sessions', 'codex.json'), 'utf8');
  assert.equal(saved.includes('private-response-id'), false);
});

test('version 12 session history backfills existing rollouts and preserves deleted-file observations', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'quotern-session-compaction-migration-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const input = join(dataDir, 'rollout.jsonl'), removed = join(dataDir, 'removed.jsonl');
  await writeFile(input, [{ type: 'session_meta', payload: { id: 'session' } }, response(), marker()].map(row => JSON.stringify(row)).join('\n') + '\n');
  await writeFile(removed, JSON.stringify(ordinary({ input_tokens: 7 })) + '\n');
  const inputs = [{ path: input, sessionId: 'session', kind: 'jsonl' as const }, { path: removed, sessionId: 'removed', kind: 'jsonl' as const }];
  await syncSessionSource(dataDir, 'codex', { complete: true, inputs });
  const cachePath = join(dataDir, 'sessions', 'codex.json');
  const previous = JSON.parse(await readFile(cachePath, 'utf8'));
  previous.version = 12;
  previous.files[input].observations = {};
  await writeFile(cachePath, JSON.stringify(previous));
  await unlink(removed);
  const discovered = { complete: true, inputs: [inputs[0]!] };
  assert.equal(await syncSessionSource(dataDir, 'codex', discovered), true);
  const history = await readSessionHistory(dataDir, ['codex']);
  const result = aggregateSessionActivity(history.observations, [], { totalTokens: 460140 });
  assert.equal(result.sessions.find(row => row.sessionId === 'session')?.tokens, 460133);
  assert.equal(result.sessions.find(row => row.sessionId === 'removed')?.tokens, 7);
  assert.equal(await syncSessionSource(dataDir, 'codex', discovered), false);
});

test('persisted duplicate ordinary snapshots keep their compaction coverage evidence', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'quotern-compaction-duplicate-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const input = join(dataDir, 'rollout.jsonl');
  const notification = ordinary(usage, usage);
  await writeFile(input, [{ type: 'session_meta', payload: { id: 'session' } }, response(), marker(), notification, notification].map(row => JSON.stringify(row)).join('\n') + '\n');
  await syncSessionSource(dataDir, 'codex', { complete: true, inputs: [{ path: input, sessionId: 'session', kind: 'jsonl' }] });
  const history = await readSessionHistory(dataDir, ['codex']);
  const result = aggregateSessionActivity(history.observations, [], { totalTokens: 460133 });
  assert.equal(result.attributedTokens, 460133);
  assert.equal(result.sessions[0]?.models?.[0]?.requests, 1);
});

test('an obsolete archive copy cannot discard new ordinary coverage during schema backfill', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'quotern-compaction-archive-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const input = join(dataDir, 'rollout.jsonl');
  await writeFile(input, [{ type: 'session_meta', payload: { id: 'session' } }, response(), marker(), ordinary(usage, usage)].map(row => JSON.stringify(row)).join('\n') + '\n');
  const discovered = { complete: true, inputs: [{ path: input, sessionId: 'session', kind: 'jsonl' as const }] };
  await syncSessionSource(dataDir, 'codex', discovered);
  const cachePath = join(dataDir, 'sessions', 'codex.json');
  const old = JSON.parse(await readFile(cachePath, 'utf8'));
  old.version = 12;
  const copy = structuredClone(old.files[input]);
  copy.observations = Object.fromEntries(Object.entries(copy.observations).filter(([, event]) => !(event as Row).codexCompactionId));
  for (const event of Object.values(copy.observations) as Row[]) delete event.codexCoveredResponseId;
  delete copy.context.observationCodexResponses;
  old.files[join(dataDir, 'deleted-archive.jsonl')] = copy;
  await writeFile(cachePath, JSON.stringify(old));
  await syncSessionSource(dataDir, 'codex', discovered);
  const history = await readSessionHistory(dataDir, ['codex']);
  assert.equal(aggregateSessionActivity(history.observations, [], { totalTokens: 460133 }).attributedTokens, 460133);
});

test('backup restores pending compaction pairing and rejects malformed persisted pairing state', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'quotern-compaction-backup-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await writeFile(join(dataDir, 'config.json'), JSON.stringify({ statsSince: '2026-01-01T00:00:00Z' }));
  const input = join(dataDir, 'rollout.jsonl');
  await writeFile(input, [{ type: 'session_meta', payload: { id: 'session' } }, response()].map(row => JSON.stringify(row)).join('\n') + '\n');
  const discovered = { complete: true, inputs: [{ path: input, sessionId: 'session', kind: 'jsonl' as const }] };
  await syncSessionSource(dataDir, 'codex', discovered);
  const backup = await createDataBackup(dataDir);
  const restored = join(dataDir, 'restored');
  await restoreDataBackup(backup, restored);
  await appendFile(input, JSON.stringify(marker()) + '\n');
  await syncSessionSource(restored, 'codex', discovered);
  const history = await readSessionHistory(restored, ['codex']);
  assert.equal(aggregateSessionActivity(history.observations, [], { totalTokens: 460133 }).attributedTokens, 460133);
  for (const malformed of [{ markers: {} }, { pending: [] }, { latest: { event: [] } }]) {
    const damaged = structuredClone(backup);
    const member = damaged.files.find(file => file.path === 'sessions/codex.json')!;
    const snapshot = JSON.parse(member.content);
    Object.assign(snapshot.files[input].context.observationCodexResponses, malformed);
    member.content = JSON.stringify(snapshot);
    member.bytes = Buffer.byteLength(member.content);
    member.sha256 = createHash('sha256').update(member.content).digest('hex');
    assert.throws(() => verifyDataBackup(damaged), /BACKUP_CONTENT_INVALID/);
  }
});
