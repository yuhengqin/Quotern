import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  parseWarpIncremental,
  parseWarpTimestamp,
  warpDbPaths,
  warpModelTokens,
} from '../src/parsers/warp.js';
import { isSyncSourcePresent } from '../src/sync/source-presence.js';

const SINCE = '2020-01-01T00:00:00.000Z';

function conversationData(tokens: number, model = 'claude 4.5 sonnet'): string {
  return JSON.stringify({
    conversation_usage_metadata: {
      token_usage: [{ model_id: model, warp_tokens: tokens, byok_tokens: 0 }],
    },
  });
}

test('parseWarpTimestamp treats naive datetimes as UTC', () => {
  assert.equal(parseWarpTimestamp('2026-05-02 09:24:36'), '2026-05-02T09:24:36.000Z');
  const ms = Date.parse('2026-05-02T09:24:36.000Z');
  assert.equal(parseWarpTimestamp(ms), '2026-05-02T09:24:36.000Z');
});

test('warpModelTokens sums warp and byok tokens', () => {
  assert.deepEqual(
    warpModelTokens({ model_id: 'gpt-5', warp_tokens: 10, byok_tokens: 5 }),
    { model: 'gpt-5', tokens: 15 },
  );
  assert.equal(warpModelTokens({ model_id: 'gpt-5', warp_tokens: 0, byok_tokens: 0 }), null);
});

test('parseWarpIncremental emits conversation deltas from sqlite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-warp-'));
  const dbPath = join(dir, 'warp.sqlite');
  const prev = process.env.AI_USAGE_WARP_DB;
  process.env.AI_USAGE_WARP_DB = dbPath;
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE agent_conversations (
        conversation_id TEXT,
        conversation_data TEXT,
        last_modified_at TEXT
      );
      CREATE TABLE ai_queries (
        conversation_id TEXT,
        start_ts TEXT,
        working_directory TEXT
      );
    `);
    db.exec(`
      INSERT INTO agent_conversations (conversation_id, conversation_data, last_modified_at)
      VALUES ('conv-1', '${conversationData(100).replace(/'/g, "''")}', '2026-05-02 09:24:36');
      INSERT INTO ai_queries (conversation_id, start_ts, working_directory)
      VALUES ('conv-1', '2026-05-02 09:20:00', '/Users/dev/my-app');
    `);
    db.close();

    const cursors = {};
    const first = await parseWarpIncremental(cursors, SINCE);
    assert.equal(first.result.eventsParsed, 1);
    assert.equal(first.result.buckets.length, 1);
    assert.equal(first.result.buckets[0]?.source, 'warp');
    assert.equal(first.result.buckets[0]?.collector, 'warp');
    assert.equal(first.result.buckets[0]?.model, 'claude 4.5 sonnet');
    assert.equal(first.result.buckets[0]?.input_tokens, 100);
    assert.equal(first.result.buckets[0]?.output_tokens, 0);
    assert.equal(first.result.buckets[0]?.total_tokens, 100);
    assert.equal(first.result.buckets[0]?.project, 'my-app');
    assert.equal(first.result.buckets[0]?.conversation_count, 1);

    const db2 = new DatabaseSync(dbPath);
    db2.exec(`
      UPDATE agent_conversations
      SET conversation_data = '${conversationData(250).replace(/'/g, "''")}',
          last_modified_at = '2026-05-02 10:00:00'
      WHERE conversation_id = 'conv-1';
    `);
    db2.close();

    (cursors as { warp?: { dbMtimes?: Record<string, number> } }).warp!.dbMtimes = {};
    const second = await parseWarpIncremental(cursors, SINCE);
    assert.equal(second.result.eventsParsed, 1);
    assert.equal(second.result.buckets[0]?.input_tokens, 150);
    assert.equal(second.result.buckets[0]?.conversation_count, 0);
  } finally {
    if (prev === undefined) delete process.env.AI_USAGE_WARP_DB;
    else process.env.AI_USAGE_WARP_DB = prev;
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseWarpIncremental skips databases without agent_conversations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-warp-empty-'));
  const dbPath = join(dir, 'warp.sqlite');
  const prev = process.env.AI_USAGE_WARP_DB;
  process.env.AI_USAGE_WARP_DB = dbPath;
  try {
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE unrelated (id INTEGER);');
    db.close();
    const { result } = await parseWarpIncremental({}, SINCE);
    assert.equal(result.eventsParsed, 0);
    assert.equal(result.buckets.length, 0);
  } finally {
    if (prev === undefined) delete process.env.AI_USAGE_WARP_DB;
    else process.env.AI_USAGE_WARP_DB = prev;
    await rm(dir, { recursive: true, force: true });
  }
});

test('isSyncSourcePresent skips warp when the sqlite file is missing', () => {
  const prev = process.env.AI_USAGE_WARP_DB;
  process.env.AI_USAGE_WARP_DB = join(tmpdir(), 'missing-warp-db.sqlite');
  try {
    assert.equal(isSyncSourcePresent('warp'), false);
    assert.ok(warpDbPaths()[0]?.endsWith('missing-warp-db.sqlite'));
  } finally {
    if (prev === undefined) delete process.env.AI_USAGE_WARP_DB;
    else process.env.AI_USAGE_WARP_DB = prev;
  }
});
