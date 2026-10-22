import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, rename, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as core from '../src/index.js';
import { AchievementStore } from '../src/achievements/store.js';
import { buildAchievementFacts } from '../src/achievements/facts.js';
import { aggregateSessionMetrics } from '../src/session-metrics.js';
import type { QueueBucket } from '../src/types.js';

// Resolve through the public entry so the pre-implementation run fails an assertion.
const api = core as unknown as { exportDemoSnapshot?: (source: string, file: string, options?: { now?: Date }) => Promise<any>; loadDemoSnapshot?: (file: string) => Promise<any> };
const now = new Date('2026-10-22T09:00:00.000Z');
const bucket: QueueBucket = { source: 'codex', model: 'gpt-6.1-sol', project: 'PRIVATE_PROJECT', hour_start: '2026-10-22T08:00:00.000Z', input_tokens: 100, output_tokens: 20, cached_input_tokens: 30, cache_creation_input_tokens: 0, reasoning_output_tokens: 2, total_tokens: 152, conversation_count: 1, token_quality: 'recorded', local_metrics: { version: 1, requestCount: 1, requestCountComplete: true, cacheReadComplete: true, cacheWriteComplete: false, missingReasons: ['missing_fields'] } };

async function contents(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isDirectory()) for (const [name, value] of Object.entries(await contents(join(dir, item.name)))) result[`${item.name}/${name}`] = value;
    else result[item.name] = await readFile(join(dir, item.name), 'utf8');
  }
  return result;
}
async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'quotern-demo-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'source'); await mkdir(join(dir, 'queue'), { recursive: true }); await mkdir(join(dir, 'sessions'));
  await writeFile(join(dir, 'config.json'), JSON.stringify({ statsSince: '2026-10-01T00:00:00Z', deviceId: 'PRIVATE_DEVICE', pricing: { url: 'https://PRIVATE_TOKEN@example.test' } }));
  await writeFile(join(dir, 'queue', '2026-10.jsonl'), JSON.stringify({ ...bucket, token: 'PRIVATE_UNKNOWN', local_metrics: { ...bucket.local_metrics, prompt: 'PRIVATE_NESTED' } }) + '\n');
  const sessionId = 'PRIVATE_SESSION', projectId = 'a'.repeat(64), turnId = '11111111-2222-4333-8444-555555555555';
  const messages = Object.fromEntries(['user', 'assistant'].map((role, i) => [role, { source: 'codex', sessionId, id: `PRIVATE_MSG_${i}`, role, timestamp: `2026-10-22T08:0${i}:00Z`, projectId, projectLabel: bucket.project, prompt: 'PRIVATE_PROMPT' }]));
  const timings = { start: { source: 'codex', sessionId, id: 'PRIVATE_START', kind: 'task-start', timestamp: '2026-10-22T08:00:00Z', turnId }, end: { source: 'codex', sessionId, id: 'PRIVATE_END', kind: 'task-end', timestamp: '2026-10-22T08:01:00Z', turnId, durationMs: 60000 } };
  const observations = { request: { source: 'codex', sessionId, id: 'PRIVATE_REQUEST', timestamp: '2026-10-22T08:01:00Z', model: bucket.model, tokens: 152, usageKnown: true, costUsd: null, costKind: 'unknown', billing: { service: 'openai', mode: 'unknown', accountRef: 'PRIVATE_ACCOUNT', accountLabel: 'PRIVATE_LABEL', cookie: 'PRIVATE_COOKIE', evidence: 'unknown' }, context: { usedTokens: 100, limitTokens: 1000, kind: 'recorded', observedAt: '2026-10-22T08:01:00Z', apiKey: 'PRIVATE_KEY' }, projectLabel: bucket.project, tokenParts: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 30, cache_creation_input_tokens: 0, reasoning_output_tokens: 2, prompt: 'PRIVATE_PART' } } };
  await writeFile(join(dir, 'sessions', 'codex.json'), JSON.stringify({ version: 10, source: 'codex', complete: true, files: { 'C:\\PRIVATE_PATH\\rollout.jsonl': { complete: true, size: 1, mtimeMs: 1, ino: 1, offset: 1, guard: 'PRIVATE_GUARD', context: { sessionId, observationAccount: 'PRIVATE_ACCOUNT' }, messages, timings, observations, titles: { [sessionId]: { title: 'PRIVATE_TITLE', priority: 2, unknown: 'PRIVATE_TITLE_EXTRA' } } } } }));
  await writeFile(join(dir, 'cursors.json'), JSON.stringify({ content: 'PRIVATE_CURSOR' }));
  return { root, dir, file: join(root, 'demo.json') };
}

test('demo export strips nested private data, preserves usage, clocks and evidence, and never writes the source', async t => {
  assert.equal(typeof api.exportDemoSnapshot, 'function');
  const { dir, file } = await fixture(t), before = await contents(dir);
  const result = await api.exportDemoSnapshot!(dir, file, { now });
  assert.deepEqual(await contents(dir), before);
  const raw = await readFile(file, 'utf8'); assert.equal(raw.includes('PRIVATE_'), false); assert.equal(raw.includes('a'.repeat(64)), false);
  assert.equal(result.schemaVersion, 1); assert.equal(result.exportedAt, now.toISOString());
  assert.equal(result.buckets[0].total_tokens, 152); assert.equal(result.buckets[0].token_quality, 'recorded');
  assert.equal(result.buckets[0].local_metrics.cacheWriteComplete, false);
  assert.equal(result.history.observations[0].costUsd, null); assert.equal(result.history.observations[0].billing.mode, 'unknown');
  assert.equal(result.history.messages[0].projectLabel, result.buckets[0].project);
  assert.match(result.history.timingEvents[0].turnId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(aggregateSessionMetrics(result.history.messages, { timingEvents: result.history.timingEvents }).taskSeconds, 60);
  assert.equal(result.history.titles.length, 1); assert.equal(result.achievements.summary.totalTokens, 152);
  assert.deepEqual(await api.loadDemoSnapshot!(file), result);
});

test('demo exports are unlinkable and refuse existing or overlapping outputs without modifying data', async t => {
  assert.equal(typeof api.exportDemoSnapshot, 'function');
  const { dir, root, file } = await fixture(t), before = await contents(dir);
  const one = await api.exportDemoSnapshot!(dir, file, { now });
  const two = await api.exportDemoSnapshot!(dir, join(root, 'other.json'), { now });
  assert.notEqual(one.history.messages[0].sessionId, two.history.messages[0].sessionId);
  await assert.rejects(api.exportDemoSnapshot!(dir, file, { now }), /exist|已存在/i);
  await assert.rejects(api.exportDemoSnapshot!(dir, join(dir, 'new-demo.json'), { now }), /overlap|重叠|数据目录/i);
  assert.deepEqual(await contents(dir), before);
});

test('demo loader rejects incompatible and malformed data instead of falling back to normal data', async t => {
  assert.equal(typeof api.loadDemoSnapshot, 'function');
  const { file } = await fixture(t);
  for (const value of [{ schemaVersion: 99 }, { schemaVersion: 1, buckets: [{ source: 'codex', input_tokens: -2 }] }, { schemaVersion: 1, exportedAt: 'bad' }]) {
    await writeFile(file, JSON.stringify(value)); await assert.rejects(api.loadDemoSnapshot!(file), /演示|snapshot/i);
  }
});

test('demo export refuses symlinked data directories and output aliases into the source', async t => {
  const { root, dir, file } = await fixture(t);
  const alias = join(root, 'alias'); await symlink(dir, alias, 'junction');
  await assert.rejects(api.exportDemoSnapshot!(dir, join(alias, 'new.json'), { now }), /重叠/);
  await rename(join(dir, 'queue'), join(root, 'external-queue')); await symlink(join(root, 'external-queue'), join(dir, 'queue'), 'junction');
  await assert.rejects(api.exportDemoSnapshot!(dir, file, { now }), /链接|普通/);
});

test('ordinary dot-prefixed child names cannot bypass source-directory isolation', async t => {
  const { dir } = await fixture(t), before = await contents(dir);
  for (const name of ['..demo.json', '..exports/demo.json']) await assert.rejects(api.exportDemoSnapshot!(dir, join(dir, name), { now }), /重叠/);
  assert.deepEqual(await contents(dir), before);
});

test('exported pricing preserves overlay alias and fuzzy precedence over builtin exact prices', async t => {
  t.after(() => { const reset = (core as any).applyPricingSnapshot; if (reset) reset(null); else core.applyRemotePricingOverlay(null); });
  for (const match of ['alias', 'fuzzy']) {
    const { dir, file } = await fixture(t);
    const row = { ...bucket, model: 'openai/gpt-6.1-sol', input_tokens: 1_000_000, output_tokens: 0, cached_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 1_000_000 };
    await writeFile(join(dir, 'queue', '2026-10.jsonl'), JSON.stringify(row) + '\n');
    await writeFile(join(dir, 'pricing-overlay.json'), JSON.stringify({ exact: { custom: { input: 100 } }, ...(match === 'alias' ? { alias: { 'openai/gpt-6.1-sol': 'custom' } } : { fuzzy: [{ match: 'gpt-6.1-sol', ref: 'custom' }] }) }));
    const result = await api.exportDemoSnapshot!(dir, file, { now });
    assert.equal(core.computeRowCost(row), 100);
    const apply = (core as any).applyPricingSnapshot;
    assert.equal(typeof apply, 'function'); apply(result.pricing);
    assert.equal(core.computeRowCost(result.buckets[0]), 100, match);
  }
});

test('readOnly achievement snapshot preserves normal projection without creating a directory or lock', async t => {
  const { dir } = await fixture(t), before = await contents(dir);
  const facts = buildAchievementFacts([bucket], [], [], now);
  const store = new AchievementStore(dir, async () => facts) as AchievementStore & { readOnly?: () => Promise<unknown> };
  assert.equal(typeof store.readOnly, 'function');
  const snapshot = await store.readOnly!();
  assert.deepEqual(await contents(dir), before);
  assert.deepEqual(snapshot, await store.read());
});
