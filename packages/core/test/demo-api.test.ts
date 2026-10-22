import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore } from '../src/server/state.js';
import { createHttpServer, listenServer } from '../src/server/http-server.js';
import { evaluateAchievements } from '../src/achievements/evaluate.js';
import { buildAchievementFacts } from '../src/achievements/facts.js';
import type { TudConfig } from '../src/types.js';
import type { DemoSnapshot } from '../src/demo/types.js';

const referenceTime = '2020-01-05T12:00:00.000Z';
export function snapshot(): DemoSnapshot {
  const buckets = [{ hour_start: '2020-01-05T08:00:00Z', source: 'codex', model: 'gpt-6.1-sol', project: 'Project 1', input_tokens: 100, output_tokens: 2, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 102, conversation_count: 1 }];
  const facts = buildAchievementFacts(buckets, [], [], new Date(referenceTime));
  return { schemaVersion: 1, readOnly: true, referenceTime, exportedAt: referenceTime, collectSince: '2020-01-01T00:00:00Z', lastSyncAt: referenceTime, buckets, pricing: { builtin: { exact: {} }, overlay: null },
    history: { messages: [{ source: 'codex', sessionId: 'demo-session', id: 'message', role: 'user', timestamp: '2020-01-05T08:00:00Z' }], timingEvents: [], observations: [{ source: 'codex', sessionId: 'demo-session', id: 'request', timestamp: '2020-01-05T08:00:00Z', model: 'gpt-6.1-sol', tokens: 102, usageKnown: true, costUsd: null, costKind: 'unknown', billing: { service: 'unknown', mode: 'unknown', accountRef: null, evidence: 'unknown' } }], missingSources: [], codexParents: [], titles: [['["codex","demo-session"]', { title: 'Demo session 1', priority: 2 }]] },
    achievements: { ...evaluateAchievements(facts), earned: [], preferences: { showcaseIds: [], celebrationsEnabled: false }, unreadIds: [], coverage: { fromDate: '2020-01-05', asOfDate: '2020-01-05', timeZone: 'Asia/Shanghai', missingSessionSources: [], projectSources: [] } } };
}

test('demo read APIs freeze time and use only in-memory history/achievements without creating runtime files', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-demo-api-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const demo = snapshot(), bucketStore = new BucketStore(); bucketStore.apply(demo.buckets);
  const app = createLocalApiApp({ dataDir: join(dir, 'must-not-exist'), getConfig: () => ({ statsSince: demo.collectSince, localCollectSince: demo.collectSince, deviceId: 'demo', lastSyncAt: demo.lastSyncAt } as TudConfig), bucketStore, demo } as Parameters<typeof createLocalApiApp>[0]);
  for (const path of ['usage-summary', 'usage-daily?days=1', 'usage-hourly?days=1', 'usage-model-breakdown?days=1', 'usage-report?days=1', 'usage-trend?days=1', 'usage-sessions?days=1', 'session-activity?days=1', 'achievements', 'share-backgrounds', 'sync-status', 'config', 'pricing']) {
    const response = await app.request(`/functions/tud-${path}`);
    assert.equal(response.status, 200, path); const data = (await response.json()).data;
    if (path === 'usage-summary') assert.equal(data.todayTokens, 102);
    if (path.startsWith('usage-daily')) assert.equal(data.days[0]?.date, '2020-01-05');
    if (path.startsWith('usage-report')) assert.equal(data.summary.tokens, 102);
    if (path.startsWith('usage-sessions')) assert.equal(data.messageCount, 1);
    if (path.startsWith('session-activity')) assert.equal(data.sessions[0]?.sessionTitle, 'Demo session 1');
  }
  assert.deepEqual(await readdir(dir), []);
});

test('demo blocks every mutation before callbacks, including unknown paths and malformed bodies', async () => {
  let called = false;
  const demo = snapshot();
  const app = createLocalApiApp({ dataDir: 'must-not-read', getConfig: () => { called = true; throw new Error('must-not-read'); }, bucketStore: new BucketStore(), demo, runSyncViaRunner: async () => { called = true; return []; } } as Parameters<typeof createLocalApiApp>[0]);
  for (const path of ['trigger-sync', 'ensure-local-range', 'achievements', 'share-backgrounds', 'quota/refresh', 'quota/preferences', 'unknown']) for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await app.request(`/functions/tud-${path}`, { method, body: 'invalid' });
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.equal((await response.json()).message, 'DEMO_READ_ONLY');
  }
  assert.equal(called, false);
});

test('demo bootstrap is injected on SPA routes before scripts and escapes HTML delimiters', async t => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-demo-html-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'assets')); await writeFile(join(root, 'index.html'), '<html><head><script type="module" src="/assets/main.js"></script></head><body>app</body></html>');
  const demo = snapshot();
  const server = createHttpServer({ honoApp: createLocalApiApp({ dataDir: root, bucketStore: new BucketStore(), getConfig: () => ({} as TudConfig) }), staticDir: root, host: '127.0.0.1', demo: { ...demo, exportedAt: '</script><script>alert(1)</script>' } } as Parameters<typeof createHttpServer>[0]);
  const { port } = await listenServer(server, '127.0.0.1', 0); t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const html = await (await fetch(`http://127.0.0.1:${port}/sessions`)).text();
  assert.ok(html.indexOf('id="quotern-demo"') >= 0); assert.ok(html.indexOf('id="quotern-demo"') < html.indexOf('type="module"'));
  assert.equal(html.includes('<script>alert'), false);
});
