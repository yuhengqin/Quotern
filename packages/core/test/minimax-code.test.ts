import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseMiniMaxCodeIncremental } from '../src/parsers/minimax-code.js';
import { normalizeSyncSource } from '../src/sync/index.js';
import { isolateAgentHome } from './platform-fixtures.js';

const SINCE = '2026-01-01T00:00:00.000Z';

test('MiniMax Code reads shared mcode/desktop usage projection incrementally', async () => {
  const home = await mkdtemp(join(tmpdir(), 'minimax-code-'));
  const restore = isolateAgentHome(home);
  try {
    const dbDir = join(home, '.minimax', 'v2', 'sqlite');
    await mkdir(dbDir, { recursive: true });
    const db = new DatabaseSync(join(dbDir, 'runtime-state.sqlite'));
    try {
      db.exec(`CREATE TABLE local_runtime_sessions (session_id TEXT PRIMARY KEY, workspace_dir TEXT, project_workspace_dir TEXT);
        CREATE TABLE local_runtime_token_usage (id INTEGER PRIMARY KEY, session_id TEXT, model TEXT, ts INTEGER,
        input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER);`);
      db.exec(`INSERT INTO local_runtime_sessions VALUES ('s1', '/work/alpha', '/work/alpha');
        INSERT INTO local_runtime_token_usage VALUES (1, 's1', 'minimax/MiniMax-M3', 1785578161917, 100, 20, 3, 40, 5);`);
      const first = await parseMiniMaxCodeIncremental({}, SINCE);
      assert.equal(first.result.eventsParsed, 1);
      assert.deepEqual(first.result.buckets.map((row) => ({ source: row.source, model: row.model, project: row.project, total: row.total_tokens, collector: row.collector })),
        [{ source: 'minimax-code', model: 'minimax/MiniMax-M3', project: 'alpha', total: 168, collector: 'minimax-code' }]);
      assert.equal((await parseMiniMaxCodeIncremental(first.cursors, SINCE)).result.eventsParsed, 0);

      db.exec(`INSERT INTO local_runtime_token_usage VALUES (2, 's1', 'deepseek/deepseek-v4', 1785578162917, 11, 7, 0, 2, 0);`);
      const next = await parseMiniMaxCodeIncremental(first.cursors, SINCE);
      assert.equal(next.result.eventsParsed, 1);
      assert.equal(next.result.buckets[0]?.model, 'deepseek/deepseek-v4');
      assert.equal(next.result.buckets[0]?.total_tokens, 20);
      assert.equal(normalizeSyncSource('mcode'), 'minimax-code');
    } finally {
      db.close();
    }
  } finally {
    restore();
    await rm(home, { recursive: true, force: true });
  }
});

test('MiniMax Code backfills jsonl model when sqlite model is null without double counting', async () => {
  const home = await mkdtemp(join(tmpdir(), 'minimax-code-'));
  const restore = isolateAgentHome(home);
  try {
    const relativeDir = '2026/10/03/session-alpha';
    const sessionDir = join(home, '.minimax', 'v2', 'sessions', ...relativeDir.split('/'));
    await mkdir(sessionDir, { recursive: true });
    await mkdir(join(home, '.minimax', 'v2', 'sqlite'), { recursive: true });
    await writeFile(
      join(sessionDir, 'messages.jsonl'),
      `${JSON.stringify({
        message_id: 'm1',
        turn_id: 'turn_1',
        message: {
          role: 'assistant',
          model: 'deepseek-v4.1-flash',
          timestamp: 1785578161917,
          usage: { input: 14678, output: 44, cacheRead: 0, cacheWrite: 0 },
        },
      })}\n`,
    );
    const db = new DatabaseSync(join(home, '.minimax', 'v2', 'sqlite', 'runtime-state.sqlite'));
    try {
      db.exec(`CREATE TABLE local_runtime_sessions (
        session_id TEXT PRIMARY KEY, workspace_dir TEXT, project_workspace_dir TEXT, history_relative_dir TEXT);
        CREATE TABLE local_runtime_token_usage (
        id INTEGER PRIMARY KEY, session_id TEXT, model TEXT, ts INTEGER, turn_id TEXT,
        input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
        cache_read_tokens INTEGER, cache_write_tokens INTEGER);`);
      db.exec(`INSERT INTO local_runtime_sessions VALUES ('s1', '/work/flash-card-demos', '/work/flash-card-demos', '${relativeDir}');
        INSERT INTO local_runtime_token_usage VALUES (1, 's1', NULL, 1785578161917, 'turn_1', 14678, 44, 0, 0, 0);`);
      const first = await parseMiniMaxCodeIncremental({}, SINCE);
      assert.equal(first.result.eventsParsed, 1);
      assert.equal(first.result.buckets.length, 1);
      assert.equal(first.result.buckets[0]?.model, 'deepseek-v4.1-flash');
      assert.equal(first.result.buckets[0]?.project, 'flash-card-demos');
      assert.equal(first.result.buckets[0]?.total_tokens, 14722);
      assert.equal((await parseMiniMaxCodeIncremental(first.cursors, SINCE)).result.eventsParsed, 0);
    } finally {
      db.close();
    }
  } finally {
    restore();
    await rm(home, { recursive: true, force: true });
  }
});

test('MiniMax Code falls back to legacy message usage without a projection table', async () => {
  const home = await mkdtemp(join(tmpdir(), 'minimax-code-'));
  const restore = isolateAgentHome(home);
  try {
    const sessionDir = join(home, '.minimax', 'v2', 'sessions', '2026', '08', '19', 'session-1');
    await mkdir(sessionDir, { recursive: true });
    const file = join(sessionDir, 'messages.jsonl');
    const firstMessage = JSON.stringify({ message_id: 'm1', message: { role: 'assistant', model: 'MiniMax-M3', timestamp: '2026-08-19T01:00:00.000Z', usage: { input: 10, output: 4, cacheRead: 6 } } });
    await writeFile(file, `${firstMessage}\n${firstMessage}\n`);
    const first = await parseMiniMaxCodeIncremental({}, SINCE);
    assert.equal(first.result.eventsParsed, 1);
    assert.equal(first.result.buckets[0]?.total_tokens, 20);
    assert.equal((await parseMiniMaxCodeIncremental(first.cursors, SINCE)).result.eventsParsed, 0);
    await appendFile(file, JSON.stringify({ message_id: 'm2', message: { role: 'assistant', model: 'MiniMax-M3', timestamp: '2026-08-19T01:01:00.000Z', usage: { input: 5, output: 2 } } }) + '\n');
    const next = await parseMiniMaxCodeIncremental(first.cursors, SINCE);
    assert.equal(next.result.eventsParsed, 1);
    assert.equal(next.result.buckets[0]?.total_tokens, 7);
  } finally {
    restore();
    await rm(home, { recursive: true, force: true });
  }
});
