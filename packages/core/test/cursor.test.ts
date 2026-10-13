import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  collectCursorSessionUserIds,
  parseCursorCsv,
  parseCursorIncremental,
  recordsToBuckets,
  resetCursorCookieCache,
} from '../src/parsers/cursor.js';

const SAMPLE_CSV = `Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
2026-07-09T10:15:00.000Z,Usage-based,claude-4-sonnet,No,1200,1000,500,800,3500,0.05
2026-07-09T10:45:00.000Z,Usage-based,gpt-4.1,No,300,200,100,150,750,0.01
`;

test('parseCursorCsv maps columns by header name', () => {
  const records = parseCursorCsv(SAMPLE_CSV);
  assert.equal(records.length, 2);
  assert.equal(records[0]!.model, 'claude-4-sonnet');
  assert.equal(records[0]!.inputTokens, 1000);
  assert.equal(records[0]!.cacheWriteTokens, 200);
  assert.equal(records[0]!.cacheReadTokens, 500);
  assert.equal(records[0]!.outputTokens, 800);
  assert.equal(records[0]!.costUsd, 0.05);
});

test('parseCursorIncremental skips the remote fetch when lastSyncAt is fresh', async () => {
  const cursors = {
    cursor: { lastSyncAt: new Date().toISOString(), lastError: null },
  };
  const { result } = await parseCursorIncremental(cursors, '2026-01-01T00:00:00.000Z', {
    minFetchIntervalMs: 5 * 60_000,
  });
  assert.equal(result.skipped, true);
  assert.match(result.error ?? '', /节流/);
  // Throttling is not a failure: lastError must stay untouched.
  assert.equal(cursors.cursor.lastError, null);
});

test('parseCursorIncremental treats a response-body timeout as a skipped sync', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'quotern-cursor-timeout-'));
  const stateDbPath = join(tempDir, 'state.vscdb');
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'auth0|user_timeout' })).toString('base64url');
  const accessToken = `${header}.${payload}.sig`;
  const stateDb = new DatabaseSync(stateDbPath);
  stateDb.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');
  stateDb.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('cursorAuth/accessToken', accessToken);
  stateDb.close();

  const originalCursorStateDbPath = process.env.CURSOR_STATE_DB_PATH;
  const originalCursorFetchTimeoutMs = process.env.QUOTERN_CURSOR_FETCH_TIMEOUT_MS;
  const originalFetch = globalThis.fetch;
  const originalAbortSignalTimeout = AbortSignal.timeout;

  try {
    process.env.CURSOR_STATE_DB_PATH = stateDbPath;
    delete process.env.QUOTERN_CURSOR_FETCH_TIMEOUT_MS;
    resetCursorCookieCache();

    let observedTimeoutMs = 0;
    Object.defineProperty(AbortSignal, 'timeout', {
      configurable: true,
      value: (timeoutMs: number) => {
        observedTimeoutMs = timeoutMs;
        return new AbortController().signal;
      },
    });
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
          },
        }),
        { status: 200 },
      );

    const firstAttempt = await parseCursorIncremental({}, '2026-01-01T00:00:00.000Z');
    assert.equal(observedTimeoutMs, 180_000);
    assert.equal(firstAttempt.result.skipped, true);
    assert.match(firstAttempt.result.error ?? '', /timeout/);

    process.env.QUOTERN_CURSOR_FETCH_TIMEOUT_MS = '240000';
    const configuredAttempt = await parseCursorIncremental({}, '2026-01-01T00:00:00.000Z');
    assert.equal(observedTimeoutMs, 240_000);
    assert.equal(configuredAttempt.result.skipped, true);
    assert.match(configuredAttempt.result.error ?? '', /timeout/);
  } finally {
    if (originalCursorStateDbPath === undefined) delete process.env.CURSOR_STATE_DB_PATH;
    else process.env.CURSOR_STATE_DB_PATH = originalCursorStateDbPath;
    if (originalCursorFetchTimeoutMs === undefined) delete process.env.QUOTERN_CURSOR_FETCH_TIMEOUT_MS;
    else process.env.QUOTERN_CURSOR_FETCH_TIMEOUT_MS = originalCursorFetchTimeoutMs;
    globalThis.fetch = originalFetch;
    Object.defineProperty(AbortSignal, 'timeout', {
      configurable: true,
      value: originalAbortSignalTimeout,
    });
    resetCursorCookieCache();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('collectCursorSessionUserIds prefers the JWT subject over a stale CLI authId', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'auth0|user_live' })).toString('base64url');
  const jwt = `${header}.${payload}.sig`;
  assert.deepEqual(collectCursorSessionUserIds(jwt, 'auth0|user_stale'), [
    'user_live',
    'auth0|user_live',
    'user_stale',
    'auth0|user_stale',
  ]);
});

test('recordsToBuckets aggregates into half-hour UTC buckets', () => {
  const records = parseCursorCsv(SAMPLE_CSV);
  const buckets = recordsToBuckets(records, '2026-01-01T00:00:00.000Z');
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0]!.source, 'cursor');
  assert.equal(buckets[0]!.project, 'unknown');
  assert.equal(buckets[0]!.hour_start, '2026-07-09T10:00:00.000Z');
  assert.equal(buckets[1]!.hour_start, '2026-07-09T10:30:00.000Z');
  assert.equal(buckets[0]!.cache_creation_input_tokens, 200);
  assert.equal(buckets[0]!.cached_input_tokens, 500);
  assert.equal(buckets[0]!.reported_cost_usd, 0.05);
  assert.equal(buckets[1]!.reported_cost_usd, 0.01);
});

function writeEmptyCursorStateDb(dir: string): string {
  const stateDbPath = join(dir, 'User', 'globalStorage', 'state.vscdb');
  mkdirSync(join(dir, 'User', 'globalStorage'), { recursive: true });
  const stateDb = new DatabaseSync(stateDbPath);
  stateDb.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');
  stateDb.close();
  return stateDbPath;
}

test('parseCursorIncremental skips cursor.com when Cursor is not logged in', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'quotern-cursor-logout-'));
  const stateDbPath = writeEmptyCursorStateDb(appDir);
  const originalState = process.env.CURSOR_STATE_DB_PATH;
  const originalFetch = globalThis.fetch;
  let fetched = false;
  try {
    process.env.CURSOR_STATE_DB_PATH = stateDbPath;
    globalThis.fetch = async () => {
      fetched = true;
      return new Response('nope', { status: 500 });
    };
    const { result } = await parseCursorIncremental({}, '2026-01-01T00:00:00.000Z');
    assert.equal(result.skipped, true);
    assert.equal(result.error, 'Cursor 未登录');
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalState === undefined) delete process.env.CURSOR_STATE_DB_PATH;
    else process.env.CURSOR_STATE_DB_PATH = originalState;
    rmSync(appDir, { recursive: true, force: true });
  }
});

