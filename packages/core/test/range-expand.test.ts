import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  clearCursors,
  loadCursors,
  loadRecentBuckets,
  resetCursorsCache,
} from '../src/queue/index.js';
import { resetJsonlWalkCache } from '../src/parsers/shared.js';
import { BucketStore, ensureLocalCollectRange } from '../src/server/state.js';
import { syncAll } from '../src/sync/index.js';
import type { QueueBucket, TudConfig } from '../src/types.js';

const DAY_MS = 24 * 3600_000;

function daysAgoIso(days: number, hourOffset = 0): string {
  return new Date(Date.now() - days * DAY_MS + hourOffset * 3600_000).toISOString();
}

/** Config with both floors at `days` ago, like the dashboard 7D / 90D switch. */
function configForDays(days: number): TudConfig {
  return {
    deviceId: 'test-device',
    statsSince: daysAgoIso(days),
    localCollectSince: daysAgoIso(days),
    hostname: 'test-host',
    dataDir: '',
  } as TudConfig;
}

function claudeLine(opts: {
  id: string;
  timestamp: string;
  input: number;
  output: number;
}): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: `uuid-${opts.id}`,
    requestId: `req-${opts.id}`,
    timestamp: opts.timestamp,
    cwd: '/tmp/demo',
    message: {
      id: `msg-${opts.id}`,
      model: 'claude-sonnet-4-5',
      usage: { input_tokens: opts.input, output_tokens: opts.output },
    },
  });
}

interface Totals {
  total: number;
  conversations: number;
}

async function queueTotals(dataDir: string, config: TudConfig): Promise<Totals> {
  const rows: QueueBucket[] = await loadRecentBuckets(
    dataDir,
    config.localCollectSince ?? config.statsSince,
  );
  return {
    total: rows.reduce((sum, row) => sum + row.total_tokens, 0),
    conversations: rows.reduce((sum, row) => sum + row.conversation_count, 0),
  };
}

/** Fresh HOME so parsers only see the fixtures written by one test. */
async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'tud-range-home-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  resetJsonlWalkCache();
  return home;
}

async function makeDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tud-range-data-'));
  resetCursorsCache(dir);
  return dir;
}

async function writeClaudeSession(home: string, name: string, lines: string[]): Promise<string> {
  const projectDir = join(home, '.claude', 'projects', '-tmp-demo');
  await mkdir(projectDir, { recursive: true });
  const file = join(projectDir, name);
  await writeFile(file, `${lines.join('\n')}\n`, 'utf8');
  resetJsonlWalkCache();
  return file;
}

function withHome(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const prevHome = process.env.HOME;
    const prevProfile = process.env.USERPROFILE;
    try {
      await fn();
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevProfile;
      resetJsonlWalkCache();
    }
  };
}

test(
  'widening the collect range does not recount already ingested usage',
  withHome(async () => {
    const home = await makeHome();
    const dataDir = await makeDataDir();
    await writeClaudeSession(home, 'session-recent.jsonl', [
      claudeLine({ id: 'a', timestamp: daysAgoIso(2), input: 100, output: 20 }),
    ]);

    const week = configForDays(7);
    await syncAll(dataDir, week, 'claude');
    assert.deepEqual(await queueTotals(dataDir, week), { total: 120, conversations: 1 });

    // ensureLocalCollectRange: move the floor, clear cursors, re-sync.
    const quarter = configForDays(90);
    await clearCursors(dataDir);
    await syncAll(dataDir, quarter, 'claude');

    assert.deepEqual(await queueTotals(dataDir, quarter), { total: 120, conversations: 1 });
  }),
);

test(
  '7D then 90D matches a plain 90D scan',
  withHome(async () => {
    const home = await makeHome();
    await writeClaudeSession(home, 'session-mixed.jsonl', [
      claudeLine({ id: 'old', timestamp: daysAgoIso(40), input: 200, output: 40 }),
      claudeLine({ id: 'recent', timestamp: daysAgoIso(2), input: 100, output: 20 }),
    ]);

    const week = configForDays(7);
    const quarter = configForDays(90);

    const expanded = await makeDataDir();
    await syncAll(expanded, week, 'claude');
    assert.deepEqual(await queueTotals(expanded, week), { total: 120, conversations: 1 });
    await clearCursors(expanded);
    await syncAll(expanded, quarter, 'claude');

    const direct = await makeDataDir();
    await syncAll(direct, quarter, 'claude');

    assert.deepEqual(await queueTotals(direct, quarter), { total: 360, conversations: 2 });
    assert.deepEqual(await queueTotals(expanded, quarter), await queueTotals(direct, quarter));
  }),
);

test(
  'repeated rescans stay idempotent',
  withHome(async () => {
    const home = await makeHome();
    const dataDir = await makeDataDir();
    await writeClaudeSession(home, 'session-retry.jsonl', [
      claudeLine({ id: 'a', timestamp: daysAgoIso(2), input: 100, output: 20 }),
    ]);

    const quarter = configForDays(90);
    await syncAll(dataDir, quarter, 'claude');
    const first = await queueTotals(dataDir, quarter);

    // A crash between clearCursors and sync, or a poll racing the expansion,
    // makes the same rescan run more than once.
    for (let i = 0; i < 2; i++) {
      await clearCursors(dataDir);
      await syncAll(dataDir, quarter, 'claude');
      assert.deepEqual(await queueTotals(dataDir, quarter), first);
    }
  }),
);

test(
  'incremental sync after a rescan still adds new events',
  withHome(async () => {
    const home = await makeHome();
    const dataDir = await makeDataDir();
    const file = await writeClaudeSession(home, 'session-live.jsonl', [
      claudeLine({ id: 'a', timestamp: daysAgoIso(2), input: 100, output: 20 }),
    ]);

    const quarter = configForDays(90);
    await syncAll(dataDir, quarter, 'claude');
    await clearCursors(dataDir);
    await syncAll(dataDir, quarter, 'claude');
    assert.deepEqual(await queueTotals(dataDir, quarter), { total: 120, conversations: 1 });

    // Same hour as the snapshot row: the delta must land on top of it.
    await appendFile(
      file,
      `${claudeLine({
        id: 'b',
        timestamp: daysAgoIso(2, 0.1),
        input: 25,
        output: 5,
      })}\n`,
      'utf8',
    );
    await syncAll(dataDir, quarter, 'claude');

    assert.deepEqual(await queueTotals(dataDir, quarter), { total: 150, conversations: 2 });
  }),
);

test(
  'codex backfill replaces its rows instead of stacking them',
  withHome(async () => {
    const home = await makeHome();
    const dataDir = await makeDataDir();
    const prevCodexHome = process.env.CODEX_HOME;
    const codexHome = join(home, '.codex');
    process.env.CODEX_HOME = codexHome;
    try {
      const day = new Date(Date.now() - 2 * DAY_MS);
      const sessionsDir = join(
        codexHome,
        'sessions',
        String(day.getUTCFullYear()),
        String(day.getUTCMonth() + 1).padStart(2, '0'),
        String(day.getUTCDate()).padStart(2, '0'),
      );
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(
        join(sessionsDir, 'rollout-range.jsonl'),
        `${[
          JSON.stringify({
            type: 'session_meta',
            timestamp: daysAgoIso(2),
            payload: { id: 'range-session', cwd: '/tmp/demo' },
          }),
          JSON.stringify({
            type: 'event_msg',
            timestamp: daysAgoIso(2),
            payload: {
              type: 'token_count',
              info: {
                last_token_usage: {
                  input_tokens: 50,
                  cached_input_tokens: 0,
                  output_tokens: 10,
                  reasoning_output_tokens: 0,
                  total_tokens: 60,
                },
                model: 'gpt-5.4',
              },
            },
          }),
        ].join('\n')}\n`,
        'utf8',
      );
      resetJsonlWalkCache();

      const quarter = configForDays(90);
      await syncAll(dataDir, quarter, 'codex');
      const first = await queueTotals(dataDir, quarter);
      assert.equal(first.total, 60);

      await clearCursors(dataDir);
      await syncAll(dataDir, quarter, 'codex');
      assert.deepEqual(await queueTotals(dataDir, quarter), first);
    } finally {
      if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prevCodexHome;
    }
  }),
);

test('ensureLocalCollectRange only clears cursors when the floor moves earlier', async () => {
  const dataDir = await makeDataDir();
  const config = configForDays(7);
  const cleared: number[] = [];
  const synced: string[] = [];
  const deps = {
    dataDir,
    getConfig: () => config,
    bucketStore: new BucketStore(),
    runSyncViaRunner: async (reason: string) => {
      synced.push(reason);
      return [];
    },
    onCursorsCleared: () => {
      cleared.push(Date.now());
    },
  };

  await clearCursors(dataDir);
  await loadCursors(dataDir);

  const expand = await ensureLocalCollectRange(deps, 90);
  assert.equal(expand.expanded, true);
  assert.equal(cleared.length, 1, 'worker cursor cache must be invalidated on expand');
  assert.equal(synced.length, 1);
  const widened = expand.config.localCollectSince;

  // Narrowing back only changes the display window: no clear, no rescan, and
  // the collect floor stays where the wider range left it.
  const shrink = await ensureLocalCollectRange(deps, 7);
  assert.equal(shrink.expanded, false);
  assert.equal(shrink.sync, null);
  assert.equal(cleared.length, 1);
  assert.equal(synced.length, 1);
  assert.equal(shrink.config.localCollectSince, widened);
});

test(
  'sync worker: cursors cleared by another process only backfill once the cache is dropped',
  withHome(async () => {
    const home = await makeHome();
    const dataDir = await makeDataDir();
    await writeClaudeSession(home, 'session-worker.jsonl', [
      claudeLine({ id: 'old', timestamp: daysAgoIso(40), input: 200, output: 40 }),
      claudeLine({ id: 'recent', timestamp: daysAgoIso(2), input: 100, output: 20 }),
    ]);

    const week = configForDays(7);
    const quarter = configForDays(90);
    await syncAll(dataDir, week, 'claude');
    assert.deepEqual(await queueTotals(dataDir, week), { total: 120, conversations: 1 });

    // Desktop main clears cursors.json on disk; the worker still has the file
    // cached in memory, so its parsers report "nothing new" and skip the
    // backfill entirely.
    await writeFile(join(dataDir, 'cursors.json'), '{}\n', 'utf8');
    const stale = await syncAll(dataDir, quarter, 'claude');
    assert.equal(stale[0]?.bucketsWritten, 0);
    assert.deepEqual(await queueTotals(dataDir, quarter), { total: 120, conversations: 1 });

    // `invalidateCursors` drops that cached copy: the backfill lands and the
    // already ingested row is replaced rather than added twice.
    resetCursorsCache(dataDir);
    await syncAll(dataDir, quarter, 'claude');
    assert.deepEqual(await queueTotals(dataDir, quarter), { total: 360, conversations: 2 });
  }),
);
