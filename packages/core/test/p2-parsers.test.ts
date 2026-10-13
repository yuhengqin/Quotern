import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { appendFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { parseClineIncremental } from '../src/parsers/cline.js';
import { parseAmpIncremental } from '../src/parsers/amp.js';
import { parseQwenIncremental } from '../src/parsers/qwen.js';
import {
  parseCodebuddyIncremental,
  resolveCodebuddyExtensionMessageFiles,
  tryDecodeCodebuddyBase64Path,
  loadCodebuddyEditorWorkspaceMaps,
} from '../src/parsers/codebuddy.js';
import { parseWorkbuddyIncremental } from '../src/parsers/workbuddy.js';
import { parseGrokBuildIncremental } from '../src/parsers/grok.js';
import { parseMimoIncremental } from '../src/parsers/mimo.js';
import { parseEveryCodeIncremental } from '../src/parsers/every-code.js';
import { isSyncSourcePresent } from '../src/sync/source-presence.js';
import type { CursorsFile } from '../src/types.js';

const SINCE = '2020-01-01T00:00:00.000Z';

test('parseClineIncremental reads api_req_started token columns', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tud-cline-'));
  const extDir = join(root, 'cline-ext');
  const prev = process.env.AI_USAGE_CLINE_ROOTS;
  const prevSessionDir = process.env.CLINE_SESSION_DATA_DIR;
  process.env.AI_USAGE_CLINE_ROOTS = extDir;
  // SDK sessions fall back to ~/.cline when this is unset.
  process.env.CLINE_SESSION_DATA_DIR = join(root, 'no-sdk-sessions');
  try {
    await mkdir(join(extDir, 'state'), { recursive: true });
    await mkdir(join(extDir, 'tasks', 'task-1'), { recursive: true });
    await writeFile(
      join(extDir, 'state', 'taskHistory.json'),
      JSON.stringify([
        {
          id: 'task-1',
          modelId: 'claude-sonnet-4',
          cwdOnTaskInitialization: '/Users/me/demo',
        },
      ]),
    );
    const messages = [
      {
        type: 'say',
        say: 'api_req_started',
        ts: Date.parse('2026-07-24T16:00:00.000Z'),
        text: JSON.stringify({
          tokensIn: 80,
          tokensOut: 30,
          cacheReads: 10,
          cacheWrites: 5,
          model: 'claude-sonnet-4',
        }),
      },
    ];
    await writeFile(join(extDir, 'tasks', 'task-1', 'ui_messages.json'), JSON.stringify(messages));

    const { result } = await parseClineIncremental({}, SINCE);
    assert.equal(result.eventsParsed, 1);
    assert.equal(result.buckets[0]!.source, 'cline');
    assert.equal(result.buckets[0]!.input_tokens, 80);
    assert.equal(result.buckets[0]!.cached_input_tokens, 10);
    assert.equal(result.buckets[0]!.cache_creation_input_tokens, 5);
    assert.equal(result.buckets[0]!.output_tokens, 30);
  } finally {
    if (prev === undefined) delete process.env.AI_USAGE_CLINE_ROOTS;
    else process.env.AI_USAGE_CLINE_ROOTS = prev;
    if (prevSessionDir === undefined) delete process.env.CLINE_SESSION_DATA_DIR;
    else process.env.CLINE_SESSION_DATA_DIR = prevSessionDir;
  }
});

test('parseClineIncremental reads current SDK session metrics incrementally', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tud-cline-sdk-'));
  const sessionsDir = join(root, 'sessions');
  const sessionDir = join(sessionsDir, 'session-1');
  const messagesPath = join(sessionDir, 'session-1.messages.json');
  const prevSessionDir = process.env.CLINE_SESSION_DATA_DIR;
  const prevLegacyRoots = process.env.AI_USAGE_CLINE_ROOTS;
  process.env.CLINE_SESSION_DATA_DIR = sessionsDir;
  process.env.AI_USAGE_CLINE_ROOTS = join(root, 'missing-legacy');

  const messages = [
    {
      id: 'assistant-without-metrics',
      role: 'assistant',
      ts: Date.parse('2026-09-20T08:00:00.000Z'),
      modelInfo: { id: 'deepseek-chat', provider: 'openai-compatible' },
      content: [],
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      ts: Date.parse('2026-09-20T08:16:00.000Z'),
      modelInfo: { id: 'deepseek-reasoner', provider: 'openai-compatible' },
      metrics: {
        inputTokens: 120,
        outputTokens: 40,
        cacheReadTokens: 30,
        cacheWriteTokens: 10,
        cost: 0.01,
      },
      content: [],
    },
  ];

  try {
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'session-1.json'),
      JSON.stringify({
        version: 1,
        session_id: 'session-1',
        cwd: '/Users/me/demo',
        workspace_root: '/Users/me/fallback',
        model: 'manifest-model',
        messages_path: 'session-1.messages.json',
      }),
    );
    await writeFile(
      messagesPath,
      JSON.stringify({ version: 1, updated_at: '2026-09-20T08:16:00.000Z', messages }),
    );

    assert.equal(isSyncSourcePresent('cline'), true);
    const first = await parseClineIncremental({}, SINCE);
    assert.equal(first.result.eventsParsed, 1);
    assert.equal(first.result.filesProcessed, 1);
    assert.deepEqual(first.result.buckets[0], {
      source: 'cline',
      collector: 'cline',
      model: 'deepseek-reasoner',
      project: 'demo',
      hour_start: '2026-09-20T08:00:00.000Z',
      input_tokens: 120,
      output_tokens: 40,
      cached_input_tokens: 30,
      cache_creation_input_tokens: 10,
      reasoning_output_tokens: 0,
      total_tokens: 200,
      conversation_count: 1,
    });

    const unchanged = await parseClineIncremental(first.cursors, SINCE);
    assert.equal(unchanged.result.eventsParsed, 0);
    assert.equal(unchanged.result.filesProcessed, 0);

    messages.push({
      id: 'assistant-2',
      role: 'assistant',
      ts: Date.parse('2026-09-20T08:31:00.000Z'),
      modelInfo: { id: '', provider: 'openai-compatible' },
      metrics: {
        inputTokens: 20,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0,
      },
      content: [],
    });
    await writeFile(
      messagesPath,
      JSON.stringify({ version: 1, updated_at: '2026-09-20T08:31:00.000Z', messages }),
    );

    const appended = await parseClineIncremental(first.cursors, SINCE);
    assert.equal(appended.result.eventsParsed, 1);
    assert.equal(appended.result.buckets[0]!.model, 'manifest-model');
    assert.equal(appended.result.buckets[0]!.hour_start, '2026-09-20T08:30:00.000Z');
    assert.equal(appended.result.buckets[0]!.total_tokens, 25);
  } finally {
    if (prevSessionDir === undefined) delete process.env.CLINE_SESSION_DATA_DIR;
    else process.env.CLINE_SESSION_DATA_DIR = prevSessionDir;
    if (prevLegacyRoots === undefined) delete process.env.AI_USAGE_CLINE_ROOTS;
    else process.env.AI_USAGE_CLINE_ROOTS = prevLegacyRoots;
  }
});

test('parseClineIncremental skips invalid SDK artifacts and events before statsSince', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tud-cline-sdk-invalid-'));
  const sessionsDir = join(root, 'sessions');
  const prevSessionDir = process.env.CLINE_SESSION_DATA_DIR;
  const prevLegacyRoots = process.env.AI_USAGE_CLINE_ROOTS;
  process.env.CLINE_SESSION_DATA_DIR = sessionsDir;
  process.env.AI_USAGE_CLINE_ROOTS = join(root, 'missing-legacy');
  try {
    const corruptDir = join(sessionsDir, 'corrupt');
    const oldDir = join(sessionsDir, 'old');
    await mkdir(corruptDir, { recursive: true });
    await mkdir(oldDir, { recursive: true });
    await writeFile(join(corruptDir, 'corrupt.messages.json'), '{');
    await writeFile(
      join(oldDir, 'old.messages.json'),
      JSON.stringify({
        version: 1,
        messages: [{
          id: 'old-message',
          role: 'assistant',
          ts: Date.parse('2025-01-01T00:00:00.000Z'),
          modelInfo: { id: 'deepseek-chat' },
          metrics: { inputTokens: 10, outputTokens: 5 },
        }],
      }),
    );

    const { result } = await parseClineIncremental({}, '2026-01-01T00:00:00.000Z');
    assert.equal(result.eventsParsed, 0);
    assert.equal(result.buckets.length, 0);
    assert.equal(result.filesProcessed, 1);
  } finally {
    if (prevSessionDir === undefined) delete process.env.CLINE_SESSION_DATA_DIR;
    else process.env.CLINE_SESSION_DATA_DIR = prevSessionDir;
    if (prevLegacyRoots === undefined) delete process.env.AI_USAGE_CLINE_ROOTS;
    else process.env.AI_USAGE_CLINE_ROOTS = prevLegacyRoots;
  }
});

test('parseAmpIncremental reads usageLedger events', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-amp-'));
  const prev = process.env.AMP_DATA_DIR;
  process.env.AMP_DATA_DIR = dir;
  try {
    await writeFile(
      join(dir, 'T-thread-1.json'),
      JSON.stringify({
        id: 'thread-1',
        messages: [],
        usageLedger: {
          events: [
            {
              timestamp: '2026-07-24T10:00:00.000Z',
              tokens: { input: 100, output: 50 },
              model: 'claude-sonnet-4',
            },
          ],
        },
      }),
    );

    const { result } = await parseAmpIncremental({}, SINCE);
    assert.equal(result.eventsParsed, 1);
    assert.equal(result.buckets[0]!.source, 'amp');
    assert.equal(result.buckets[0]!.input_tokens, 100);
    assert.equal(result.buckets[0]!.output_tokens, 50);
  } finally {
    if (prev === undefined) delete process.env.AMP_DATA_DIR;
    else process.env.AMP_DATA_DIR = prev;
  }
});

test('parseQwenIncremental subtracts cached and thoughts from usageMetadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-qwen-'));
  const prev = process.env.QWEN_TMP_DIR;
  process.env.QWEN_TMP_DIR = dir;
  try {
    const chatsDir = join(dir, 'proj1', 'chats');
    await mkdir(chatsDir, { recursive: true });
    await writeFile(
      join(chatsDir, 'session.jsonl'),
      JSON.stringify({
        type: 'assistant',
        uuid: 'u1',
        timestamp: '2026-07-24T10:00:00.000Z',
        model: 'qwen-max',
        usageMetadata: {
          promptTokenCount: 120,
          candidatesTokenCount: 60,
          cachedContentTokenCount: 20,
          thoughtsTokenCount: 10,
        },
      }) + '\n',
    );

    const { result } = await parseQwenIncremental({}, SINCE);
    assert.equal(result.eventsParsed, 1);
    assert.equal(result.buckets[0]!.source, 'qwen');
    assert.equal(result.buckets[0]!.input_tokens, 100);
    assert.equal(result.buckets[0]!.cached_input_tokens, 20);
    assert.equal(result.buckets[0]!.output_tokens, 50);
    assert.equal(result.buckets[0]!.reasoning_output_tokens, 10);
  } finally {
    if (prev === undefined) delete process.env.QWEN_TMP_DIR;
    else process.env.QWEN_TMP_DIR = prev;
  }
});

test('parseWorkbuddyIncremental subtracts cacheRead and cacheCreate from prompt', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-wb-'));
  const prev = process.env.WORKBUDDY_HOME;
  process.env.WORKBUDDY_HOME = home;
  try {
    const projects = join(home, 'projects');
    await mkdir(projects, { recursive: true });
    const filePath = join(projects, 'sess-a.jsonl');
    await writeFile(
      filePath,
      JSON.stringify({
        sessionId: 'sess-a',
        id: 'm1',
        timestamp: Date.parse('2026-07-24T11:00:00.000Z'),
        providerData: {
          model: 'wb-model',
          rawUsage: {
            prompt_tokens: 100,
            completion_tokens: 40,
            cache_read_input_tokens: 15,
            cache_creation_input_tokens: 5,
          },
        },
      }) + '\n',
    );

    const { result } = await parseWorkbuddyIncremental({}, SINCE, {
      projectFiles: [filePath],
      defaultModel: 'auto',
    });
    assert.equal(result.eventsParsed, 1);
    assert.equal(result.buckets[0]!.source, 'workbuddy');
    assert.equal(result.buckets[0]!.input_tokens, 80);
    assert.equal(result.buckets[0]!.cached_input_tokens, 15);
    assert.equal(result.buckets[0]!.cache_creation_input_tokens, 5);
    assert.equal(result.buckets[0]!.output_tokens, 40);
    // No workbuddy.db → no cwd source → project stays unknown.
    assert.equal(result.buckets[0]!.project, 'unknown');
  } finally {
    if (prev === undefined) delete process.env.WORKBUDDY_HOME;
    else process.env.WORKBUDDY_HOME = prev;
  }
});

test('parseWorkbuddyIncremental derives project from entry cwd and rescans legacy cursors', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-wb2-'));
  const prev = process.env.WORKBUDDY_HOME;
  process.env.WORKBUDDY_HOME = home;
  try {
    const projects = join(home, 'projects');
    await mkdir(projects, { recursive: true });
    const filePath = join(projects, 'sess-b.jsonl');
    await writeFile(
      filePath,
      JSON.stringify({
        sessionId: 'sess-b',
        id: 'm1',
        cwd: '/Users/me/wb-demo',
        timestamp: Date.parse('2026-07-24T11:00:00.000Z'),
        providerData: {
          model: 'wb-model',
          rawUsage: {
            prompt_tokens: 90,
            completion_tokens: 10,
          },
        },
      }) + '\n',
    );

    // Legacy cursor state predating cwd attribution: consumed offsets, no marker.
    const legacyCursors = {
      workbuddy: {
        seenIds: [],
        fileOffsets: { [filePath]: { size: 999, mtimeMs: 0, ino: 0 } },
        sqliteSessions: {},
        detailedSessions: {},
      },
    } as CursorsFile;

    const { result, cursors } = await parseWorkbuddyIncremental(legacyCursors, SINCE, {
      projectFiles: [filePath],
      defaultModel: 'auto',
      fullRescan: true,
    });
    assert.equal(result.fullRescan, true);
    assert.equal(result.eventsParsed, 1);
    assert.equal(result.buckets[0]!.source, 'workbuddy');
    assert.equal(result.buckets[0]!.project, 'wb-demo');
    assert.equal(
      (cursors as { workbuddy?: { cwdProjects?: boolean } }).workbuddy?.cwdProjects,
      true,
    );

    // Marker present → incremental pass, no rescan flag.
    const second = await parseWorkbuddyIncremental(cursors, SINCE, {
      projectFiles: [filePath],
      defaultModel: 'auto',
    });
    assert.notEqual(second.result.fullRescan, true);
    assert.equal(second.result.eventsParsed, 0);
  } finally {
    if (prev === undefined) delete process.env.WORKBUDDY_HOME;
    else process.env.WORKBUDDY_HOME = prev;
  }
});

test('parseWorkbuddyIncremental skips legacy cursor reset unless fullRescan requested', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-wb3-'));
  const prev = process.env.WORKBUDDY_HOME;
  process.env.WORKBUDDY_HOME = home;
  try {
    const projects = join(home, 'projects');
    await mkdir(projects, { recursive: true });
    const filePath = join(projects, 'sess-c.jsonl');
    const line =
      JSON.stringify({
        sessionId: 'sess-c',
        id: 'm1',
        cwd: '/Users/me/wb-demo',
        timestamp: Date.parse('2026-07-24T11:00:00.000Z'),
        providerData: {
          model: 'wb-model',
          rawUsage: { prompt_tokens: 90, completion_tokens: 10 },
        },
      }) + '\n';
    await writeFile(filePath, line);
    const consumed = statSync(filePath);

    const legacyCursors = {
      workbuddy: {
        seenIds: ['m1'],
        fileOffsets: {
          [filePath]: { size: consumed.size, mtimeMs: consumed.mtimeMs, ino: consumed.ino },
        },
        sqliteSessions: {},
        detailedSessions: { 'sess-c': true },
      },
    } as CursorsFile;

    const { result } = await parseWorkbuddyIncremental(legacyCursors, SINCE, {
      projectFiles: [filePath],
      defaultModel: 'auto',
    });
    assert.notEqual(result.fullRescan, true);
    assert.equal(result.eventsParsed, 0);
  } finally {
    if (prev === undefined) delete process.env.WORKBUDDY_HOME;
    else process.env.WORKBUDDY_HOME = prev;
  }
});

test('parseWorkbuddyIncremental resolves JSONL projects via sessions.cwd', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-wb-proj-'));
  const prev = process.env.WORKBUDDY_HOME;
  process.env.WORKBUDDY_HOME = home;
  try {
    const db = new DatabaseSync(join(home, 'workbuddy.db'));
    db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, cwd TEXT)');
    db.prepare('INSERT INTO sessions (id, model, cwd) VALUES (?, ?, ?)').run(
      'sess-a',
      'wb-model',
      '/Users/me/wb-app',
    );
    db.close();

    const projects = join(home, 'projects');
    await mkdir(projects, { recursive: true });
    const filePath = join(projects, 'sess-a.jsonl');
    const message = (sessionId: string, id: string) =>
      JSON.stringify({
        sessionId,
        id,
        timestamp: Date.parse('2026-07-24T11:00:00.000Z'),
        providerData: {
          model: 'wb-model',
          rawUsage: { prompt_tokens: 100, completion_tokens: 40 },
        },
      }) + '\n';
    await writeFile(filePath, message('sess-a', 'm1') + message('sess-nodb', 'm2'));

    const { result } = await parseWorkbuddyIncremental({}, SINCE, {
      projectFiles: [filePath],
      defaultModel: 'auto',
    });
    assert.equal(result.eventsParsed, 2);
    const byProject = new Map(result.buckets.map((b) => [b.project, b]));
    // cwd path does not exist → git lookup falls back to basename.
    assert.ok(byProject.has('wb-app'));
    // Session without a sessions row keeps 'unknown'.
    assert.ok(byProject.has('unknown'));
  } finally {
    if (prev === undefined) delete process.env.WORKBUDDY_HOME;
    else process.env.WORKBUDDY_HOME = prev;
  }
});

test('parseWorkbuddyIncremental sqlite fallback uses queried cwd', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-wb-sql-'));
  const prev = process.env.WORKBUDDY_HOME;
  process.env.WORKBUDDY_HOME = home;
  try {
    const db = new DatabaseSync(join(home, 'workbuddy.db'));
    db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, cwd TEXT)');
    db.exec(
      'CREATE TABLE session_usage (session_id TEXT PRIMARY KEY, used INTEGER, updated_at INTEGER)',
    );
    const insertSession = db.prepare(
      'INSERT INTO sessions (id, model, cwd) VALUES (?, ?, ?)',
    );
    insertSession.run('s1', 'model-a', '/Users/me/wb-sql-app');
    insertSession.run('s2', 'model-b', '');
    const insertUsage = db.prepare(
      'INSERT INTO session_usage (session_id, used, updated_at) VALUES (?, ?, ?)',
    );
    const ts = Date.parse('2026-07-24T12:00:00.000Z');
    insertUsage.run('s1', 100, ts);
    insertUsage.run('s2', 50, ts);
    // s3 has usage but no sessions row (LEFT JOIN miss → cwd null).
    insertUsage.run('s3', 30, ts);
    db.close();

    const { result } = await parseWorkbuddyIncremental({}, SINCE, {
      projectFiles: [],
      defaultModel: 'auto',
    });
    assert.equal(result.eventsParsed, 3);
    const byModel = new Map(result.buckets.map((b) => [b.model, b]));
    assert.equal(byModel.get('model-a')!.project, 'wb-sql-app');
    assert.equal(byModel.get('model-a')!.input_tokens, 100);
    // Empty cwd and missing sessions row both stay 'unknown'.
    assert.equal(byModel.get('model-b')!.project, 'unknown');
    assert.equal(byModel.get('auto')!.project, 'unknown');
    assert.equal(byModel.get('auto')!.input_tokens, 30);
  } finally {
    if (prev === undefined) delete process.env.WORKBUDDY_HOME;
    else process.env.WORKBUDDY_HOME = prev;
  }
});

test('parseCodebuddyIncremental subtracts cached tokens from prompt', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-cb-'));
  const prev = process.env.CODEBUDDY_HOME;
  process.env.CODEBUDDY_HOME = home;
  try {
    const projects = join(home, 'projects');
    await mkdir(projects, { recursive: true });
    const filePath = join(projects, 'sess-b.jsonl');
    await writeFile(
      filePath,
      JSON.stringify({
        type: 'message',
        role: 'assistant',
        uuid: 'm1',
        timestamp: Date.parse('2026-07-24T12:00:00.000Z'),
        providerData: {
          model: 'cb-model',
          rawUsage: {
            prompt_tokens: 100,
            completion_tokens: 40,
            prompt_tokens_details: { cached_tokens: 25 },
            cache_creation_input_tokens: 3,
          },
        },
      }) + '\n',
    );

    const { result } = await parseCodebuddyIncremental({}, SINCE, {
      projectFiles: [filePath],
      defaultModel: 'codebuddy-unknown',
    });
    assert.equal(result.eventsParsed, 1);
    assert.equal(result.buckets[0]!.source, 'codebuddy');
    assert.equal(result.buckets[0]!.input_tokens, 75);
    assert.equal(result.buckets[0]!.cached_input_tokens, 25);
    assert.equal(result.buckets[0]!.cache_creation_input_tokens, 3);
  } finally {
    if (prev === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = prev;
  }
});

test('parseCodebuddyIncremental reads App / extension history messages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tud-cb-ext-'));
  const messagesDir = join(
    root,
    'user-1',
    'CodeBuddyIDE',
    'user-1',
    'history',
    'ws-md5',
    'sess-1',
    'messages',
  );
  await mkdir(messagesDir, { recursive: true });

  // A real model call: usage lives in `extra` (serialized JSON string).
  await writeFile(
    join(messagesDir, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json'),
    JSON.stringify({
      id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      role: 'assistant',
      createdAt: '2026-09-20T08:13:32.746Z',
      message: '{"role":"assistant","content":[]}',
      extra: JSON.stringify({
        modelId: 'hy4-preview-f',
        modelName: 'Hy4 preview',
        lastStepInputTokens: 1000,
        lastStepOutputTokens: 40,
        lastStepCachedInputTokens: 800,
      }),
    }),
  );
  // Assistant step with no model call (tool / intermediate state) → ignored.
  await writeFile(
    join(messagesDir, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json'),
    JSON.stringify({
      id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      role: 'assistant',
      createdAt: '2026-09-20T08:13:40.000Z',
      extra: JSON.stringify({ modelId: 'hy4-preview-f', toolStatus: 'done' }),
    }),
  );
  await writeFile(
    join(messagesDir, 'cccccccccccccccccccccccccccccccc.json'),
    JSON.stringify({
      id: 'cccccccccccccccccccccccccccccccc',
      role: 'user',
      createdAt: '2026-09-20T08:13:30.000Z',
      extra: '{}',
    }),
  );

  const prev = process.env.CODEBUDDY_EXTENSION_ROOTS;
  process.env.CODEBUDDY_EXTENSION_ROOTS = root;
  try {
    const files = resolveCodebuddyExtensionMessageFiles();
    assert.equal(files.length, 3);
    assert.equal(files[0]!.host, 'CodeBuddyIDE');
    assert.equal(files[0]!.sessionId, 'sess-1');
    assert.equal(files[0]!.workspaceId, 'ws-md5');
    assert.equal(files[0]!.pathHint, null);

    const { result, cursors } = await parseCodebuddyIncremental({}, SINCE, {
      projectFiles: [], // keep the CLI channel off real ~/.codebuddy data
      extensionFiles: files,
      sessionCwds: new Map([['sess-1', '/Users/lishanbing/workspace/Quotern']]),
      defaultModel: 'codebuddy-unknown',
    });
    assert.equal(result.eventsParsed, 1);
    const bucket = result.buckets.find((b) => b.source === 'codebuddy')!;
    assert.equal(bucket.model, 'hy4-preview-f');
    assert.equal(bucket.input_tokens, 200); // 1000 - 800 cached
    assert.equal(bucket.cached_input_tokens, 800);
    assert.equal(bucket.output_tokens, 40);
    assert.equal(bucket.total_tokens, 1040);
    assert.equal(bucket.project, 'Quotern');

    // Re-running with the same cursors must not double-count (mtime gate).
    const second = await parseCodebuddyIncremental(cursors, SINCE, {
      projectFiles: [],
      extensionFiles: files,
      sessionCwds: new Map([['sess-1', '/Users/lishanbing/workspace/Quotern']]),
      defaultModel: 'codebuddy-unknown',
    });
    assert.equal(second.result.eventsParsed, 0);
  } finally {
    if (prev === undefined) delete process.env.CODEBUDDY_EXTENSION_ROOTS;
    else process.env.CODEBUDDY_EXTENSION_ROOTS = prev;
  }
});

test('parseCodebuddyIncremental prefers statsSnapshot over lastStep usage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tud-cb-snapshot-'));
  const messagesDir = join(
    root,
    'user-1',
    'CodeBuddyIDE',
    'user-1',
    'history',
    'ws-md5',
    'sess-1',
    'messages',
  );
  await mkdir(messagesDir, { recursive: true });

  // A reply whose agent loop ran many steps: `lastStep*` is only the final
  // call, `statsSnapshot` is the whole-loop total the UI shows.
  await writeFile(
    join(messagesDir, 'dddddddddddddddddddddddddddddddd.json'),
    JSON.stringify({
      id: 'dddddddddddddddddddddddddddddddd',
      role: 'assistant',
      createdAt: '2026-09-20T08:13:32.746Z',
      message: '{"role":"assistant","content":[]}',
      extra: JSON.stringify({
        modelId: 'hy4-preview-f',
        lastStepInputTokens: 1000,
        lastStepOutputTokens: 40,
        lastStepCachedInputTokens: 800,
        statsSnapshot: {
          inputTokens: 500_000,
          outputTokens: 8_000,
          cachedInputTokens: 460_000,
          cacheMissTokens: 40_000,
          cacheWriteTokens: 500,
          thinkingTokens: 3_000,
          credit: 0,
        },
      }),
    }),
  );

  const files = resolveCodebuddyExtensionMessageFiles({
    ...process.env,
    CODEBUDDY_EXTENSION_ROOTS: root,
  });
  const { result } = await parseCodebuddyIncremental({}, SINCE, {
    projectFiles: [],
    extensionFiles: files,
    sessionCwds: new Map([['sess-1', '/Users/lishanbing/workspace/Quotern']]),
    defaultModel: 'codebuddy-unknown',
  });
  assert.equal(result.eventsParsed, 1);
  const bucket = result.buckets.find((b) => b.source === 'codebuddy')!;
  assert.equal(bucket.input_tokens, 40_000); // cacheMissTokens, not lastStep input
  assert.equal(bucket.cached_input_tokens, 460_000);
  assert.equal(bucket.cache_creation_input_tokens, 500);
  assert.equal(bucket.output_tokens, 8_000);
  assert.equal(bucket.reasoning_output_tokens, 3_000);
  assert.equal(bucket.total_tokens, 511_500);
});

test('parseCodebuddyIncremental falls back to lastStep when snapshot is empty', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tud-cb-snapshot-zero-'));
  const messagesDir = join(
    root,
    'user-1',
    'CodeBuddyIDE',
    'user-1',
    'history',
    'ws-md5',
    'sess-1',
    'messages',
  );
  await mkdir(messagesDir, { recursive: true });

  await writeFile(
    join(messagesDir, 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.json'),
    JSON.stringify({
      id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      role: 'assistant',
      createdAt: '2026-09-20T08:13:32.746Z',
      extra: JSON.stringify({
        modelId: 'hy4-preview-f',
        lastStepInputTokens: 1000,
        lastStepOutputTokens: 40,
        lastStepCachedInputTokens: 800,
        statsSnapshot: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      }),
    }),
  );

  const files = resolveCodebuddyExtensionMessageFiles({
    ...process.env,
    CODEBUDDY_EXTENSION_ROOTS: root,
  });
  const { result } = await parseCodebuddyIncremental({}, SINCE, {
    projectFiles: [],
    extensionFiles: files,
    sessionCwds: new Map([['sess-1', '/Users/lishanbing/workspace/Quotern']]),
    defaultModel: 'codebuddy-unknown',
  });
  assert.equal(result.eventsParsed, 1);
  const bucket = result.buckets.find((b) => b.source === 'codebuddy')!;
  assert.equal(bucket.input_tokens, 200); // 1000 - 800 cached
  assert.equal(bucket.cached_input_tokens, 800);
  assert.equal(bucket.output_tokens, 40);
  assert.equal(bucket.total_tokens, 1040);
});

test('parseCodebuddyIncremental attributes plugin sessions via genie-history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tud-cb-plugin-'));
  const cwd = '/Users/sugar/Documents/github/Quotern';
  const workspaceId = createHash('md5').update(cwd, 'utf8').digest('hex');
  const pathB64 = Buffer.from(cwd, 'utf8').toString('base64url');
  const sessionId = 'sess-plugin-1';

  const messagesDir = join(
    root,
    'ext',
    'user-uuid',
    'VSCode',
    'user-uuid',
    'history',
    workspaceId,
    sessionId,
    'messages',
  );
  await mkdir(messagesDir, { recursive: true });
  await writeFile(
    join(messagesDir, 'msg1.json'),
    JSON.stringify({
      id: 'msg1',
      role: 'assistant',
      createdAt: '2026-09-21T08:58:02.256Z',
      extra: JSON.stringify({
        modelId: 'auto',
        lastStepInputTokens: 100,
        lastStepOutputTokens: 10,
        lastStepCachedInputTokens: 0,
      }),
    }),
  );

  const genieRoot = join(root, 'genie');
  const convDir = join(genieRoot, pathB64, 'conversations', sessionId);
  await mkdir(convDir, { recursive: true });
  await writeFile(
    join(genieRoot, pathB64, 'current.json'),
    JSON.stringify({ conversationId: sessionId }),
  );

  assert.equal(tryDecodeCodebuddyBase64Path(pathB64), cwd);
  const maps = loadCodebuddyEditorWorkspaceMaps({
    ...process.env,
    CODEBUDDY_GENIE_HISTORY_ROOTS: genieRoot,
  });
  assert.equal(maps.sessionCwds.get(sessionId), cwd);
  assert.equal(maps.workspaceCwds.get(workspaceId), cwd);

  const files = resolveCodebuddyExtensionMessageFiles({
    ...process.env,
    CODEBUDDY_EXTENSION_ROOTS: join(root, 'ext'),
  });
  assert.equal(files.length, 1);
  assert.equal(files[0]!.pathHint, null); // logged-in tree: parent of history is user uuid
  assert.equal(files[0]!.workspaceId, workspaceId);

  const { result } = await parseCodebuddyIncremental({}, SINCE, {
    projectFiles: [],
    extensionFiles: files,
    sessionCwds: maps.sessionCwds,
    workspaceCwds: maps.workspaceCwds,
    defaultModel: 'codebuddy-unknown',
  });
  assert.equal(result.eventsParsed, 1);
  const bucket = result.buckets.find((b) => b.source === 'codebuddy')!;
  assert.equal(bucket.project, 'Quotern');
  assert.equal(bucket.model, 'auto');
});

test('parseCodebuddyIncremental uses base64 pathHint on anonymous extension trees', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tud-cb-anon-'));
  const cwd = '/Users/sugar/Documents/github/Quotern';
  const pathB64 = Buffer.from(cwd, 'utf8').toString('base64url');
  const messagesDir = join(root, 'default', 'VSCode', pathB64, 'history', 'ws1', 'sess-a', 'messages');
  await mkdir(messagesDir, { recursive: true });
  await writeFile(
    join(messagesDir, 'msg-a.json'),
    JSON.stringify({
      id: 'msg-a',
      role: 'assistant',
      createdAt: '2026-09-21T08:58:02.256Z',
      extra: JSON.stringify({
        modelId: 'deepseek-v4-flash',
        lastStepInputTokens: 50,
        lastStepOutputTokens: 5,
        lastStepCachedInputTokens: 0,
      }),
    }),
  );

  const files = resolveCodebuddyExtensionMessageFiles({
    ...process.env,
    CODEBUDDY_EXTENSION_ROOTS: root,
  });
  assert.equal(files[0]!.pathHint, cwd);

  const { result } = await parseCodebuddyIncremental({}, SINCE, {
    projectFiles: [],
    extensionFiles: files,
    sessionCwds: new Map(),
    workspaceCwds: new Map(),
    defaultModel: 'codebuddy-unknown',
  });
  assert.equal(result.eventsParsed, 1);
  assert.equal(result.buckets[0]!.project, 'Quotern');
});

test('loadCodebuddyEditorWorkspaceMaps reads current.json without conversations dir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tud-cb-current-'));
  const cwd = '/Users/sugar/Documents/github/ai-usage';
  const pathB64 = Buffer.from(cwd, 'utf8').toString('base64url');
  const sessionId = 'sess-from-current';
  await mkdir(join(root, pathB64), { recursive: true });
  await writeFile(
    join(root, pathB64, 'current.json'),
    JSON.stringify({ conversationId: sessionId, lastUpdated: '2026-09-21T00:00:00.000Z' }),
  );

  const maps = loadCodebuddyEditorWorkspaceMaps({
    ...process.env,
    CODEBUDDY_GENIE_HISTORY_ROOTS: root,
  });
  assert.equal(maps.sessionCwds.get(sessionId), cwd);
  assert.equal(
    maps.workspaceCwds.get(createHash('md5').update(cwd, 'utf8').digest('hex')),
    cwd,
  );
});

test('tryDecodeCodebuddyBase64Path accepts paths and rejects noise', () => {
  const unix = '/Users/sugar/Documents/github/Quotern';
  const win = 'C:\\Users\\sugar\\proj';
  assert.equal(tryDecodeCodebuddyBase64Path(Buffer.from(unix, 'utf8').toString('base64url')), unix);
  assert.equal(tryDecodeCodebuddyBase64Path(Buffer.from(unix, 'utf8').toString('base64')), unix);
  assert.equal(tryDecodeCodebuddyBase64Path(Buffer.from(win, 'utf8').toString('base64url')), win);
  assert.equal(
    tryDecodeCodebuddyBase64Path(Buffer.from(`${unix}/`, 'utf8').toString('base64url')),
    unix,
  );
  assert.equal(tryDecodeCodebuddyBase64Path('3379f4bd-e71f-4e60-a935-387b53cba6a4'), null);
  assert.equal(tryDecodeCodebuddyBase64Path('short'), null);
  assert.equal(tryDecodeCodebuddyBase64Path('VSCode'), null);
  assert.equal(tryDecodeCodebuddyBase64Path('user-1'), null);
});

test('parseCodebuddyIncremental falls back to workspace md5 when session is unknown', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-cb-ws-'));
  const cwd = '/Users/sugar/Documents/github/Quotern';
  const workspaceId = createHash('md5').update(cwd, 'utf8').digest('hex');
  const msgFile = join(dir, 'ws-only-msg.json');
  const files = [
    {
      file: msgFile,
      host: 'VSCode',
      sessionId: 'orphan-session',
      workspaceId,
      pathHint: null as string | null,
    },
  ];
  await writeFile(
    msgFile,
    JSON.stringify({
      id: 'ws-only-1',
      role: 'assistant',
      createdAt: '2026-09-21T09:00:00.000Z',
      extra: JSON.stringify({
        modelId: 'auto',
        lastStepInputTokens: 10,
        lastStepOutputTokens: 2,
        lastStepCachedInputTokens: 0,
      }),
    }),
  );

  const { result } = await parseCodebuddyIncremental({}, SINCE, {
    projectFiles: [],
    extensionFiles: files,
    sessionCwds: new Map(),
    workspaceCwds: new Map([[workspaceId, cwd]]),
    defaultModel: 'codebuddy-unknown',
  });
  assert.equal(result.eventsParsed, 1);
  assert.equal(result.buckets[0]!.project, 'Quotern');
});

test('parseCodebuddyIncremental prefers session cwd over workspace and pathHint', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-cb-prio-'));
  const sessionCwd = '/Users/sugar/Documents/github/Quotern';
  const otherCwd = '/Users/sugar/Documents/github/other-repo';
  const workspaceId = createHash('md5').update(otherCwd, 'utf8').digest('hex');
  const msgFile = join(dir, 'prio-msg.json');
  const files = [
    {
      file: msgFile,
      host: 'VSCode',
      sessionId: 'sess-priority',
      workspaceId,
      pathHint: otherCwd as string | null,
    },
  ];
  await writeFile(
    msgFile,
    JSON.stringify({
      id: 'prio-1',
      role: 'assistant',
      createdAt: '2026-09-21T09:00:00.000Z',
      extra: JSON.stringify({
        modelId: 'auto',
        lastStepInputTokens: 10,
        lastStepOutputTokens: 2,
        lastStepCachedInputTokens: 0,
      }),
    }),
  );

  const { result } = await parseCodebuddyIncremental({}, SINCE, {
    projectFiles: [],
    extensionFiles: files,
    sessionCwds: new Map([['sess-priority', sessionCwd]]),
    workspaceCwds: new Map([[workspaceId, otherCwd]]),
    defaultModel: 'codebuddy-unknown',
  });
  assert.equal(result.buckets[0]!.project, 'Quotern');
});

test('parseCodebuddyIncremental auto-loads genie-history maps from env', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tud-cb-autoload-'));
  const cwd = '/Users/sugar/Documents/github/Quotern';
  const workspaceId = createHash('md5').update(cwd, 'utf8').digest('hex');
  const pathB64 = Buffer.from(cwd, 'utf8').toString('base64url');
  const sessionId = 'sess-autoload';
  const userId = '3379f4bd-e71f-4e60-a935-387b53cba6a4';

  const messagesDir = join(
    root,
    'ext',
    userId,
    'VSCode',
    userId,
    'history',
    workspaceId,
    sessionId,
    'messages',
  );
  await mkdir(messagesDir, { recursive: true });
  await writeFile(
    join(messagesDir, 'auto.json'),
    JSON.stringify({
      id: 'auto-msg',
      role: 'assistant',
      createdAt: '2026-09-21T09:10:00.000Z',
      extra: JSON.stringify({
        modelId: 'auto',
        lastStepInputTokens: 20,
        lastStepOutputTokens: 3,
        lastStepCachedInputTokens: 0,
      }),
    }),
  );

  const genieRoot = join(root, 'genie');
  await mkdir(join(genieRoot, pathB64, 'conversations', sessionId), { recursive: true });

  const env = {
    ...process.env,
    CODEBUDDY_EXTENSION_ROOTS: join(root, 'ext'),
    CODEBUDDY_GENIE_HISTORY_ROOTS: genieRoot,
    CODEBUDDY_APP_SESSIONS_DB: join(root, 'no-such-sessions.vscdb'),
  };
  const files = resolveCodebuddyExtensionMessageFiles(env);
  assert.equal(files.length, 1);
  assert.equal(files[0]!.pathHint, null); // real UUID above history

  // No injected maps — parser must discover genie-history via env.
  const { result } = await parseCodebuddyIncremental({}, SINCE, {
    env,
    projectFiles: [],
    extensionFiles: files,
    defaultModel: 'codebuddy-unknown',
  });
  assert.equal(result.eventsParsed, 1);
  assert.equal(result.buckets[0]!.project, 'Quotern');
});

test('parseCodebuddyIncremental leaves project unknown without cwd sources', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-cb-unk-'));
  const msgFile = join(dir, 'unk-msg.json');
  const files = [
    {
      file: msgFile,
      host: 'VSCode',
      sessionId: 'sess-none',
      workspaceId: 'deadbeefdeadbeefdeadbeefdeadbeef',
      pathHint: null as string | null,
    },
  ];
  await writeFile(
    msgFile,
    JSON.stringify({
      id: 'unk-1',
      role: 'assistant',
      createdAt: '2026-09-21T09:00:00.000Z',
      extra: JSON.stringify({
        modelId: 'auto',
        lastStepInputTokens: 10,
        lastStepOutputTokens: 1,
        lastStepCachedInputTokens: 0,
      }),
    }),
  );

  const { result } = await parseCodebuddyIncremental({}, SINCE, {
    projectFiles: [],
    extensionFiles: files,
    sessionCwds: new Map(),
    workspaceCwds: new Map(),
    defaultModel: 'codebuddy-unknown',
  });
  assert.equal(result.buckets[0]!.project, 'unknown');
});

test('isSyncSourcePresent codebuddy gates on extension data or projects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tud-cb-presence-'));
  const emptyHome = join(root, 'home-empty');
  await mkdir(emptyHome, { recursive: true });
  const extRoot = join(root, 'ext-data');
  await mkdir(extRoot, { recursive: true });
  await writeFile(join(extRoot, 'marker'), '1');

  const prevExt = process.env.CODEBUDDY_EXTENSION_ROOTS;
  const prevHome = process.env.CODEBUDDY_HOME;
  try {
    process.env.CODEBUDDY_HOME = emptyHome;
    process.env.CODEBUDDY_EXTENSION_ROOTS = join(root, 'missing-ext');
    assert.equal(isSyncSourcePresent('codebuddy'), false);

    process.env.CODEBUDDY_EXTENSION_ROOTS = extRoot;
    assert.equal(isSyncSourcePresent('codebuddy'), true);

    process.env.CODEBUDDY_EXTENSION_ROOTS = join(root, 'missing-ext');
    await mkdir(join(emptyHome, 'projects'), { recursive: true });
    assert.equal(isSyncSourcePresent('codebuddy'), true);
  } finally {
    if (prevExt === undefined) delete process.env.CODEBUDDY_EXTENSION_ROOTS;
    else process.env.CODEBUDDY_EXTENSION_ROOTS = prevExt;
    if (prevHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = prevHome;
  }
});

test('parseMimoIncremental keeps mimo rows and drops anthropic mirror', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-mimo-'));
  const dbPath = join(dir, 'mimocode.db');
  const prev = process.env.MIMO_DB_PATH;
  process.env.MIMO_DB_PATH = dbPath;
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      data TEXT
    )`);
    const native = {
      role: 'assistant',
      providerID: 'mimo',
      modelID: 'mimo-v2',
      time: { created: Date.parse('2026-07-24T13:00:00.000Z') },
      tokens: { input: 30, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
      path: { root: '/tmp/mimo' },
    };
    const foreign = {
      ...native,
      providerID: 'anthropic',
      modelID: 'claude-opus-4',
    };
    db.prepare('INSERT INTO message VALUES (?, ?, ?)').run('m1', 'ses1', JSON.stringify(native));
    db.prepare('INSERT INTO message VALUES (?, ?, ?)').run('m2', 'ses1', JSON.stringify(foreign));
    db.close();

    const { result } = await parseMimoIncremental({}, SINCE);
    assert.equal(result.eventsParsed, 1);
    assert.equal(result.buckets[0]!.source, 'mimo');
    assert.equal(result.buckets[0]!.model, 'mimo-v2');
    assert.equal(result.buckets[0]!.input_tokens, 30);
  } finally {
    if (prev === undefined) delete process.env.MIMO_DB_PATH;
    else process.env.MIMO_DB_PATH = prev;
  }
});

test('parseEveryCodeIncremental emits cumulative token_count deltas', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-ec-'));
  const prev = process.env.AI_USAGE_EVERY_CODE_HOME;
  process.env.AI_USAGE_EVERY_CODE_HOME = home;
  try {
    const sessions = join(home, 'sessions');
    await mkdir(sessions, { recursive: true });
    const rolloutPath = join(sessions, '2026_sess.jsonl');
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        payload: { id: 'sess-ec-1', cwd: '/tmp/every-code' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-07-24T14:00:00.000Z',
        payload: {
          type: 'token_count',
          info: {
            model: 'gpt-5',
            total_token_usage: { input_tokens: 100, output_tokens: 50 },
          },
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-07-24T14:30:00.000Z',
        payload: {
          type: 'token_count',
          info: {
            model: 'gpt-5',
            total_token_usage: { input_tokens: 150, output_tokens: 80 },
          },
        },
      }),
    ];
    await writeFile(rolloutPath, lines.join('\n') + '\n');

    const { result } = await parseEveryCodeIncremental({}, SINCE);
    assert.equal(result.eventsParsed, 2);
    assert.equal(result.buckets[0]!.source, 'every-code');
    const inputTotal = result.buckets.reduce((sum, b) => sum + b.input_tokens, 0);
    const outputTotal = result.buckets.reduce((sum, b) => sum + b.output_tokens, 0);
    assert.equal(inputTotal, 150);
    assert.equal(outputTotal, 80);
  } finally {
    if (prev === undefined) delete process.env.AI_USAGE_EVERY_CODE_HOME;
    else process.env.AI_USAGE_EVERY_CODE_HOME = prev;
  }
});

test('parseEveryCodeIncremental persists lastModel across tail scans without info.model', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-ec-'));
  const prev = process.env.AI_USAGE_EVERY_CODE_HOME;
  process.env.AI_USAGE_EVERY_CODE_HOME = home;
  try {
    const sessions = join(home, 'sessions');
    await mkdir(sessions, { recursive: true });
    const rolloutPath = join(sessions, '2026_last_model.jsonl');
    const prefix = [
      JSON.stringify({
        type: 'session_meta',
        payload: { id: 'sess-ec-model', cwd: '/tmp/every-code' },
      }),
      JSON.stringify({
        type: 'turn_context',
        payload: { model: 'deepseek-v4-flash' },
      }),
    ].join('\n');
    await writeFile(rolloutPath, `${prefix}\n`);

    const cursors: CursorsFile = {};
    const first = await parseEveryCodeIncremental(cursors, SINCE);
    assert.equal(first.result.eventsParsed, 0);
    assert.equal(cursors.everyCode!.files[rolloutPath]!.lastModel, 'deepseek-v4-flash');

    const tokenLine = JSON.stringify({
      timestamp: '2026-07-24T14:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { last_token_usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 } },
      },
    });
    await writeFile(rolloutPath, `${prefix}\n${tokenLine}\n`);
    const second = await parseEveryCodeIncremental(cursors, SINCE);
    assert.equal(second.result.eventsParsed, 1);
    assert.equal(second.result.buckets[0]!.model, 'deepseek-v4-flash');
  } finally {
    if (prev === undefined) delete process.env.AI_USAGE_EVERY_CODE_HOME;
    else process.env.AI_USAGE_EVERY_CODE_HOME = prev;
  }
});

test('parseGrokBuildIncremental diffs updates.jsonl high-water marks', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-grok-'));
  const prev = process.env.AI_USAGE_GROK_HOME;
  process.env.AI_USAGE_GROK_HOME = home;
  try {
    const encodedCwd = encodeURIComponent('/Users/me/apps/demo-app');
    const sessionDir = join(home, 'sessions', encodedCwd, 'sess-grok-1');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'signals.json'), JSON.stringify({ primaryModelId: 'grok-3' }));
    const updatesPath = join(sessionDir, 'updates.jsonl');
    const line1 = JSON.stringify({
      params: {
        _meta: {
          totalTokens: 100,
          eventId: 'e1',
          agentTimestampMs: Date.parse('2026-07-24T15:00:00.000Z'),
        },
      },
    });
    const line2 = JSON.stringify({
      params: {
        _meta: {
          totalTokens: 250,
          eventId: 'e2',
          agentTimestampMs: Date.parse('2026-07-24T15:30:00.000Z'),
        },
      },
    });
    await writeFile(updatesPath, `${line1}\n${line2}\n`);

    const first = await parseGrokBuildIncremental({}, SINCE);
    assert.equal(first.result.eventsParsed, 2);
    assert.equal(first.result.buckets[0]!.source, 'grok');
    assert.equal(first.result.buckets[0]!.project, 'demo-app');
    const firstTotal = first.result.buckets.reduce((sum, b) => sum + b.total_tokens, 0);
    assert.equal(firstTotal, 250);

    const line3 = JSON.stringify({
      params: {
        _meta: {
          totalTokens: 400,
          eventId: 'e3',
          agentTimestampMs: Date.parse('2026-07-24T16:00:00.000Z'),
        },
      },
    });
    await appendFile(updatesPath, `${line3}\n`);

    const second = await parseGrokBuildIncremental(first.cursors, SINCE);
    assert.equal(second.result.eventsParsed, 1);
    assert.equal(second.result.buckets[0]!.total_tokens, 150);
  } finally {
    if (prev === undefined) delete process.env.AI_USAGE_GROK_HOME;
    else process.env.AI_USAGE_GROK_HOME = prev;
  }
});
