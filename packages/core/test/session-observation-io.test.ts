import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncSessionSource, readSessionHistory } from '../src/session-collector.js';
import { aggregateSessionActivity } from '../src/session-observation.js';
import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore } from '../src/server/state.js';
import { readOMPQuotaObservations } from '../src/quota/readers/quota-observations.js';
import type { TudConfig } from '../src/types.js';
import { accountReference } from '../src/account-reference.js';
import { normalizeQuotaSnapshot } from '../src/quota/shared/quota-analysis.js';
import { DEFAULT_QUOTA_PREFERENCES } from '../src/quota/shared/quota.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

test('session ledger persists final call snapshots, retries safely and serves filtered local activity', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'quotern-session-observation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'claude.jsonl');
  const event = (input_tokens: number) => ({ type: 'assistant', sessionId: 'fixture-session', requestId: 'request-a', timestamp: '2026-10-16T04:00:00Z', message: { id: 'm', role: 'assistant', model: 'fixture-model', content: [{ type: 'text', text: 'PROMPT_NEVER_STORE' }], usage: { input_tokens, output_tokens: 5 } } });
  await writeFile(input, [event(10), event(25), { type: 'system', subtype: 'compact_boundary', sessionId: 'fixture-session', timestamp: '2026-10-16T04:01:00Z', compactMetadata: {} }].map(value => JSON.stringify(value)).join('\n') + '\n');
  const discovered = { complete: true, inputs: [{ path: input, sessionId: 'fixture-session', kind: 'jsonl' as const }] };
  assert.equal(await syncSessionSource(directory, 'claude', discovered), true);
  assert.equal(await syncSessionSource(directory, 'claude', discovered), false);
  const history = await readSessionHistory(directory, ['claude']);
  assert.equal(aggregateSessionActivity(history.observations, history.messages, { totalTokens: 31 }).attributedTokens, 30);
  const persisted = await readFile(join(directory, 'sessions', 'claude.json'), 'utf8');
  assert.equal(persisted.includes('PROMPT_NEVER_STORE'), false);
  const store = new BucketStore();
  store.apply([{ source: 'claude', model: 'fixture-model', project: 'fixture', hour_start: '2026-10-16T04:00:00Z', input_tokens: 26, output_tokens: 5, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 31, conversation_count: 1 }]);
  const app = createLocalApiApp({ dataDir: directory, bucketStore: store, getConfig: () => ({ statsSince: '2026-01-01T00:00:00Z', localCollectSince: '2026-01-01T00:00:00Z' } as TudConfig) });
  const response = await app.request('/functions/tud-session-activity?fromDate=2026-10-16&toDate=2026-10-16&sources=claude');
  assert.equal(response.status, 200);
  const result = (await response.json()).data;
  assert.equal(result.sessions[0].tokens, 30); assert.equal(result.otherTokens, 1); assert.equal(result.sessions[0].context.usedTokens, null);
  assert.equal((await app.request('/functions/tud-session-activity?sources=unknown')).status, 400);
  assert.equal((await app.request('/functions/tud-session-activity?fromDate=broken&toDate=2026-10-16')).status, 400);
  assert.equal((await app.request('/functions/tud-session-activity', { headers: { Origin: 'https://evil.example' } })).status, 403);
});

test('OpenCode V1/V2 projections include compaction without duplicate call usage or content', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'quotern-opencode-observation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'opencode.db'), db = new DatabaseSync(input);
  db.exec('CREATE TABLE message (id TEXT, session_id TEXT, data TEXT, time_created INTEGER); CREATE TABLE session_message (id TEXT, session_id TEXT, type TEXT, data TEXT, time_created INTEGER)');
  const clock = Date.parse('2026-10-16T04:00:00Z');
  const a = { role: 'assistant', model: { id: 'fixture-model', providerID: 'anthropic' }, tokens: { input: 10, output: 5, cache: { read: 3, write: 2 } }, cost: 0.1, time: { created: clock, completed: clock }, content: 'PRIVATE_RESPONSE_NEVER_STORE' };
  db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run('call', 's', JSON.stringify(a), clock);
  db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?)').run('call', 's', 'assistant', JSON.stringify(a), clock);
  db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run('compact', 's', JSON.stringify({ ...a, role: 'compaction', tokens: { input: 3, output: 1 }, cost: 0.01 }), clock);
  db.close();
  await syncSessionSource(directory, 'opencode', { complete: true, inputs: [{ path: input, sessionId: 'db', kind: 'sqlite' }] });
  const history = await readSessionHistory(directory, ['opencode']);
  const result = aggregateSessionActivity(history.observations, history.messages, { totalTokens: 24 });
  assert.equal(result.attributedTokens, 24); assert.equal(history.messages.length, 1);
  assert.equal(result.billing[0]?.service, 'anthropic'); assert.ok(Math.abs(result.sessions[0]!.costUsd! - 0.11) < 1e-8);
  assert.equal((await readFile(join(directory, 'sessions', 'opencode.json'), 'utf8')).includes('PRIVATE_RESPONSE_NEVER_STORE'), false);
});

test('OMP observes the real usage_history schema read-only without touching credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'quotern-omp-observation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'agent.db'), db = new DatabaseSync(input);
  db.exec('CREATE TABLE usage_history (provider TEXT, account_key TEXT, email TEXT, account_id TEXT, limit_id TEXT, label TEXT, window_label TEXT, used_fraction REAL, status TEXT, resets_at INTEGER, recorded_at INTEGER); CREATE TABLE auth_credentials (data TEXT)');
  db.prepare('INSERT INTO auth_credentials VALUES (?)').run('CREDENTIAL_NEVER_READ');
  const now = Date.now();
  db.prepare('INSERT INTO usage_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('openai-codex', 'opaque-account-key', 'fixture@example.test', 'fixture-account', 'openai-codex:primary', '5h', '5h', 0.25, 'ok', now + 18000000, now);
  db.close();
  const before = await readFile(input), result = readOMPQuotaObservations(input);
  assert.equal(result.length, 1); assert.equal(result[0]?.snapshot.windows[0]?.usedPercent, 25);
  assert.equal(JSON.stringify(result).includes('fixture@example.test'), false); assert.equal(JSON.stringify(result).includes('CREDENTIAL_NEVER_READ'), false);
  assert.deepEqual(await readFile(input), before);
});

test('session account references join profile labels through HTTP and the Electron quota getter', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'quotern-account-label-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'codex.jsonl');
  await writeFile(input, [
    { type: 'session_meta', payload: { id: 's', creator_account_id: 'fixture-private-account', model_provider: 'openai' } },
    { type: 'event_msg', timestamp: '2026-10-16T04:00:00Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 10, output_tokens: 2 }, model_context_window: 100 } } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  await syncSessionSource(directory, 'codex', { complete: true, inputs: [{ path: input, sessionId: 's', kind: 'jsonl' }] });
  const provider = { ...normalizeQuotaSnapshot('codex', 'Codex', {}), profileLabel: '工作', provenance: { source: 'native' as const, observer: 'Codex', observedAt: 1000, identityVerified: true, accountRef: accountReference('openai', 'fixture-private-account') } };
  const state = { providers: [provider], preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), notice: null };
  const quota = { getState: () => state, refresh: async () => state, setPreferences: async () => state };
  for (const extra of [{ quota }, { getQuotaState: () => state }]) {
    const app = createLocalApiApp({ ...extra, dataDir: directory, bucketStore: new BucketStore(), getConfig: () => ({ statsSince: '2026-01-01T00:00:00Z' } as TudConfig) });
    const result = await (await app.request('/functions/tud-session-activity?fromDate=2026-10-16&toDate=2026-10-16')).json();
    assert.equal(result.data.sessions[0].billing.accountLabel, '工作');
    assert.equal(JSON.stringify(result).includes('fixture-private-account'), false);
  }
  assert.equal((await readFile(join(directory, 'sessions', 'codex.json'), 'utf8')).includes('fixture-private-account'), false);
});
