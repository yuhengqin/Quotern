import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncSessionSource, readSessionHistory } from '../src/session-collector.js';
import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore } from '../src/server/state.js';
import type { TudConfig } from '../src/types.js';
import { applyPricingSnapshot, getPricingSnapshot, getModelPricing } from '../src/pricing/index.js';
import { SessionQueryService } from '../src/session-query.js';

async function fixture(t: TestContext) {
  const dataDir = await mkdtemp(join(tmpdir(), 'quotern-session-pages-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const input = join(dataDir, 'fixture.jsonl');
  const events = Array.from({ length: 27 }, (_, i) => [
    { type: 'assistant', sessionId: `s${String(i).padStart(2, '0')}`, cwd: i % 2 ? 'C:/alpha' : 'C:/beta', timestamp: `2026-10-16T04:${String(i).padStart(2, '0')}:00Z`, message: { id: `m${i}`, model: i % 2 ? 'model-a' : 'model-b', usage: { input_tokens: i + 1, output_tokens: 1 } } },
    { type: 'custom-title', sessionId: `s${String(i).padStart(2, '0')}`, customTitle: `Session ${i}` },
  ]).flat();
  await writeFile(input, events.map(row => JSON.stringify(row)).join('\n') + '\n');
  const discovered = { complete: true, inputs: [{ path: input, sessionId: 'fixture', kind: 'jsonl' as const }] };
  await syncSessionSource(dataDir, 'claude', discovered);
  const bucketStore = new BucketStore();
  const app = createLocalApiApp({ dataDir, bucketStore, getConfig: () => ({ statsSince: '2026-01-01T00:00:00Z' } as TudConfig) });
  return { dataDir, input, discovered, bucketStore, app, events };
}
const scope = 'fromDate=2026-10-16&toDate=2026-10-16';

test('repeated accounting reuses model matching and an updated pricing snapshot invalidates it', () => {
  const original = getPricingSnapshot();
  let scans = 0;
  const exact = new Proxy({ known: { input: 1 } }, { ownKeys(target) { scans++; return Reflect.ownKeys(target); } });
  try {
    applyPricingSnapshot({ builtin: { exact }, overlay: null });
    assert.equal(getModelPricing('unlisted-fixture').input, 0);
    const firstScans = scans;
    assert.ok(firstScans > 0);
    for (let i = 0; i < 20; i++) assert.equal(getModelPricing('unlisted-fixture').input, 0);
    assert.equal(scans, firstScans, 'unchanged catalog must not be searched again for every observation');
    applyPricingSnapshot({ builtin: { exact: { 'unlisted-fixture': { input: 7 } } }, overlay: null });
    assert.equal(getModelPricing('unlisted-fixture').input, 7);
  } finally { applyPricingSnapshot(original); }
});

test('unchanged history reuses materialized arrays across ranges and concurrent reads', async t => {
  const { dataDir } = await fixture(t);
  const [a, b] = await Promise.all([readSessionHistory(dataDir, ['claude']), readSessionHistory(dataDir, ['claude'])]);
  const c = await readSessionHistory(dataDir, ['claude'], { fromDate: '2026-10-16', toDate: '2026-10-16' });
  assert.equal(a.messages, b.messages);
  assert.equal(a.observations, c.observations);
  assert.equal(a.evidence, c.evidence);
});

test('list pages return lightweight rows and complete counts; filters and sorting run before slicing', async t => {
  const { app } = await fixture(t);
  const response = await app.request(`/functions/tud-session-list?${scope}&page=2&pageSize=12&sort=recent`);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.pagination, { page: 2, pageSize: 12, pages: 3, totalRoots: 27, totalSessions: 27, from: 13, to: 24 });
  assert.equal(data.sessions.length, 12);
  assert.equal(data.sessions[0].sessionId, 's14');
  assert.equal(data.sessions[0].detailLevel, 'summary');
  assert.equal(data.sessions[0].insights, undefined);
  assert.equal(data.sessions[0].models, undefined);
  assert.equal(data.sessions[0].taskSeconds, undefined);
  assert.deepEqual(data.facets.models, ['model-a', 'model-b']);
  const filtered = (await (await app.request(`/functions/tud-session-list?${scope}&model=model-a&sort=tokens&direction=ascending&pageSize=12&page=99`)).json()).data;
  assert.equal(filtered.pagination.page, 2);
  assert.equal(filtered.pagination.totalSessions, 13);
  assert.equal(filtered.sessions[0].sessionId, 's25');
  const searched = (await (await app.request(`/functions/tud-session-list?${scope}&q=Session%202&sort=recent`)).json()).data;
  assert.equal(searched.pagination.totalSessions, 8);
});

test('details load an exact session within the frozen window and export includes off-page matches', async t => {
  const { app } = await fixture(t);
  const response = await app.request(`/functions/tud-session-detail?${scope}&source=claude&sessionId=s00`);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.session.sessionId, 's00');
  assert.equal(data.session.models[0].tokens, 2);
  assert.ok(data.session.insights);
  assert.notEqual(data.session.detailLevel, 'summary');
  assert.equal(data.range.kind, 'selected');
  const missing = (await (await app.request('/functions/tud-session-detail?fromDate=2026-10-17&toDate=2026-10-17&source=claude&sessionId=s00')).json()).data;
  assert.equal(missing.session, null);
  const csv = await (await app.request(`/functions/tud-session-list?${scope}&page=2&model=model-a&format=csv`)).text();
  assert.ok(csv.includes('s01'));
  assert.ok(csv.includes('s25'));
  assert.ok(!csv.includes('s00'));
  for (const route of ['tud-session-list', 'tud-session-detail']) {
    assert.equal((await app.request(`/functions/${route}?${scope}&source=claude&sessionId=s00`, { headers: { Origin: 'https://evil.example' } })).status, 403);
  }
});

test('warm pages observe session-only writes and bucket revisions without contaminating other filters', async t => {
  const { app, dataDir, input, discovered, events, bucketStore } = await fixture(t);
  const route = `/functions/tud-session-list?${scope}&sort=tokens&direction=descending`;
  const first = (await (await app.request(route)).json()).data;
  assert.equal(first.sessions[0].tokens, 28);
  events[52] = { ...events[52], message: { id: 'm26', model: 'model-b', usage: { input_tokens: 100, output_tokens: 1 } } } as typeof events[number];
  await writeFile(input, events.map(row => JSON.stringify(row)).join('\n') + '\n');
  await syncSessionSource(dataDir, 'claude', discovered);
  const next = (await (await app.request(route)).json()).data;
  assert.equal(next.sessions[0].tokens, 101);
  assert.equal(next.sessions[0].sessionId, 's26');
  bucketStore.apply([{ source: 'claude', model: 'fixture', project: 'fixture', hour_start: '2026-10-16T04:00:00Z', input_tokens: 1000, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 1000, conversation_count: 1 }]);
  const total = (await (await app.request(route)).json()).data;
  assert.equal(total.totalTokens, 1000);
  const empty = (await (await app.request(route + '&q=does-not-exist')).json()).data;
  assert.equal(empty.sessions.length, 0);
  assert.equal((await (await app.request(route)).json()).data.pagination.totalSessions, 27);
});

test('invalid page sizes and malformed detail identities fail instead of broadening the query', async t => {
  const { app } = await fixture(t);
  for (const query of ['page=0', 'page=1.5', 'pageSize=0', 'pageSize=10000', 'direction=wrong', 'sort=wrong']) {
    assert.equal((await app.request(`/functions/tud-session-list?${scope}&${query}`)).status, 400, query);
  }
  assert.equal((await app.request(`/functions/tud-session-detail?${scope}&source=claude`)).status, 400);
});

test('root pagination keeps children on their parent page and exact details retain complete related usage', async t => {
  const { app, dataDir } = await fixture(t);
  const inputs = [];
  for (let i = 0; i < 15; i++) {
    const child = i >= 13, sessionId = child ? `child-${i}` : `root-${i}`;
    const parentId = i === 13 ? 'root-0' : 'root-12';
    const path = join(dataDir, `${sessionId}.jsonl`);
    await writeFile(path, [
      { type: 'session_meta', timestamp: '2026-10-16T03:00:00Z', payload: { id: sessionId, ...(child ? { source: { subagent: { thread_spawn: { parent_thread_id: parentId } } } } : {}) } },
      { type: 'event_msg', timestamp: `2026-10-16T05:${String(i).padStart(2, '0')}:00Z`, payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 10, output_tokens: 2 } } } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    inputs.push({ path, sessionId, kind: 'jsonl' as const });
  }
  await syncSessionSource(dataDir, 'codex', { complete: true, inputs });
  const route = `/functions/tud-session-list?${scope}&sources=codex&sort=recent`;
  const first = (await (await app.request(route)).json()).data;
  assert.equal(first.pagination.totalRoots, 13);
  assert.equal(first.pagination.totalSessions, 15);
  assert.equal(first.sessions.length, 13);
  assert.ok(first.sessions.some((row: { sessionId: string }) => row.sessionId === 'child-14'));
  assert.ok(!first.sessions.some((row: { sessionId: string }) => row.sessionId === 'child-13'));
  const last = (await (await app.request(route + '&page=2')).json()).data;
  assert.deepEqual(last.sessions.map((row: { sessionId: string }) => row.sessionId), ['root-0', 'child-13']);
  const filtered = (await (await app.request(route + '&q=child-')).json()).data;
  assert.equal(filtered.pagination.totalRoots, 2, 'a matching child becomes a root when its parent is filtered out');
  const detail = (await (await app.request(`/functions/tud-session-detail?${scope}&source=codex&sessionId=root-0`)).json()).data.session;
  assert.equal(detail.insights.descendantCount, 1);
  assert.equal(detail.insights.combinedTokens, 24);
  assert.equal(detail.insights.relatedUsage[0].sessionId, 'child-13');
  const child = (await (await app.request(`/functions/tud-session-detail?${scope}&source=codex&sessionId=child-13`)).json()).data.session;
  assert.equal(child.insights.orphan, false);
});

test('on-demand details retain detected relationship conflicts even when only one cycle member is requested', async t => {
  const { app, dataDir } = await fixture(t);
  const inputs = [];
  for (const [sessionId, parent] of [['cycle-a', 'cycle-b'], ['cycle-b', 'cycle-a']]) {
    const path = join(dataDir, sessionId! + '.jsonl');
    await writeFile(path, [
      { type: 'session_meta', timestamp: '2026-10-16T03:00:00Z', payload: { id: sessionId, source: { subagent: { thread_spawn: { parent_thread_id: parent } } } } },
      { type: 'event_msg', timestamp: '2026-10-16T04:00:00Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 10, output_tokens: 2 } } } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    inputs.push({ path, sessionId: sessionId!, kind: 'jsonl' as const });
  }
  await syncSessionSource(dataDir, 'codex', { complete: true, inputs });
  const detail = (await (await app.request(`/functions/tud-session-detail?${scope}&source=codex&sessionId=cycle-a`)).json()).data.session;
  assert.equal(detail.insights.relationConflict, true);
  assert.equal(detail.insights.descendantCount, 0);
});

test('a bucket update during history loading cannot cache old totals under the new revision', async t => {
  const { dataDir, bucketStore } = await fixture(t);
  bucketStore.apply([{ source: 'claude', model: 'fixture', project: 'fixture', hour_start: '2026-10-16T04:00:00Z', input_tokens: 500, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 500, conversation_count: 1 }]);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let first = true;
  const queries = new SessionQueryService({ dataDir, bucketStore, getConfig: () => ({ statsSince: '2026-01-01T00:00:00Z' } as TudConfig) }, async (...args) => {
    const history = await readSessionHistory(...args);
    if (first) { first = false; entered(); await gate; }
    return history;
  });
  const query = { days: 7, bounds: { fromDate: '2026-10-16', toDate: '2026-10-16' } };
  const pending = queries.list(query, {});
  await started;
  bucketStore.apply([{ source: 'claude', model: 'fixture', project: 'fixture', hour_start: '2026-10-16T04:00:00Z', input_tokens: 1000, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 1000, conversation_count: 1 }]);
  release();
  await pending;
  assert.equal((await queries.list(query, {})).totalTokens, 1000);
});

test('on-demand details preserve all-source and explicitly scoped list denominators', async t => {
  const { app, bucketStore } = await fixture(t);
  bucketStore.apply(['claude', 'codex'].map(source => ({ source, model: 'fixture', project: 'fixture', hour_start: '2026-10-16T04:00:00Z', input_tokens: 1000, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 1000, conversation_count: 1 })));
  const all = (await (await app.request(`/functions/tud-session-list?${scope}&sort=tokens&direction=ascending`)).json()).data;
  assert.equal(all.sessions[0].sharePercent, 0.1);
  const detail = (await (await app.request(`/functions/tud-session-detail?${scope}&source=claude&sessionId=s00`)).json()).data.session;
  assert.equal(detail.sharePercent, 0.1);
  const scoped = (await (await app.request(`/functions/tud-session-detail?${scope}&sources=claude&source=claude&sessionId=s00`)).json()).data.session;
  assert.equal(scoped.sharePercent, 0.2);
});

test('fork details discard copied activity evidence exactly as the full-history API does', async t => {
  const { app, dataDir } = await fixture(t);
  const inputs = [];
  for (const sessionId of ['fork-parent', 'fork-child']) {
    const child = sessionId === 'fork-child', path = join(dataDir, sessionId + '.jsonl');
    await writeFile(path, [
      { type: 'session_meta', timestamp: '2026-10-16T03:00:00Z', payload: { id: sessionId, ...(child ? { forked_from_id: 'fork-parent' } : {}) } },
      { type: 'response_item', timestamp: '2026-10-16T04:00:00Z', payload: { type: 'function_call', name: 'functions.apply_patch', call_id: 'shared-call' } },
      ...(child ? [{ type: 'response_item', timestamp: '2026-10-16T04:01:00Z', payload: { type: 'function_call', name: 'functions.apply_patch', call_id: 'new-call' } }] : []),
      { type: 'event_msg', timestamp: '2026-10-16T04:02:00Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: child ? 20 : 10, output_tokens: 2 } } } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    inputs.push({ path, sessionId, kind: 'jsonl' as const });
  }
  await syncSessionSource(dataDir, 'codex', { complete: true, inputs });
  const full = (await (await app.request(`/functions/tud-session-activity?${scope}&sources=codex`)).json()).data.sessions.find((row: { sessionId: string }) => row.sessionId === 'fork-child');
  assert.equal(full.insights.signals.toolCalls, 1);
  const detail = (await (await app.request(`/functions/tud-session-detail?${scope}&source=codex&sessionId=fork-child`)).json()).data.session;
  assert.equal(detail.insights.signals.toolCalls, 1);
});
