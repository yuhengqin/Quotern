import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMuseIncremental, decodeMuseUsage } from '../src/parsers/muse.js';
import { createMuseSubscriptionReader } from '../src/quota/readers/muse-subscription.js';
import type { CursorsFile } from '../src/types.js';
import { syncAll } from '../src/sync/index.js';
import { loadBucketsForRange } from '../src/queue/index.js';
import { readSessionHistory } from '../src/session-collector.js';

const stamp = Date.parse('2026-10-30T10:00:00Z');
function event(id = 'run-1', review = false) {
  return { id, recorded_at: stamp * 1000, payload_type: 'runtime.session', payload: {
    kind: review ? 'approval' : 'run', event: { kind: review ? 'automated_review_completed' : 'model_completed',
      model: review ? { model_id: 'muse-spark-1.3-contributor' } : 'muse-spark-1.3',
      usage: { input_tokens: 100, output_tokens: 10, cache_read_tokens: 60, cache_write_tokens: 10 } } } };
}
test('Muse decodes independent review usage and rejects malformed counts', () => {
  const usage = decodeMuseUsage(event('review', true));
  assert.equal(usage?.tokens.input_tokens, 30);
  assert.equal(usage?.tokens.total_tokens, 110);
  assert.equal(usage?.model, 'muse-spark-1.3-contributor');
  for (const invalid of [-1, 2.5, '100', true, NaN]) {
    const value = event(); Object.assign(value.payload.event.usage, { input_tokens: invalid });
    assert.equal(decodeMuseUsage(value), null);
  }
  const invalid = event(); invalid.payload.event.usage.cache_read_tokens = 101;
  assert.equal(decodeMuseUsage(invalid), null);
});
test('Muse replay, partial tail, rewrite and late metadata preserve totals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-muse-'));
  const file = join(root, '2026', '10', '30', 'session-one', 'session.jsonl');
  await mkdir(join(root, '2026', '10', '30', 'session-one'), { recursive: true });
  let cursors: CursorsFile = {};
  const run = event();
  const scan = async () => { const next = await parseMuseIncremental(cursors, '2026-10-01', root); cursors = next.cursors; return next.result; };
  try {
    await writeFile(file, JSON.stringify(run) + '\n' + JSON.stringify({ children: [{ record_json: JSON.stringify(run) }] }) + '\n');
    assert.equal((await scan()).buckets.reduce((sum, row) => sum + row.total_tokens, 0), 110);
    assert.equal((await scan()).buckets.length, 0);
    await appendFile(file, JSON.stringify(event('next')).slice(0, -2));
    assert.equal((await scan()).buckets.length, 0);
    await appendFile(file, '}}\n');
    assert.equal((await scan()).buckets.reduce((sum, row) => sum + row.total_tokens, 0), 110);
    await appendFile(file, JSON.stringify({ payload_type: 'runtime.session.metadata', payload: { record: { workspace_root: join(root, 'project') } } }) + '\n');
    const moved = (await scan()).buckets;
    assert.equal(moved.reduce((sum, row) => sum + row.total_tokens, 0), 0);
    assert.equal(moved.find(row => row.project === 'unknown')?.total_tokens, -220);
    assert.equal(moved.find(row => row.project !== 'unknown')?.total_tokens, 220);
    await writeFile(file, JSON.stringify(run) + '\n');
    assert.equal((await scan()).buckets.reduce((sum, row) => sum + row.total_tokens, 0), -110);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('Muse quota is read-only, preserves observation age and never falls back to exec', async () => {
  const calls: readonly string[][] = [];
  const read = createMuseSubscriptionReader({ execute: async args => {
    (calls as string[][]).push([...args]);
    return { code: 0, stdout: JSON.stringify({ tier: 'pro', allowance: { asOfMs: stamp, window: { usedPercent: 25, resetsAtMs: stamp + 18000000 }, weekly: { usedPercent: 75, resetsAtMs: stamp + 604800000 } } }) };
  }, now: () => stamp + 1000 });
  const result = await read();
  assert.equal(result.fetchedAt, stamp / 1000);
  assert.equal(result.fiveHour?.usedPercent, 25);
  assert.equal(result.weekly?.resetsAt, stamp / 1000 + 604800);
  assert.deepEqual(calls, [['usage', '--json']]);
  const empty = await createMuseSubscriptionReader({ execute: async () => ({ code: 0, stdout: '{}' }) })();
  assert.equal(empty.status, 'temporarily-unavailable');
  assert.equal(empty.fetchedAt, null);
  assert.equal(empty.fiveHour, null);
  const failure = await createMuseSubscriptionReader({ execute: async () => { throw new Error('missing'); } })();
  assert.equal(failure.status, 'temporarily-unavailable');
});
test('Muse sync queue and session projection agree after late project attribution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-muse-sync-'));
  const source = join(root, 'journals'), directory = join(source, '2026', '10', '30', 'one'), data = join(root, 'data');
  const previous = process.env.MUSE_SESSIONS_DIR;
  process.env.MUSE_SESSIONS_DIR = source;
  await mkdir(directory, { recursive: true });
  await mkdir(data, { recursive: true });
  const file = join(directory, 'session.jsonl');
  const config = { deviceId: 'test', hostname: 'test', dataDir: data, statsSince: '2026-01-01T00:00:00Z', localRetentionDays: 3650 };
  try {
    await writeFile(file, JSON.stringify(event()) + '\n');
    await syncAll(data, config, 'muse');
    await appendFile(file, JSON.stringify({ children: [{ record_json: JSON.stringify(event()) }], payload_type: 'runtime.session.metadata', payload: { record: { workspace_root: join(root, 'demo-project') } } }) + '\n');
    await syncAll(data, config, 'muse');
    const replay = join(source, '2026', '10', '30', 'two');
    await mkdir(replay, { recursive: true });
    await writeFile(join(replay, 'session.jsonl'), JSON.stringify({ payload_type: 'runtime.session.metadata', payload: { record: { workspace_root: join(root, 'replayed-project') } }, children: [{ record_json: JSON.stringify(event()) }] }) + '\n');
    await syncAll(data, config, 'muse');
    const rows = await loadBucketsForRange(data, '2026-01-01');
    assert.equal(rows.reduce((sum, row) => sum + row.total_tokens, 0), 110);
    assert.equal(rows.find(row => row.total_tokens > 0)?.project, 'demo-project');
    const history = await readSessionHistory(data, ['muse']);
    assert.equal(history.observations.length, 1);
    assert.equal(history.observations[0]?.tokens, 110);
    assert.equal(history.observations[0]?.projectLabel, 'demo-project');
    assert.equal(history.observations[0]?.sessionId, 'one');
    assert.equal(history.messages.length, 0);
  } finally {
    if (previous === undefined) delete process.env.MUSE_SESSIONS_DIR; else process.env.MUSE_SESSIONS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
