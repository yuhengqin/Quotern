import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { parseCodexIncremental } from '../src/parsers/codex.js';
import {
  CODEX_LEDGER_COLLECTOR,
  codexLedgerDbPaths,
  codexLedgerSchemaVersion,
  newestCodexLedgerPaths,
  readCodexLedgerThreads,
  reconcileCodexLedgerThread,
  type CodexLedgerThread,
} from '../src/parsers/codex-ledger.js';
import { codexHomeCandidates } from '../src/paths.js';
import { resetSqliteQueryCache } from '../src/parsers/sqlite.js';
import type { BucketAccumulator } from '../src/parsers/shared.js';
import type { CursorsFile, QueueBucket } from '../src/types.js';

const SINCE = '2026-01-01T00:00:00.000Z';

const CODEX_ENV_KEYS = ['HOME', 'USERPROFILE', 'CODEX_HOME', 'AI_USAGE_CODEX_HOME'] as const;

type CodexEnvSnapshot = Record<(typeof CODEX_ENV_KEYS)[number], string | undefined>;

function snapshotCodexEnv(): CodexEnvSnapshot {
  return {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    CODEX_HOME: process.env.CODEX_HOME,
    AI_USAGE_CODEX_HOME: process.env.AI_USAGE_CODEX_HOME,
  };
}

function restoreCodexEnv(snapshot: CodexEnvSnapshot): void {
  for (const key of CODEX_ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

/** Pin HOME + CODEX_HOME to a temp tree so discovery cannot see the developer's real Codex. */
async function withIsolatedCodexHome<T>(tempHome: string, fn: () => Promise<T>): Promise<T> {
  const snapshot = snapshotCodexEnv();
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.CODEX_HOME = join(tempHome, '.codex');
  delete process.env.AI_USAGE_CODEX_HOME;
  try {
    return await fn();
  } finally {
    restoreCodexEnv(snapshot);
  }
}

interface LedgerThreadFixture {
  id: string;
  rolloutPath: string;
  tokensUsed: number;
  model?: string;
  cwd?: string;
  recencyAtMs?: number;
  createdAtMs?: number;
  historyMode?: string;
}

function codexHome(tempHome: string): string {
  return join(tempHome, '.codex');
}

/** Build a ledger shaped like `~/.codex/state_5.sqlite`. */
async function createLedger(
  dbPath: string,
  threads: LedgerThreadFixture[],
  schema?: string,
): Promise<void> {
  await mkdir(join(dbPath, '..'), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(
    schema ??
      `CREATE TABLE threads (
         id TEXT PRIMARY KEY,
         rollout_path TEXT NOT NULL,
         tokens_used INTEGER NOT NULL DEFAULT 0,
         model TEXT,
         cwd TEXT NOT NULL DEFAULT '',
         recency_at_ms INTEGER NOT NULL DEFAULT 0,
         created_at_ms INTEGER,
         history_mode TEXT NOT NULL DEFAULT 'legacy'
       );`,
  );
  if (!schema && threads.length > 0) {
    const insert = db.prepare(
      `INSERT INTO threads
         (id, rollout_path, tokens_used, model, cwd, recency_at_ms, created_at_ms, history_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const thread of threads) {
      insert.run(
        thread.id,
        thread.rolloutPath,
        thread.tokensUsed,
        thread.model ?? '',
        thread.cwd ?? '',
        thread.recencyAtMs ?? 0,
        thread.createdAtMs ?? 0,
        thread.historyMode ?? 'legacy',
      );
    }
  }
  db.close();
  resetSqliteQueryCache();
}

function updateTokens(dbPath: string, id: string, tokensUsed: number): void {
  const db = new DatabaseSync(dbPath);
  db.prepare(`UPDATE threads SET tokens_used = ? WHERE id = ?`).run(tokensUsed, id);
  db.close();
  resetSqliteQueryCache();
}

function ledgerBuckets(buckets: QueueBucket[]): QueueBucket[] {
  return buckets.filter((bucket) => bucket.collector === CODEX_LEDGER_COLLECTOR);
}

function preciseBuckets(buckets: QueueBucket[]): QueueBucket[] {
  return buckets.filter((bucket) => bucket.collector !== CODEX_LEDGER_COLLECTOR);
}

function sumTokens(buckets: QueueBucket[]): number {
  return buckets.reduce((sum, bucket) => sum + bucket.total_tokens, 0);
}

function ledgerRolloutPath(tempHome: string, name: string): string {
  return join(codexHome(tempHome), 'sessions', '2026', '06', '09', name);
}

const ROLLOUT_NAME = 'rollout-2026-06-09T20-46-00-019d4c1b-d561-7881-bc6b-0af7ad075ae7.jsonl';

const ROLLOUT_JSONL = [
  '{"type":"session_meta","payload":{"id":"live-session","cwd":"/Users/dev/my-app"}}',
  '{"timestamp":"2026-06-09T20:46:30.000Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":50,"cached_input_tokens":0,"output_tokens":10,"reasoning_output_tokens":0,"total_tokens":60},"model":"gpt-5.6-sol"}}}',
].join('\n');

function tokenLine(opts: {
  timestamp: string;
  input: number;
  totalTokens?: number;
  cumulative?: number;
  model?: string;
}): string {
  const total = opts.totalTokens ?? opts.input;
  const info: Record<string, unknown> = {
    last_token_usage: {
      input_tokens: opts.input,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: total,
    },
    model: opts.model ?? 'gpt-5.6-sol',
  };
  if (opts.cumulative != null) {
    info.total_token_usage = {
      input_tokens: opts.cumulative,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: opts.cumulative,
    };
  }
  return JSON.stringify({
    timestamp: opts.timestamp,
    type: 'event_msg',
    payload: { type: 'token_count', info },
  });
}

test('readCodexLedgerThreads reads threads and ignores a database without one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-'));
  try {
    const dbPath = join(dir, 'state_5.sqlite');
    await createLedger(dbPath, [
      {
        id: 'thread-1',
        rolloutPath: '/tmp/rollout-a.jsonl',
        tokensUsed: 4321,
        model: 'gpt-5.6-sol',
        cwd: '/Users/dev/my-app',
        recencyAtMs: 1780000000000,
        createdAtMs: 1779000000000,
      },
      {
        id: '',
        rolloutPath: '/tmp/rollout-skipped.jsonl',
        tokensUsed: 1,
      },
    ]);
    assert.deepEqual(readCodexLedgerThreads(dbPath), [
      {
        id: 'thread-1',
        rolloutPath: '/tmp/rollout-a.jsonl',
        tokensUsed: 4321,
        model: 'gpt-5.6-sol',
        cwd: '/Users/dev/my-app',
        timestampMs: 1780000000000,
      },
    ]);

    const barePath = join(dir, 'state_4.sqlite');
    await createLedger(barePath, [], 'CREATE TABLE unrelated (id TEXT);');
    assert.deepEqual(readCodexLedgerThreads(barePath), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readCodexLedgerThreads tolerates a ledger missing optional columns', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-old-'));
  try {
    const dbPath = join(dir, 'state_5.sqlite');
    await createLedger(
      dbPath,
      [],
      `CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, tokens_used INTEGER);`,
    );
    const db = new DatabaseSync(dbPath);
    db.exec(`INSERT INTO threads (id, rollout_path, tokens_used) VALUES ('t1', '/tmp/x.jsonl', 99);`);
    db.close();
    resetSqliteQueryCache();

    assert.deepEqual(readCodexLedgerThreads(dbPath), [
      { id: 't1', rolloutPath: '/tmp/x.jsonl', tokensUsed: 99, model: '', cwd: '', timestampMs: 0 },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('codexLedgerDbPaths lists ledgers and skips their WAL companions', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-paths-'));
  try {
    const home = codexHome(tempHome);
    await mkdir(home, { recursive: true });
    for (const name of ['state_5.sqlite', 'state_5.sqlite-wal', 'state_5.sqlite-shm', 'state.sqlite']) {
      await writeFile(join(home, name), '');
    }
    await withIsolatedCodexHome(tempHome, async () => {
      const found = codexLedgerDbPaths().map((p) => p.slice(home.length + 1));
      assert.deepEqual(found, ['state.sqlite', 'state_5.sqlite']);
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('parseCodexIncremental recovers a thread whose rollout file is gone', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-fallback-'));
  try {
    const rolloutPath = ledgerRolloutPath(tempHome, ROLLOUT_NAME);
    await createLedger(join(codexHome(tempHome), 'state_5.sqlite'), [
      {
        id: 'vanished-thread',
        rolloutPath,
        tokensUsed: 9_876_543,
        model: 'gpt-5.6-terra',
        cwd: '/Users/dev/alipay-service',
        recencyAtMs: Date.parse('2026-06-09T20:47:00.000Z'),
      },
    ]);

    await withIsolatedCodexHome(tempHome, async () => {
      const { result } = await parseCodexIncremental({}, SINCE);
      assert.equal(result.eventsParsed, 1);
      assert.equal(result.filesProcessed, 1);
      assert.equal(result.buckets.length, 1);

      const bucket = result.buckets[0]!;
      assert.equal(bucket.source, 'codex');
      assert.equal(bucket.collector, CODEX_LEDGER_COLLECTOR);
      assert.equal(bucket.model, 'gpt-5.6-terra');
      assert.equal(bucket.project, 'alipay-service');
      assert.equal(bucket.hour_start, '2026-06-09T20:30:00.000Z');
      assert.equal(bucket.input_tokens, 9_876_543);
      assert.equal(bucket.output_tokens, 0);
      assert.equal(bucket.cached_input_tokens, 0);
      assert.equal(bucket.total_tokens, 9_876_543);
      assert.equal(bucket.conversation_count, 1);
      assert.equal(bucket.local_metrics, undefined);
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('parseCodexIncremental reports a vanished rollout once, then stays incremental', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-once-'));
  try {
    const dbPath = join(codexHome(tempHome), 'state_5.sqlite');
    await createLedger(dbPath, [
      {
        id: 'growing-thread',
        rolloutPath: ledgerRolloutPath(tempHome, ROLLOUT_NAME),
        tokensUsed: 1_000,
        model: 'gpt-5.6-sol',
        cwd: '/Users/dev/my-app',
        recencyAtMs: Date.parse('2026-06-09T20:47:00.000Z'),
      },
    ]);

    await withIsolatedCodexHome(tempHome, async () => {
      const cursors: CursorsFile = {};
      const first = await parseCodexIncremental(cursors, SINCE);
      assert.equal(first.result.buckets[0]?.input_tokens, 1_000);
      assert.deepEqual(cursors.codex?.ledgerTotals, { 'growing-thread': { tokens: 1_000 } });

      delete cursors.codex!.dbMtimes;
      const second = await parseCodexIncremental(cursors, SINCE);
      assert.equal(second.result.eventsParsed, 0);
      assert.equal(second.result.buckets.length, 0);

      updateTokens(dbPath, 'growing-thread', 1_600);
      delete cursors.codex!.dbMtimes;
      const third = await parseCodexIncremental(cursors, SINCE);
      assert.equal(third.result.eventsParsed, 1);
      assert.equal(third.result.buckets[0]?.input_tokens, 600);
      assert.equal(third.result.buckets[0]?.conversation_count, 0);
      assert.deepEqual(cursors.codex?.ledgerTotals, { 'growing-thread': { tokens: 1_600 } });
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('parseCodexIncremental keeps precise rows when the rollout still exists and the ledger matches', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-present-'));
  try {
    const rolloutPath = ledgerRolloutPath(tempHome, ROLLOUT_NAME);
    await mkdir(join(rolloutPath, '..'), { recursive: true });
    await writeFile(rolloutPath, `${ROLLOUT_JSONL}\n`, 'utf8');
    await createLedger(join(codexHome(tempHome), 'state_5.sqlite'), [
      {
        id: 'live-thread',
        rolloutPath,
        tokensUsed: 60,
        model: 'gpt-5.6-sol',
        cwd: '/Users/dev/my-app',
        recencyAtMs: Date.parse('2026-06-09T20:46:30.000Z'),
      },
    ]);

    await withIsolatedCodexHome(tempHome, async () => {
      const cursors: CursorsFile = {};
      const { result } = await parseCodexIncremental(cursors, SINCE);
      assert.equal(result.eventsParsed, 1);
      assert.equal(result.buckets.length, 1);
      assert.equal(result.buckets[0]?.collector, undefined);
      assert.equal(result.buckets[0]?.input_tokens, 50);
      assert.equal(result.buckets[0]?.output_tokens, 10);
      assert.equal(ledgerBuckets(result.buckets).length, 0);
      assert.deepEqual(cursors.codex?.ledgerTotals, { 'live-thread': { tokens: 60 } });
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('parseCodexIncremental fills only the ledger tail the rollout file does not contain', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-tail-'));
  try {
    const rolloutPath = ledgerRolloutPath(tempHome, ROLLOUT_NAME);
    await mkdir(join(rolloutPath, '..'), { recursive: true });
    await writeFile(rolloutPath, `${ROLLOUT_JSONL}\n`, 'utf8');
    await createLedger(join(codexHome(tempHome), 'state_5.sqlite'), [
      {
        id: 'live-thread',
        rolloutPath,
        tokensUsed: 100,
        model: 'gpt-5.6-sol',
        cwd: '/Users/dev/my-app',
        recencyAtMs: Date.parse('2026-06-09T20:46:30.000Z'),
      },
    ]);

    await withIsolatedCodexHome(tempHome, async () => {
      const cursors: CursorsFile = {};
      const { result } = await parseCodexIncremental(cursors, SINCE);
      const precise = preciseBuckets(result.buckets);
      const ledger = ledgerBuckets(result.buckets);
      assert.equal(sumTokens(precise), 60);
      assert.equal(precise[0]?.input_tokens, 50);
      assert.equal(precise[0]?.output_tokens, 10);
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0]?.input_tokens, 40);
      assert.equal(ledger[0]?.local_metrics, undefined);
      assert.deepEqual(cursors.codex?.ledgerTotals, { 'live-thread': { tokens: 100 } });
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('parseCodexIncremental does not pour pre-window file tokens back into the ledger', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-window-file-'));
  try {
    const rolloutPath = ledgerRolloutPath(tempHome, ROLLOUT_NAME);
    await mkdir(join(rolloutPath, '..'), { recursive: true });
    const body = [
      '{"type":"session_meta","payload":{"id":"span-session","cwd":"/Users/dev/my-app"}}',
      tokenLine({
        timestamp: '2026-01-15T00:00:00.000Z',
        input: 8_000,
        cumulative: 8_000,
      }),
      tokenLine({
        timestamp: '2026-06-09T20:46:30.000Z',
        input: 2_000,
        cumulative: 10_000,
      }),
    ].join('\n');
    await writeFile(rolloutPath, `${body}\n`, 'utf8');
    const dbPath = join(codexHome(tempHome), 'state_5.sqlite');
    await createLedger(dbPath, [
      {
        id: 'span-thread',
        rolloutPath,
        tokensUsed: 9_940,
        model: 'gpt-5.6-sol',
        cwd: '/Users/dev/my-app',
        recencyAtMs: Date.parse('2026-06-09T20:46:30.000Z'),
      },
    ]);

    await withIsolatedCodexHome(tempHome, async () => {
      const cursors: CursorsFile = {};
      const first = await parseCodexIncremental(cursors, '2026-06-01T00:00:00.000Z');
      assert.equal(sumTokens(preciseBuckets(first.result.buckets)), 2_000);
      assert.equal(ledgerBuckets(first.result.buckets).length, 0);
      assert.deepEqual(cursors.codex?.ledgerTotals, { 'span-thread': { tokens: 10_000 } });

      updateTokens(dbPath, 'span-thread', 10_000);
      delete cursors.codex!.dbMtimes;
      const second = await parseCodexIncremental(cursors, '2026-06-01T00:00:00.000Z');
      assert.equal(second.result.buckets.length, 0);
      assert.deepEqual(cursors.codex?.ledgerTotals, { 'span-thread': { tokens: 10_000 } });
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('parseCodexIncremental does not re-add a rollout counted before it vanished', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-counted-'));
  try {
    const rolloutPath = ledgerRolloutPath(tempHome, ROLLOUT_NAME);
    const dbPath = join(codexHome(tempHome), 'state_5.sqlite');
    await mkdir(join(rolloutPath, '..'), { recursive: true });
    await writeFile(rolloutPath, `${ROLLOUT_JSONL}\n`, 'utf8');

    await withIsolatedCodexHome(tempHome, async () => {
      const cursors: CursorsFile = {};
      const before = await parseCodexIncremental(cursors, SINCE);
      assert.equal(before.result.buckets[0]?.input_tokens, 50);
      assert.equal(cursors.codex?.ledgerTotals, undefined);

      await unlink(rolloutPath);
      await createLedger(dbPath, [
        {
          id: 'counted-thread',
          rolloutPath,
          tokensUsed: 60,
          model: 'gpt-5.6-sol',
          cwd: '/Users/dev/my-app',
          recencyAtMs: Date.parse('2026-06-09T20:46:30.000Z'),
        },
      ]);

      const after = await parseCodexIncremental(cursors, SINCE);
      assert.equal(after.result.buckets.length, 0);
      assert.deepEqual(cursors.codex?.ledgerTotals, { 'counted-thread': { tokens: 60 } });
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('parseCodexIncremental seeds an existing file cursor without re-billing it', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-seed-'));
  try {
    const rolloutPath = ledgerRolloutPath(tempHome, ROLLOUT_NAME);
    await mkdir(join(rolloutPath, '..'), { recursive: true });
    await writeFile(rolloutPath, `${ROLLOUT_JSONL}\n`, 'utf8');
    const dbPath = join(codexHome(tempHome), 'state_5.sqlite');
    await createLedger(dbPath, [
      {
        id: 'seed-thread',
        rolloutPath,
        tokensUsed: 5_000,
        model: 'gpt-5.6-sol',
        cwd: '/Users/dev/my-app',
        recencyAtMs: Date.parse('2026-06-09T20:46:30.000Z'),
      },
    ]);
    const st = statSync(rolloutPath);

    await withIsolatedCodexHome(tempHome, async () => {
      const cursors: CursorsFile = {
        codex: {
          files: {
            [rolloutPath]: {
              inode: st.ino,
              offset: st.size,
              meta: {
                sessionId: 'live-session',
                forkedFromId: null,
                sessionProject: 'my-app',
                tokenCountRecords: 1,
                size: st.size,
              },
            },
          },
        },
      };
      const seeded = await parseCodexIncremental(cursors, SINCE);
      assert.equal(seeded.result.buckets.length, 0);
      assert.deepEqual(cursors.codex?.ledgerTotals, { 'seed-thread': { tokens: 5_000 } });

      await writeFile(
        rolloutPath,
        `${tokenLine({ timestamp: '2026-06-09T21:00:00.000Z', input: 200 })}\n`,
        { flag: 'a' },
      );
      updateTokens(dbPath, 'seed-thread', 5_300);
      delete cursors.codex!.dbMtimes;
      const grown = await parseCodexIncremental(cursors, SINCE);
      assert.equal(sumTokens(preciseBuckets(grown.result.buckets)), 200);
      assert.equal(ledgerBuckets(grown.result.buckets)[0]?.input_tokens, 100);
      assert.deepEqual(cursors.codex?.ledgerTotals, { 'seed-thread': { tokens: 5_300 } });
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('parseCodexIncremental keeps a JSONL lead from being billed again when the ledger catches up', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-lead-'));
  try {
    const rolloutPath = ledgerRolloutPath(tempHome, ROLLOUT_NAME);
    await mkdir(join(rolloutPath, '..'), { recursive: true });
    const lead = [
      '{"type":"session_meta","payload":{"id":"lead-session","cwd":"/Users/dev/my-app"}}',
      tokenLine({ timestamp: '2026-06-09T20:46:30.000Z', input: 1_000 }),
    ].join('\n');
    await writeFile(rolloutPath, `${lead}\n`, 'utf8');
    const dbPath = join(codexHome(tempHome), 'state_5.sqlite');
    await createLedger(dbPath, [
      {
        id: 'lead-thread',
        rolloutPath,
        tokensUsed: 994,
        model: 'gpt-5.6-sol',
        cwd: '/Users/dev/my-app',
        recencyAtMs: Date.parse('2026-06-09T20:46:30.000Z'),
      },
    ]);

    await withIsolatedCodexHome(tempHome, async () => {
      const cursors: CursorsFile = {};
      const first = await parseCodexIncremental(cursors, SINCE);
      assert.equal(ledgerBuckets(first.result.buckets).length, 0);
      assert.equal(sumTokens(preciseBuckets(first.result.buckets)), 1_000);
      assert.deepEqual(cursors.codex?.ledgerTotals, { 'lead-thread': { tokens: 1_000 } });

      updateTokens(dbPath, 'lead-thread', 1_000);
      delete cursors.codex!.dbMtimes;
      const caught = await parseCodexIncremental(cursors, SINCE);
      assert.equal(caught.result.buckets.length, 0);
      assert.deepEqual(cursors.codex?.ledgerTotals, { 'lead-thread': { tokens: 1_000 } });

      await writeFile(
        rolloutPath,
        `${tokenLine({ timestamp: '2026-06-09T21:10:00.000Z', input: 50 })}\n`,
        { flag: 'a' },
      );
      updateTokens(dbPath, 'lead-thread', 1_080);
      delete cursors.codex!.dbMtimes;
      const later = await parseCodexIncremental(cursors, SINCE);
      assert.equal(sumTokens(preciseBuckets(later.result.buckets)), 50);
      assert.equal(ledgerBuckets(later.result.buckets)[0]?.input_tokens, 30);
      assert.deepEqual(cursors.codex?.ledgerTotals, { 'lead-thread': { tokens: 1_080 } });
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('parseCodexIncremental advances the watermark when the ledger file is unchanged', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-mtime-'));
  try {
    const rolloutPath = ledgerRolloutPath(tempHome, ROLLOUT_NAME);
    const dbPath = join(codexHome(tempHome), 'state_5.sqlite');
    await createLedger(dbPath, [
      {
        id: 'growing-thread',
        rolloutPath,
        tokensUsed: 1_000,
        model: 'gpt-5.6-sol',
        cwd: '/Users/dev/my-app',
        recencyAtMs: Date.parse('2026-06-09T20:47:00.000Z'),
      },
    ]);

    await withIsolatedCodexHome(tempHome, async () => {
      const cursors: CursorsFile = {};
      const first = await parseCodexIncremental(cursors, SINCE);
      assert.equal(first.result.filesProcessed, 1);
      assert.equal(cursors.codex?.ledgerTotals?.['growing-thread']?.tokens, 1_000);
      const mtime = cursors.codex!.dbMtimes![dbPath];
      assert.equal(typeof mtime, 'number');

      await mkdir(join(rolloutPath, '..'), { recursive: true });
      await writeFile(
        rolloutPath,
        [
          '{"type":"session_meta","payload":{"id":"growing-thread","cwd":"/Users/dev/my-app"}}',
          tokenLine({ timestamp: '2026-06-09T21:00:00.000Z', input: 50 }),
        ].join('\n') + '\n',
        'utf8',
      );
      const second = await parseCodexIncremental(cursors, SINCE);
      assert.equal(second.result.filesProcessed, 1);
      assert.equal(ledgerBuckets(second.result.buckets).length, 0);
      assert.equal(sumTokens(preciseBuckets(second.result.buckets)), 50);
      assert.equal(cursors.codex?.ledgerTotals?.['growing-thread']?.tokens, 1_050);
      assert.equal(cursors.codex?.dbMtimes?.[dbPath], mtime);

      updateTokens(dbPath, 'growing-thread', 1_050);
      delete cursors.codex!.dbMtimes;
      const third = await parseCodexIncremental(cursors, SINCE);
      assert.equal(third.result.buckets.length, 0);
      assert.equal(cursors.codex?.ledgerTotals?.['growing-thread']?.tokens, 1_050);
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('parseCodexIncremental restarts the budget when tokens_used shrinks', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-reset-'));
  try {
    const dbPath = join(codexHome(tempHome), 'state_5.sqlite');
    await createLedger(dbPath, [
      {
        id: 'reset-thread',
        rolloutPath: ledgerRolloutPath(tempHome, ROLLOUT_NAME),
        tokensUsed: 1_000,
        model: 'gpt-5.6-sol',
        cwd: '/Users/dev/my-app',
        recencyAtMs: Date.parse('2026-06-09T20:47:00.000Z'),
      },
    ]);

    await withIsolatedCodexHome(tempHome, async () => {
      const cursors: CursorsFile = {};
      await parseCodexIncremental(cursors, SINCE);
      updateTokens(dbPath, 'reset-thread', 100);
      delete cursors.codex!.dbMtimes;
      const reset = await parseCodexIncremental(cursors, SINCE);
      assert.equal(reset.result.buckets[0]?.input_tokens, 100);
      assert.equal(reset.result.buckets[0]?.conversation_count, 1);
      assert.deepEqual(cursors.codex?.ledgerTotals, { 'reset-thread': { tokens: 100 } });
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('parseCodexIncremental reads only the newest state sqlite', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-newest-'));
  try {
    const home = codexHome(tempHome);
    await createLedger(join(home, 'state_4.sqlite'), [
      {
        id: 'old-thread',
        rolloutPath: ledgerRolloutPath(tempHome, 'rollout-old.jsonl'),
        tokensUsed: 99_999,
        model: 'gpt-5.4',
        cwd: '/Users/dev/old-app',
        recencyAtMs: Date.parse('2026-06-09T20:47:00.000Z'),
      },
    ]);
    await createLedger(join(home, 'state_5.sqlite'), [
      {
        id: 'new-thread',
        rolloutPath: ledgerRolloutPath(tempHome, 'rollout-new.jsonl'),
        tokensUsed: 10,
        model: 'gpt-5.6-sol',
        cwd: '/Users/dev/new-app',
        recencyAtMs: Date.parse('2026-06-09T20:47:00.000Z'),
      },
    ]);

    await withIsolatedCodexHome(tempHome, async () => {
      const cursors: CursorsFile = {};
      const { result } = await parseCodexIncremental(cursors, SINCE);
      assert.deepEqual(
        result.buckets.map((bucket) => [bucket.model, bucket.input_tokens]),
        [['gpt-5.6-sol', 10]],
      );
      assert.deepEqual(cursors.codex?.ledgerTotals, { 'new-thread': { tokens: 10 } });
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('parseCodexIncremental skips ledger rows outside the collection window', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-window-'));
  try {
    await createLedger(join(codexHome(tempHome), 'state_5.sqlite'), [
      {
        id: 'stale-thread',
        rolloutPath: ledgerRolloutPath(tempHome, 'rollout-2026-01-04T02-00-00-old.jsonl'),
        tokensUsed: 500,
        model: 'gpt-5.4',
        cwd: '/Users/dev/old-app',
        recencyAtMs: Date.parse('2026-01-04T02:05:00.000Z'),
      },
      {
        id: 'recent-thread',
        rolloutPath: ledgerRolloutPath(tempHome, 'rollout-2026-06-09T20-46-00-recent.jsonl'),
        tokensUsed: 700,
        model: 'gpt-5.5',
        cwd: '/Users/dev/new-app',
        recencyAtMs: Date.parse('2026-07-01T09:00:00.000Z'),
      },
    ]);

    await withIsolatedCodexHome(tempHome, async () => {
      const cursors: CursorsFile = {};
      const { result } = await parseCodexIncremental(cursors, '2026-06-01T00:00:00.000Z');
      assert.equal(result.eventsParsed, 1);
      assert.deepEqual(
        result.buckets.map((b) => [b.model, b.input_tokens]),
        [['gpt-5.5', 700]],
      );
      assert.deepEqual(cursors.codex?.ledgerTotals, {
        'stale-thread': { tokens: 500 },
        'recent-thread': { tokens: 700 },
      });
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('parseCodexIncremental falls back to created_at_ms when recency is unset', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-created-'));
  try {
    await createLedger(join(codexHome(tempHome), 'state_5.sqlite'), [
      {
        id: 'created-thread',
        rolloutPath: ledgerRolloutPath(tempHome, 'rollout-2026-06-05T00-00-00-created.jsonl'),
        tokensUsed: 2_048,
        model: 'gpt-5.6-sol',
        cwd: '/Users/dev/my-app',
        recencyAtMs: 0,
        createdAtMs: Date.parse('2026-06-05T00:00:00.000Z'),
      },
      {
        id: 'undated-thread',
        rolloutPath: ledgerRolloutPath(tempHome, 'rollout-2026-06-05T00-00-00-undated.jsonl'),
        tokensUsed: 4_096,
        model: 'gpt-5.6-sol',
        cwd: '/Users/dev/my-app',
      },
    ]);

    await withIsolatedCodexHome(tempHome, async () => {
      const cursors: CursorsFile = {};
      const { result } = await parseCodexIncremental(cursors, SINCE);
      assert.equal(result.eventsParsed, 1);
      assert.equal(result.buckets.length, 1);
      assert.equal(result.buckets[0]?.hour_start, '2026-06-05T00:00:00.000Z');
      assert.equal(result.buckets[0]?.input_tokens, 2_048);
      assert.equal(cursors.codex?.ledgerTotals?.['undated-thread']?.tokens, 4_096);
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('parseCodexIncremental ignores a ledger without a threads table', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-broken-'));
  try {
    const rolloutPath = ledgerRolloutPath(tempHome, ROLLOUT_NAME);
    await mkdir(join(rolloutPath, '..'), { recursive: true });
    await writeFile(rolloutPath, `${ROLLOUT_JSONL}\n`, 'utf8');
    await mkdir(codexHome(tempHome), { recursive: true });
    await writeFile(join(codexHome(tempHome), 'state_5.sqlite'), 'not a sqlite database', 'utf8');

    await withIsolatedCodexHome(tempHome, async () => {
      const { result } = await parseCodexIncremental({}, SINCE);
      assert.equal(result.eventsParsed, 1);
      assert.equal(result.buckets[0]?.input_tokens, 50);
      assert.equal(result.buckets[0]?.collector, undefined);
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('parseCodexIncremental leaves no ledger cursor when Codex is absent', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-absent-'));
  try {
    await withIsolatedCodexHome(tempHome, async () => {
      assert.deepEqual(codexHomeCandidates(), [codexHome(tempHome)]);
      const cursors: CursorsFile = {};
      const { result } = await parseCodexIncremental(cursors, SINCE);
      assert.equal(result.eventsParsed, 0);
      assert.equal(result.filesProcessed, 0);
      assert.equal(cursors.codex?.ledgerTotals, undefined);
      assert.equal(cursors.codex?.dbMtimes, undefined);
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('codexLedgerSchemaVersion and newestCodexLedgerPaths keep one ledger per home', () => {
  assert.equal(codexLedgerSchemaVersion('/tmp/.codex/state.sqlite'), 0);
  assert.equal(codexLedgerSchemaVersion('/tmp/.codex/state_5.sqlite'), 5);
  assert.equal(codexLedgerSchemaVersion('/tmp/.codex/other.sqlite'), -1);
  assert.deepEqual(
    newestCodexLedgerPaths([
      '/a/.codex/state_4.sqlite',
      '/a/.codex/state_5.sqlite',
      '/b/.codex/state.sqlite',
      '/b/.codex/state_2.sqlite',
    ]).sort(),
    ['/a/.codex/state_5.sqlite', '/b/.codex/state_2.sqlite'].sort(),
  );
});

function sampleThread(overrides: Partial<CodexLedgerThread> = {}): CodexLedgerThread {
  return {
    id: 't1',
    rolloutPath: '/tmp/rollout.jsonl',
    tokensUsed: 1_000,
    model: 'gpt-5.6-sol',
    cwd: '/Users/dev/my-app',
    timestampMs: Date.parse('2026-06-09T20:47:00.000Z'),
    ...overrides,
  };
}

test('reconcileCodexLedgerThread seeds an already-counted thread without emitting', () => {
  const ledgerTotals: Record<string, { tokens: number }> = {};
  const bucketState: BucketAccumulator = new Map();
  const wrote = reconcileCodexLedgerThread(sampleThread({ tokensUsed: 5_000 }), {
    ledgerTotals,
    jsonlEmitted: 0,
    jsonlLifetime: null,
    jsonlObserved: 0,
    alreadyCounted: true,
    sinceMs: Date.parse(SINCE),
    bucketState,
  });
  assert.equal(wrote, false);
  assert.equal(bucketState.size, 0);
  assert.deepEqual(ledgerTotals, { t1: { tokens: 5_000 } });
});

test('reconcileCodexLedgerThread does not treat a first-seen zero watermark as a seed', () => {
  const ledgerTotals: Record<string, { tokens: number }> = {};
  const bucketState: BucketAccumulator = new Map();
  const wrote = reconcileCodexLedgerThread(sampleThread({ tokensUsed: 400 }), {
    ledgerTotals,
    jsonlEmitted: 0,
    jsonlLifetime: null,
    jsonlObserved: 0,
    alreadyCounted: false,
    sinceMs: Date.parse(SINCE),
    bucketState,
  });
  assert.equal(wrote, true);
  assert.equal(bucketState.size, 1);
  assert.deepEqual(ledgerTotals, { t1: { tokens: 400 } });
});

test('reconcileCodexLedgerThread uses file lifetime so window-skipped tokens stay out of the gap', () => {
  const ledgerTotals: Record<string, { tokens: number }> = {};
  const bucketState: BucketAccumulator = new Map();
  const wrote = reconcileCodexLedgerThread(sampleThread({ tokensUsed: 10_000 }), {
    ledgerTotals,
    jsonlEmitted: 2_000,
    jsonlLifetime: 10_000,
    jsonlObserved: 10_000,
    alreadyCounted: false,
    sinceMs: Date.parse(SINCE),
    bucketState,
  });
  assert.equal(wrote, false);
  assert.equal(bucketState.size, 0);
  assert.deepEqual(ledgerTotals, { t1: { tokens: 10_000 } });
});

test('reconcileCodexLedgerThread only bills the unseen tail when a file lifetime is present', () => {
  const ledgerTotals: Record<string, { tokens: number }> = {};
  const bucketState: BucketAccumulator = new Map();
  const wrote = reconcileCodexLedgerThread(sampleThread({ tokensUsed: 1_000 }), {
    ledgerTotals,
    jsonlEmitted: 600,
    jsonlLifetime: 600,
    jsonlObserved: 600,
    alreadyCounted: false,
    sinceMs: Date.parse(SINCE),
    bucketState,
  });
  assert.equal(wrote, true);
  const only = [...bucketState.values()][0]!;
  assert.equal(only.input_tokens, 400);
  assert.equal(only.collector, CODEX_LEDGER_COLLECTOR);
  assert.deepEqual(ledgerTotals, { t1: { tokens: 1_000 } });
});

test('reconcileCodexLedgerThread raises the watermark when JSONL leads the ledger', () => {
  const ledgerTotals: Record<string, { tokens: number }> = {};
  const bucketState: BucketAccumulator = new Map();
  const wrote = reconcileCodexLedgerThread(sampleThread({ tokensUsed: 994 }), {
    ledgerTotals,
    jsonlEmitted: 1_000,
    jsonlLifetime: 1_000,
    jsonlObserved: 1_000,
    alreadyCounted: false,
    sinceMs: Date.parse(SINCE),
    bucketState,
  });
  assert.equal(wrote, false);
  assert.deepEqual(ledgerTotals, { t1: { tokens: 1_000 } });

  const later = reconcileCodexLedgerThread(sampleThread({ tokensUsed: 1_000 }), {
    ledgerTotals,
    jsonlEmitted: 0,
    jsonlLifetime: null,
    jsonlObserved: 0,
    alreadyCounted: false,
    sinceMs: Date.parse(SINCE),
    bucketState,
  });
  assert.equal(later, false);
  assert.equal(bucketState.size, 0);
  assert.deepEqual(ledgerTotals, { t1: { tokens: 1_000 } });
});

test('parseCodexIncremental matches a ledger thread by session id when the path basename differs', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-session-'));
  try {
    const rolloutPath = ledgerRolloutPath(tempHome, ROLLOUT_NAME);
    await mkdir(join(rolloutPath, '..'), { recursive: true });
    await writeFile(rolloutPath, `${ROLLOUT_JSONL}\n`, 'utf8');
    await createLedger(join(codexHome(tempHome), 'state_5.sqlite'), [
      {
        id: 'live-session',
        // Path name no longer matches the on-disk rollout; only session id does.
        rolloutPath: join(codexHome(tempHome), 'sessions', 'legacy-name.jsonl'),
        tokensUsed: 100,
        model: 'gpt-5.6-sol',
        cwd: '/Users/dev/my-app',
        recencyAtMs: Date.parse('2026-06-09T20:46:30.000Z'),
      },
    ]);

    await withIsolatedCodexHome(tempHome, async () => {
      const cursors: CursorsFile = {};
      const { result } = await parseCodexIncremental(cursors, SINCE);
      assert.equal(sumTokens(preciseBuckets(result.buckets)), 60);
      assert.equal(ledgerBuckets(result.buckets)[0]?.input_tokens, 40);
      assert.deepEqual(cursors.codex?.ledgerTotals, { 'live-session': { tokens: 100 } });
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('parseCodexIncremental keeps precise JSONL totals identical when the ledger equals the file', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'tud-codex-ledger-stable-'));
  try {
    const rolloutPath = ledgerRolloutPath(tempHome, ROLLOUT_NAME);
    await mkdir(join(rolloutPath, '..'), { recursive: true });
    await writeFile(rolloutPath, `${ROLLOUT_JSONL}\n`, 'utf8');

    await withIsolatedCodexHome(tempHome, async () => {
      const withoutLedger = await parseCodexIncremental({}, SINCE);
      assert.equal(withoutLedger.result.buckets[0]?.input_tokens, 50);
      assert.equal(withoutLedger.result.buckets[0]?.output_tokens, 10);
      assert.equal(withoutLedger.result.buckets[0]?.collector, undefined);

      await createLedger(join(codexHome(tempHome), 'state_5.sqlite'), [
        {
          id: 'live-thread',
          rolloutPath,
          tokensUsed: 60,
          model: 'gpt-5.6-sol',
          cwd: '/Users/dev/my-app',
          recencyAtMs: Date.parse('2026-06-09T20:46:30.000Z'),
        },
      ]);
      const withLedger = await parseCodexIncremental({}, SINCE);
      assert.equal(withLedger.result.buckets.length, 1);
      assert.equal(withLedger.result.buckets[0]?.input_tokens, 50);
      assert.equal(withLedger.result.buckets[0]?.output_tokens, 10);
      assert.equal(withLedger.result.buckets[0]?.cached_input_tokens, 0);
      assert.equal(withLedger.result.buckets[0]?.collector, undefined);
      assert.equal(ledgerBuckets(withLedger.result.buckets).length, 0);
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});
