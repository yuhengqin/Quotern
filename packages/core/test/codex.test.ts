import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { parseCodexIncremental } from '../src/parsers/codex.js';
import { modelFromRolloutEvent } from '../src/parsers/rollout-model.js';
import { codexHomeCandidates } from '../src/paths.js';
import type { CursorsFile } from '../src/types.js';
import { applyRemotePricingOverlay, computeRowCost, resetPricingRuntime } from '../src/pricing/index.js';

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

/** Pin HOME + CODEX_HOME to a temp tree so discovery cannot see the developer's CC Switch. */
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

const SOURCE_FILE = [
  '{"type":"session_meta","timestamp":"2026-06-09T20:46:00.000Z","payload":{"id":"source-session-1","cwd":"/Users/dev/my-app"}}',
  '{"type":"event_msg","timestamp":"2026-06-09T20:46:30.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":50,"cached_input_tokens":0,"output_tokens":10,"reasoning_output_tokens":0,"total_tokens":60},"model":"gpt-5.4"}}}',
].join('\n');

const FORK_FILE = [
  '{"type":"session_meta","timestamp":"2026-06-09T21:00:00.000Z","payload":{"id":"fork-session-1","forked_from_id":"source-session-1","cwd":"/Users/dev/my-app"}}',
  '{"type":"event_msg","timestamp":"2026-06-09T21:00:01.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":50,"cached_input_tokens":0,"output_tokens":10,"reasoning_output_tokens":0,"total_tokens":60},"model":"gpt-5.4"}}}',
  '{"type":"event_msg","timestamp":"2026-06-09T21:00:05.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":20,"cached_input_tokens":5,"output_tokens":8,"reasoning_output_tokens":2,"total_tokens":28},"model":"gpt-5.4"}}}',
].join('\n');

test('Codex restores service tier from an old cursor prefix and bills split reasoning once', async () => {
  const home = await mkdtemp(join(tmpdir(), 'quotern-tier-'));
  const folder = join(home, '.codex', 'sessions');
  await mkdir(folder, { recursive: true });
  const file = join(folder, 'tier.jsonl');
  const event = (stamp: string) => JSON.stringify({ type: 'event_msg', timestamp: stamp, payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, output_tokens: 20, reasoning_output_tokens: 10 } } } });
  await writeFile(file, [JSON.stringify({ type: 'session_meta', payload: { id: 'tier-session' } }), JSON.stringify({ type: 'turn_context', payload: { model: 'tier-fixture', service_tier: 'fast' } }), event('2026-10-18T00:00:00Z')].join('\n') + '\n');
  await withIsolatedCodexHome(home, async () => {
    const first = await parseCodexIncremental({}, '2026-10-01');
    for (const cursor of Object.values(first.cursors.codex!.files)) delete cursor.serviceTier;
    await appendFile(file, event('2026-10-18T01:00:00Z') + '\n');
    const next = await parseCodexIncremental(first.cursors, '2026-10-01');
    assert.equal(next.result.buckets[0]?.pricing_requests?.[0]?.serviceTier, 'fast');
    applyRemotePricingOverlay({ exact: { 'tier-fixture': { input: 1, output: 2 } } });
    assert.equal(computeRowCost(next.result.buckets[0]!), 0.00014);
    resetPricingRuntime();
  });
});

test('parseCodexIncremental normalizes input and skips fork replay', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'quotern-codex-'));
  const sessionsDir = join(tempHome, '.codex', 'sessions', '2026', '06', '09');
  await mkdir(sessionsDir, { recursive: true });

  await writeFile(join(sessionsDir, 'rollout-source.jsonl'), `${SOURCE_FILE}\n`, 'utf8');
  await writeFile(join(sessionsDir, 'rollout-fork.jsonl'), `${FORK_FILE}\n`, 'utf8');

  await withIsolatedCodexHome(tempHome, async () => {
    const { result } = await parseCodexIncremental({}, '2026-01-01T00:00:00.000Z');
    assert.equal(result.eventsParsed, 2);

    const totalInput = result.buckets.reduce((sum, b) => sum + b.input_tokens, 0);
    const totalOutput = result.buckets.reduce((sum, b) => sum + b.output_tokens, 0);

    assert.equal(totalInput, 50 + 15);
    assert.equal(totalOutput, 10 + 6);
  });
});

test('parseCodexIncremental reads cache write alias and preserves the canonical field', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'quotern-codex-cache-write-'));
  const sessionsDir = join(tempHome, '.codex', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  const cases = [
    { model: 'alias', fields: { cache_write_input_tokens: 7 }, expected: 7, input: 33 },
    { model: 'canonical', fields: { cache_creation_input_tokens: 3, cache_write_input_tokens: 7 }, expected: 3, input: 40 },
    { model: 'canonical-zero', fields: { cache_creation_input_tokens: 0, cache_write_input_tokens: 7 }, expected: 0, input: 40 },
  ];
  for (const sample of cases) {
    await writeFile(join(sessionsDir, `rollout-${sample.model}.jsonl`), [
      JSON.stringify({ type: 'session_meta', payload: { id: sample.model, cwd: '/test/app' } }),
      JSON.stringify({ type: 'event_msg', timestamp: '2026-06-09T20:46:30.000Z', payload: {
        type: 'token_count', info: { model: sample.model, last_token_usage: {
          input_tokens: 50, cached_input_tokens: 10, output_tokens: 10,
          ...sample.fields,
        } },
      } }),
      '',
    ].join('\n'));
  }
  await withIsolatedCodexHome(tempHome, async () => {
    const { result } = await parseCodexIncremental({}, '2026-01-01T00:00:00.000Z');
    for (const sample of cases) {
      const bucket = result.buckets.find((row) => row.model === sample.model);
      assert.equal(bucket?.cache_creation_input_tokens, sample.expected);
      assert.equal(bucket?.input_tokens, sample.input);
      assert.equal(bucket?.output_tokens, 10);
      if (sample.model === 'alias') assert.equal(bucket?.total_tokens, 60);
    }
  });
});

test('parseCodexIncremental keeps cache write cumulative deltas across scans', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'quotern-codex-cache-delta-'));
  const sessionsDir = join(tempHome, '.codex', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  const filePath = join(sessionsDir, 'rollout-cache-delta.jsonl');
  const first = [
    JSON.stringify({ type: 'session_meta', payload: { id: 'cache-delta', cwd: '/test/app' } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-06-09T20:46:30.000Z', payload: {
      type: 'token_count', info: { model: 'gpt-test', total_token_usage: {
        input_tokens: 50, cached_input_tokens: 10, output_tokens: 10, cache_write_input_tokens: 7,
      } },
    } }),
    '',
  ].join('\n');
  await writeFile(filePath, first);
  await withIsolatedCodexHome(tempHome, async () => {
    const cursors: CursorsFile = {};
    const initial = await parseCodexIncremental(cursors, '2026-01-01T00:00:00.000Z');
    assert.equal(initial.result.buckets[0]?.cache_creation_input_tokens, 7);
    assert.equal(initial.result.buckets[0]?.input_tokens, 33);
    assert.equal(initial.result.buckets[0]?.total_tokens, 60);
    const next = JSON.stringify({ type: 'event_msg', timestamp: '2026-06-09T20:47:00.000Z', payload: {
      type: 'token_count', info: { model: 'gpt-test', total_token_usage: {
        input_tokens: 100, cached_input_tokens: 20, output_tokens: 20, cache_write_input_tokens: 13,
      } },
    } });
    await writeFile(filePath, `${first}${next}\n`);
    const incremental = await parseCodexIncremental(cursors, '2026-01-01T00:00:00.000Z');
    assert.equal(incremental.result.buckets[0]?.cache_creation_input_tokens, 6);
    assert.equal(incremental.result.buckets[0]?.input_tokens, 34);
    assert.equal(incremental.result.buckets[0]?.total_tokens, 60);
  });
});

test('codexHomeCandidates splits env path lists and deduplicates roots', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'quotern-codex-env-list-'));
  const snapshot = snapshotCodexEnv();
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.CODEX_HOME = `/tmp/codex-primary${delimiter}/tmp/codex-shared`;
  process.env.AI_USAGE_CODEX_HOME = `/tmp/codex-shared${delimiter}/tmp/codex-extra`;
  try {
    const roots = codexHomeCandidates();
    assert.deepEqual(roots, ['/tmp/codex-shared', '/tmp/codex-extra', '/tmp/codex-primary']);
  } finally {
    restoreCodexEnv(snapshot);
  }
});

test('codexHomeCandidates reads CC Switch override and keeps default ~/.codex', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'quotern-cc-switch-'));
  const ccSwitchDir = join(tempHome, '.cc-switch');
  const alternateCodex = join(tempHome, 'codex-alt');
  await mkdir(ccSwitchDir, { recursive: true });
  await writeFile(
    join(ccSwitchDir, 'settings.json'),
    JSON.stringify({ codexConfigDir: alternateCodex }),
    'utf8',
  );

  const snapshot = snapshotCodexEnv();
  delete process.env.CODEX_HOME;
  delete process.env.AI_USAGE_CODEX_HOME;
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  try {
    const roots = codexHomeCandidates();
    assert.ok(roots.includes(alternateCodex));
    assert.ok(roots.includes(join(tempHome, '.codex')));
    assert.equal(new Set(roots).size, roots.length);
  } finally {
    restoreCodexEnv(snapshot);
  }
});

test('codexHomeCandidates keeps CC Switch and ~/.codex when CODEX_HOME is set', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'quotern-cc-switch-env-'));
  const ccSwitchDir = join(tempHome, '.cc-switch');
  const alternateCodex = join(tempHome, 'codex-alt');
  await mkdir(ccSwitchDir, { recursive: true });
  await writeFile(
    join(ccSwitchDir, 'settings.json'),
    JSON.stringify({ codexConfigDir: alternateCodex }),
    'utf8',
  );

  const snapshot = snapshotCodexEnv();
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.CODEX_HOME = '/tmp/codex-active-profile';
  delete process.env.AI_USAGE_CODEX_HOME;

  try {
    const roots = codexHomeCandidates();
    assert.deepEqual(roots, [
      '/tmp/codex-active-profile',
      alternateCodex,
      join(tempHome, '.codex'),
    ]);
  } finally {
    restoreCodexEnv(snapshot);
  }
});

const EXTRA_TOKEN_LINE =
  '{"type":"event_msg","timestamp":"2026-06-09T20:47:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":30,"cached_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0,"total_tokens":35},"model":"gpt-5.4"}}}';

test('parseCodexIncremental reuses cached session meta for unchanged files', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'quotern-codex-'));
  const sessionsDir = join(tempHome, '.codex', 'sessions', '2026', '06', '12');
  await mkdir(sessionsDir, { recursive: true });
  const filePath = join(sessionsDir, 'rollout-meta-cache.jsonl');
  await writeFile(filePath, `${SOURCE_FILE}\n`, 'utf8');

  await withIsolatedCodexHome(tempHome, async () => {
    const cursors: CursorsFile = {};
    await parseCodexIncremental(cursors, '2026-01-01T00:00:00.000Z');
    const fileCursor = cursors.codex!.files[filePath]!;
    assert.equal(fileCursor.meta?.sessionId, 'source-session-1');
    assert.equal(fileCursor.meta?.tokenCountRecords, 1);

    // Rewrite in place with the same byte length but a different session id:
    // same inode + size must hit the cached meta instead of re-indexing.
    await writeFile(
      filePath,
      `${SOURCE_FILE.replace('source-session-1', 'source-session-9')}\n`,
      'utf8',
    );
    const second = await parseCodexIncremental(cursors, '2026-01-01T00:00:00.000Z');
    assert.equal(second.result.eventsParsed, 0);
    assert.equal(cursors.codex!.files[filePath]!.meta?.sessionId, 'source-session-1');
    assert.equal(cursors.codex!.sessionIndex!['source-session-9'], undefined);

    // Growing the file invalidates the cached meta and re-indexes it.
    await writeFile(filePath, `${SOURCE_FILE}\n${EXTRA_TOKEN_LINE}\n`, 'utf8');
    const third = await parseCodexIncremental(cursors, '2026-01-01T00:00:00.000Z');
    assert.equal(third.result.eventsParsed, 1);
    assert.equal(cursors.codex!.files[filePath]!.meta?.tokenCountRecords, 2);
  });
});

test('parseCodexIncremental uses the model from thread settings', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'quotern-codex-'));
  const sessionsDir = join(tempHome, '.codex', 'sessions', '2026', '06', '10');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'rollout-settings.jsonl'),
    [
      '{"type":"session_meta","payload":{"id":"settings-session","cwd":"/Users/dev/my-app"}}',
      '{"type":"thread_settings_applied","thread_settings":{"model":"gpt-5.6-sol"}}',
      '{"timestamp":"2026-06-10T10:00:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":50,"output_tokens":10,"total_tokens":60}}}}',
    ].join('\n'),
    'utf8',
  );

  await withIsolatedCodexHome(tempHome, async () => {
    const { result } = await parseCodexIncremental({}, '2026-01-01T00:00:00.000Z');
    assert.equal(result.buckets.length, 1);
    assert.equal(result.buckets[0]?.model, 'gpt-5.6-sol');
  });
});

const CONTEXT_ONLY = [
  '{"type":"session_meta","payload":{"id":"desktop-session","cwd":"/Users/dev/alipay-service"}}',
  '{"type":"turn_context","payload":{"model":"deepseek-v4-flash"}}',
].join('\n');

const TOKEN_WITHOUT_MODEL =
  '{"timestamp":"2026-08-21T02:26:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":50,"output_tokens":10,"total_tokens":60}}}}';

test('modelFromRolloutEvent reads turn_context, thread settings, and world_state', () => {
  assert.equal(
    modelFromRolloutEvent({
      type: 'turn_context',
      payload: { model: 'deepseek-v4-flash' },
    }),
    'deepseek-v4-flash',
  );
  assert.equal(
    modelFromRolloutEvent({
      type: 'thread_settings_applied',
      thread_settings: { model: 'gpt-5.6-sol' },
    }),
    'gpt-5.6-sol',
  );
  assert.equal(
    modelFromRolloutEvent({
      type: 'world_state',
      payload: {
        state: { model: 'deepseek-v4-flash' },
        collaboration_mode: { model: 'other' },
      },
    }),
    'deepseek-v4-flash',
  );
  assert.equal(
    modelFromRolloutEvent({
      type: 'world_state',
      payload: { collaboration_mode: { model: 'gpt-5.4' } },
    }),
    'gpt-5.4',
  );
  assert.equal(modelFromRolloutEvent({ type: 'event_msg', payload: {} }), null);
});

test('parseCodexIncremental persists lastModel across tail scans without info.model', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'quotern-codex-'));
  const sessionsDir = join(tempHome, '.codex', 'sessions', '2026', '08', '21');
  await mkdir(sessionsDir, { recursive: true });
  const filePath = join(sessionsDir, 'rollout-last-model.jsonl');
  await writeFile(filePath, `${CONTEXT_ONLY}\n`, 'utf8');

  await withIsolatedCodexHome(tempHome, async () => {
    const cursors: CursorsFile = {};
    const first = await parseCodexIncremental(cursors, '2026-01-01T00:00:00.000Z');
    assert.equal(first.result.eventsParsed, 0);
    assert.equal(cursors.codex!.files[filePath]!.lastModel, 'deepseek-v4-flash');

    await writeFile(filePath, `${CONTEXT_ONLY}\n${TOKEN_WITHOUT_MODEL}\n`, 'utf8');
    const second = await parseCodexIncremental(cursors, '2026-01-01T00:00:00.000Z');
    assert.equal(second.result.eventsParsed, 1);
    assert.equal(second.result.buckets.length, 1);
    assert.equal(second.result.buckets[0]?.model, 'deepseek-v4-flash');
  });
});

test('parseCodexIncremental recovers lastModel from the skipped prefix', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'quotern-codex-'));
  const sessionsDir = join(tempHome, '.codex', 'sessions', '2026', '08', '21');
  await mkdir(sessionsDir, { recursive: true });
  const filePath = join(sessionsDir, 'rollout-prefix-recover.jsonl');
  await writeFile(filePath, `${CONTEXT_ONLY}\n`, 'utf8');

  await withIsolatedCodexHome(tempHome, async () => {
    const cursors: CursorsFile = {};
    await parseCodexIncremental(cursors, '2026-01-01T00:00:00.000Z');
    delete cursors.codex!.files[filePath]!.lastModel;

    await writeFile(filePath, `${CONTEXT_ONLY}\n${TOKEN_WITHOUT_MODEL}\n`, 'utf8');
    const { result } = await parseCodexIncremental(cursors, '2026-01-01T00:00:00.000Z');
    assert.equal(result.eventsParsed, 1);
    assert.equal(result.buckets[0]?.model, 'deepseek-v4-flash');
    assert.equal(cursors.codex!.files[filePath]!.lastModel, 'deepseek-v4-flash');
  });
});

test('parseCodexIncremental uses the model from world_state', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'quotern-codex-'));
  const sessionsDir = join(tempHome, '.codex', 'sessions', '2026', '08', '21');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'rollout-world-state.jsonl'),
    [
      '{"type":"session_meta","payload":{"id":"world-session","cwd":"/Users/dev/my-app"}}',
      '{"type":"world_state","payload":{"state":{"model":"deepseek-v4-flash"}}}',
      TOKEN_WITHOUT_MODEL,
    ].join('\n'),
    'utf8',
  );

  await withIsolatedCodexHome(tempHome, async () => {
    const { result } = await parseCodexIncremental({}, '2026-01-01T00:00:00.000Z');
    assert.equal(result.buckets.length, 1);
    assert.equal(result.buckets[0]?.model, 'deepseek-v4-flash');
  });
});

test('parseCodexIncremental folds early unknown token_count into the later model', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'quotern-codex-'));
  const sessionsDir = join(tempHome, '.codex', 'sessions', '2026', '08', '21');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'rollout-unknown-fold.jsonl'),
    [
      '{"type":"session_meta","payload":{"id":"fold-session","cwd":"/Users/dev/alipay-service"}}',
      '{"timestamp":"2026-08-21T02:26:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":20,"output_tokens":5,"total_tokens":25}}}}',
      '{"type":"turn_context","payload":{"model":"deepseek-v4-flash"}}',
      '{"timestamp":"2026-08-21T02:26:30.000Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":30,"output_tokens":10,"total_tokens":40}}}}',
    ].join('\n'),
    'utf8',
  );

  await withIsolatedCodexHome(tempHome, async () => {
    const { result } = await parseCodexIncremental({}, '2026-01-01T00:00:00.000Z');
    assert.equal(result.buckets.length, 1);
    assert.equal(result.buckets[0]?.model, 'deepseek-v4-flash');
    assert.equal(result.buckets[0]?.input_tokens, 50);
    assert.equal(result.buckets[0]?.output_tokens, 15);
    assert.equal(result.buckets[0]?.total_tokens, 65);
  });
});

test('parseCodexIncremental does not lose a record written across two scans', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'quotern-codex-partial-'));
  const sessionsDir = join(tempHome, '.codex', 'sessions', '2026', '06', '09');
  await mkdir(sessionsDir, { recursive: true });
  const filePath = join(sessionsDir, 'rollout-partial.jsonl');

  const meta =
    '{"type":"session_meta","timestamp":"2026-06-09T20:46:00.000Z","payload":{"id":"partial-session","cwd":"/Users/dev/my-app"}}';
  const usage =
    '{"type":"event_msg","timestamp":"2026-06-09T20:46:30.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":50,"cached_input_tokens":0,"output_tokens":10,"reasoning_output_tokens":0,"total_tokens":60},"model":"gpt-5.4"}}}';

  await writeFile(filePath, `${meta}\n${usage.slice(0, 40)}`, 'utf8');

  await withIsolatedCodexHome(tempHome, async () => {
    const first = await parseCodexIncremental({}, '2026-01-01T00:00:00.000Z');
    assert.equal(first.result.eventsParsed, 0);

    await writeFile(filePath, `${meta}\n${usage}\n`, 'utf8');
    const second = await parseCodexIncremental(first.cursors, '2026-01-01T00:00:00.000Z');
    assert.equal(second.result.eventsParsed, 1);
    assert.equal(second.result.buckets[0]?.input_tokens, 50);
    assert.equal(second.result.buckets[0]?.output_tokens, 10);

    const third = await parseCodexIncremental(second.cursors, '2026-01-01T00:00:00.000Z');
    assert.equal(third.result.eventsParsed, 0);
  });
});
