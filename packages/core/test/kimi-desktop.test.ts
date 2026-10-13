import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { parseKimiIncremental } from '../src/parsers/kimi.js';
import { kimiDesktopCodeHome, kimiDesktopDataDir } from '../src/paths.js';
import { isSyncSourcePresent } from '../src/sync/source-presence.js';

const SINCE = '2020-01-01T00:00:00.000Z';
const TIME = Date.parse('2026-10-04T01:00:00.000Z');

async function homes(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'tud-kimi-desktop-'));
  const env = {
    KIMI_CODE_HOME: join(root, 'cli'),
    KIMI_HOME: join(root, 'legacy'),
    KIMI_DESKTOP_HOME: join(root, 'desktop'),
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });
  return {
    ...env,
    desktopCode: join(env.KIMI_DESKTOP_HOME, 'daimon-share', 'daimon', 'runtime', 'kimi-code', 'home'),
  };
}

function step(uuid: string, inputOther = 80) {
  return {
    type: 'context.append_loop_event',
    time: TIME,
    event: {
      type: 'step.end', uuid,
      usage: { inputOther, inputCacheRead: 20, inputCacheCreation: 5, output: 30 },
    },
  };
}

async function wire(home: string, session: string, uuid: string, project: string) {
  const sessionDir = join(home, 'sessions', 'wd_fallback_abc', session);
  const path = join(sessionDir, 'agents', 'main', 'wire.jsonl');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, [
    { type: 'config.update', time: TIME, modelAlias: 'kimi-code/kimi-k2' },
    step(uuid),
    { type: 'usage.record', time: TIME, usage: step(uuid).event.usage },
  ].map((line) => JSON.stringify(line)).join('\n') + '\n');
  await appendFile(join(home, 'session_index.jsonl'), JSON.stringify({ sessionDir, sessionId: session, workDir: join(home, project) }) + '\n');
  return path;
}

async function legacyWire(home: string) {
  const path = join(home, 'sessions', 'workspace', 'legacy-session', 'wire.jsonl');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({
    timestamp: TIME / 1000,
    message: { type: 'StatusUpdate', payload: {
      message_id: 'legacy-event', model: 'kimi-for-coding',
      token_usage: { input_other: 10, output: 5 },
    } },
  }) + '\n');
}

test('Kimi Desktop reads real step usage, resolves its project, and resumes incrementally', async (t) => {
  const dirs = await homes(t);
  const path = await wire(dirs.desktopCode, 'desktop-session', 'desktop-step', 'desktop-project');
  assert.equal(isSyncSourcePresent('kimi'), true);
  const first = await parseKimiIncremental({}, SINCE);
  assert.equal(first.result.eventsParsed, 1);
  assert.equal(first.result.buckets.length, 1);
  assert.equal(first.result.buckets[0]!.source, 'kimi');
  assert.equal(first.result.buckets[0]!.collector, 'kimi-desktop');
  assert.equal(first.result.buckets[0]!.project, 'desktop-project');
  assert.equal(first.result.buckets[0]!.model, 'kimi-k2');
  assert.equal(first.result.buckets[0]!.total_tokens, 135);
  assert.equal((await parseKimiIncremental(first.cursors, SINCE)).result.eventsParsed, 0);
  await appendFile(path, JSON.stringify(step('desktop-next-step', 15)) + '\n');
  const next = await parseKimiIncremental(first.cursors, SINCE);
  assert.equal(next.result.eventsParsed, 1);
  assert.equal(next.result.buckets[0]!.total_tokens, 70);
  assert.equal(next.result.buckets[0]!.model, 'kimi-k2');
});

test('Kimi CLI and Desktop coexist, deduplicate copied events, and retain CLI legacy precedence', async (t) => {
  const dirs = await homes(t);
  await wire(dirs.KIMI_CODE_HOME, 'cli-session', 'shared-step', 'cli-project');
  await wire(dirs.desktopCode, 'copied-session', 'shared-step', 'copied-project');
  await wire(dirs.desktopCode, 'desktop-session', 'desktop-step', 'desktop-project');
  await legacyWire(dirs.KIMI_HOME);
  const { result } = await parseKimiIncremental({}, SINCE);
  assert.equal(result.eventsParsed, 2);
  assert.deepEqual(result.buckets.map((bucket) => [bucket.collector, bucket.project]).sort(), [
    ['kimi-code', 'cli-project'], ['kimi-desktop', 'desktop-project'],
  ]);
  assert.equal(result.buckets.reduce((sum, bucket) => sum + bucket.total_tokens, 0), 270);
});

test('Kimi Desktop does not suppress usage from a legacy-only CLI', async (t) => {
  const dirs = await homes(t);
  await wire(dirs.desktopCode, 'desktop-session', 'desktop-step', 'desktop-project');
  await legacyWire(dirs.KIMI_HOME);
  const { result } = await parseKimiIncremental({}, SINCE);
  assert.equal(result.eventsParsed, 2);
  assert.deepEqual(result.buckets.map((bucket) => bucket.collector).sort(), ['kimi-desktop', 'kimi-legacy']);
});

test('Kimi Desktop context snapshots never become accumulated token usage', async (t) => {
  const dirs = await homes(t);
  const agentDir = join(dirs.KIMI_DESKTOP_HOME, 'kimi-agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'conversation-context-usage.json'), JSON.stringify({ conversation: {
    contextUsage: 0.5, contextTokens: 100_000, maxContextTokens: 200_000,
    remainingContextTokens: 100_000, model: 'kimi-k2', updatedAt: new Date(TIME).toISOString(),
  } }));
  assert.deepEqual((await parseKimiIncremental({}, SINCE)).result.buckets, []);
});

test('Kimi Desktop home override supports tilde expansion', async (t) => {
  await homes(t);
  process.env.KIMI_DESKTOP_HOME = '~/kimi-desktop-fixture';
  assert.equal(kimiDesktopDataDir(), join(homedir(), 'kimi-desktop-fixture'));
  assert.equal(kimiDesktopCodeHome(), join(homedir(), 'kimi-desktop-fixture', 'daimon-share', 'daimon', 'runtime', 'kimi-code', 'home'));
});

test('Kimi Desktop follows an explicitly migrated absolute share directory', async (t) => {
  const dirs = await homes(t);
  const shareDir = join(dirs.KIMI_DESKTOP_HOME, 'migrated-share');
  const codeHome = join(shareDir, 'daimon', 'runtime', 'kimi-code', 'home');
  await wire(codeHome, 'migrated-session', 'migrated-step', 'migrated-project');
  await writeFile(join(dirs.KIMI_DESKTOP_HOME, 'daimon-storage.json'), JSON.stringify({ version: 1, shareDir }));
  assert.equal(kimiDesktopCodeHome(), codeHome);
  assert.equal(isSyncSourcePresent('kimi'), true);
  const { result } = await parseKimiIncremental({}, SINCE);
  assert.equal(result.eventsParsed, 1);
  assert.equal(result.buckets[0]!.project, 'migrated-project');
  assert.equal(result.buckets[0]!.collector, 'kimi-desktop');
});

test('Kimi Desktop ignores malformed or relative storage directory overrides', async (t) => {
  const dirs = await homes(t);
  await mkdir(dirs.KIMI_DESKTOP_HOME, { recursive: true });
  for (const config of ['{', 'null', '{}', '{"shareDir":42}', '{"shareDir":"relative/share"}']) {
    await writeFile(join(dirs.KIMI_DESKTOP_HOME, 'daimon-storage.json'), config);
    assert.equal(kimiDesktopCodeHome(), dirs.desktopCode);
  }
});
