import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test, { type TestContext } from 'node:test';
import { aggregateLocalMetrics } from '../src/local-metrics.js';
import { parseClaudeIncremental } from '../src/parsers/claude.js';
import { parseCodexIncremental } from '../src/parsers/codex.js';
import { parseOpencodeIncremental } from '../src/parsers/opencode.js';
import { parseCursorCsv, recordsToBuckets } from '../src/parsers/cursor.js';
import { resetJsonlWalkCache } from '../src/parsers/shared.js';
import { syncAll } from '../src/sync/index.js';
import { clearCursors, loadRecentBuckets } from '../src/queue/index.js';
import { loadConfig } from '../src/config.js';
import type { CursorsFile } from '../src/types.js';

async function requestHome(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'request-count-'));
  const overrides = {
    HOME: dir,
    USERPROFILE: dir,
    CODEX_HOME: join(dir, '.codex'),
    CLAUDE_CONFIG_DIR: join(dir, '.claude'),
    OPENCODE_HOME: join(dir, 'opencode'),
  };
  const previous = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, overrides);
  resetJsonlWalkCache();
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetJsonlWalkCache();
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

const since = '2020-01-01T00:00:00.000Z';
const stamp = new Date().toISOString();
function claudeLine(id: string | undefined, output = 20) {
  return (
    JSON.stringify({
      type: 'assistant',
      timestamp: stamp,
      message: {
        id,
        model: 'sample-model',
        usage: {
          input_tokens: 100,
          output_tokens: output,
          cache_read_input_tokens: 600,
          cache_creation_input_tokens: 300,
        },
      },
    }) + '\n'
  );
}

test('Claude streaming, restart and truncation preserve one request per identity', async (t) => {
  const dir = await requestHome(t);
  const folder = join(dir, '.claude/projects/sample-project');
  await mkdir(folder, { recursive: true });
  const file = join(folder, 'sample-session.jsonl');
  await writeFile(
    file,
    claudeLine('msg-one') +
      claudeLine('msg-one', 40) +
      claudeLine('msg-two', 40),
  );
  let cursors: CursorsFile = {};
  const first = await parseClaudeIncremental(cursors, since);
  assert.equal(aggregateLocalMetrics(first.result.buckets).requestCount, 2);
  assert.equal(aggregateLocalMetrics(first.result.buckets).outputTokens, 80);
  cursors = JSON.parse(JSON.stringify(cursors)) as CursorsFile;
  await appendFile(file, claudeLine('msg-one', 60));
  const stream = await parseClaudeIncremental(cursors, since);
  assert.equal(aggregateLocalMetrics(stream.result.buckets).requestCount, 0);
  assert.equal(aggregateLocalMetrics(stream.result.buckets).outputTokens, 20);
  await writeFile(file, claudeLine('msg-one', 40));
  assert.equal(
    (await parseClaudeIncremental(cursors, since)).result.eventsParsed,
    0,
  );
  await appendFile(file, claudeLine('msg-one', 60));
  assert.equal(
    (await parseClaudeIncremental(cursors, since)).result.eventsParsed,
    0,
  );
  await appendFile(file, claudeLine(undefined));
  assert.equal(
    aggregateLocalMetrics(
      (await parseClaudeIncremental(cursors, since)).result.buckets,
    ).requestCount,
    null,
  );
});

test('Codex duplicate cumulative notifications differ from equal-size real calls', async (t) => {
  const dir = await requestHome(t);
  const folder = join(dir, '.codex/sessions');
  await mkdir(folder, { recursive: true });
  const file = join(folder, 'sample-rollout.jsonl');
  const codexEvent = (total: number, withLast = true, model = 'sample-model') =>
    JSON.stringify({
      type: 'event_msg',
      timestamp: stamp,
      payload: {
        type: 'token_count',
        info: {
          model,
          total_token_usage: {
            input_tokens: total,
            output_tokens: 0,
            cached_input_tokens: 0,
          },
          ...(withLast
            ? {
                last_token_usage: {
                  input_tokens: 100,
                  output_tokens: 0,
                  cached_input_tokens: 0,
                },
              }
            : {}),
        },
      },
    }) + '\n';
  const meta =
    JSON.stringify({ type: 'session_meta', payload: { id: 'sample-session' } }) +
    '\n';
  await writeFile(
    file,
    meta + codexEvent(100) + codexEvent(100) + codexEvent(200),
  );
  let cursors: CursorsFile = {};
  const first = await parseCodexIncremental(cursors, since);
  assert.equal(aggregateLocalMetrics(first.result.buckets).requestCount, 2);
  assert.equal(
    aggregateLocalMetrics(first.result.buckets).uncachedInputTokens,
    200,
  );
  cursors = JSON.parse(JSON.stringify(cursors)) as CursorsFile;
  await appendFile(file, codexEvent(200));
  assert.equal(
    (await parseCodexIncremental(cursors, since)).result.eventsParsed,
    0,
  );
  await appendFile(file, codexEvent(300, false));
  assert.equal(
    aggregateLocalMetrics(
      (await parseCodexIncremental(cursors, since)).result.buckets,
    ).requestCount,
    null,
  );
  await writeFile(file, meta + codexEvent(100));
  assert.equal(
    (await parseCodexIncremental(cursors, since)).result.eventsParsed,
    0,
  );
});

test('OpenCode message edits count once and independent identical CSV rows count twice', async (t) => {
  const dir = await requestHome(t);
  const folder = join(dir, 'opencode/storage/message/sample-session');
  await mkdir(folder, { recursive: true });
  const file = join(folder, 'sample-message.json');
  const writeMessage = (output: number) =>
    writeFile(
      file,
      JSON.stringify({
        id: 'sample-message',
        sessionID: 'sample-session',
        role: 'assistant',
        modelID: 'sample-model',
        time: { created: Date.now() },
        tokens: {
          input: 10,
          output,
          reasoning: 0,
          cache: { read: 60, write: 30 },
        },
      }),
    );
  const cursors: CursorsFile = {};
  await writeMessage(2);
  assert.equal(
    aggregateLocalMetrics(
      (await parseOpencodeIncremental(cursors, since)).result.buckets,
    ).requestCount,
    1,
  );
  await writeMessage(4);
  const update = aggregateLocalMetrics(
    (await parseOpencodeIncremental(cursors, since)).result.buckets,
  );
  assert.equal(update.requestCount, 0);
  assert.equal(update.outputTokens, 2);
  assert.equal(
    (await parseOpencodeIncremental(cursors, since)).result.eventsParsed,
    0,
  );
  const csv =
    'Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\n';
  const row = `${stamp},sample-model,40,10,60,2,102,0\n`;
  const buckets = recordsToBuckets(parseCursorCsv(csv + row + row), since);
  const metrics = aggregateLocalMetrics(buckets);
  assert.equal(metrics.requestCount, 2);
  assert.equal(metrics.cacheHitRate, 0.6);
  assert.deepEqual(
    recordsToBuckets(parseCursorCsv(csv + row + row), since),
    buckets,
  );
});

test('range rescans replace request totals and subsequent incremental sync adds once', async (t) => {
  const dir = await requestHome(t);
  const folder = join(dir, '.claude/projects/sample-project');
  await mkdir(folder, { recursive: true });
  const file = join(folder, 'sample-session.jsonl');
  await writeFile(file, claudeLine('msg-one'));
  const dataDir = join(dir, 'request-data');
  const { config } = await loadConfig(dataDir);
  config.statsSince = since;
  config.localCollectSince = since;
  await syncAll(dataDir, config, 'claude');
  const readMetrics = async () =>
    aggregateLocalMetrics(await loadRecentBuckets(dataDir, since));
  assert.equal((await readMetrics()).requestCount, 1);
  await clearCursors(dataDir);
  await syncAll(dataDir, config, 'claude');
  assert.equal((await readMetrics()).requestCount, 1);
  await appendFile(file, claudeLine('msg-two'));
  await syncAll(dataDir, config, 'claude');
  assert.equal((await readMetrics()).requestCount, 2);
  await syncAll(dataDir, config, 'claude');
  assert.equal((await readMetrics()).requestCount, 2);
});
