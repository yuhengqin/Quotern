import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { mergeTokenQuality } from '../src/token-quality.js';
import { normalizeClaudeUsage, parseClaudeIncremental } from '../src/parsers/claude.js';
import { parseCursorCsv, recordsToBuckets } from '../src/parsers/cursor.js';
import { normalizeOpencodeTokens, parseOpencodeIncremental } from '../src/parsers/opencode.js';
import { parseAntigravityIncremental } from '../src/parsers/antigravity.js';
import { parseQwenworkIncremental } from '../src/parsers/qwenwork.js';
import { parseKiroIncremental } from '../src/parsers/kiro.js';
import { bucketsFromState, sumTokenTotals } from '../src/parsers/shared.js';
import { alignUnknownIntoDominant } from '../src/queue/align-unknown.js';
import type { TokenTotals } from '../src/types.js';
import { isolateAgentHome } from './platform-fixtures.js';

const SINCE = '2020-01-01T00:00:00.000Z';

async function withHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'quotern-token-quality-'));
  const restore = isolateAgentHome(home);
  try {
    await run(home);
  } finally {
    restore();
    await rm(home, { recursive: true, force: true });
  }
}

function totals(token_quality?: TokenTotals['token_quality']): TokenTotals {
  return {
    input_tokens: 1,
    output_tokens: 2,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 3,
    conversation_count: 1,
    ...(token_quality ? { token_quality } : {}),
  };
}

test('mergeTokenQuality preserves matching origins and marks different or unknown origins mixed', () => {
  assert.equal(mergeTokenQuality('recorded', 'recorded'), 'recorded');
  assert.equal(mergeTokenQuality('estimated', 'estimated'), 'estimated');
  assert.equal(mergeTokenQuality('ledger', 'ledger'), 'ledger');
  assert.equal(mergeTokenQuality(undefined, undefined), undefined);
  assert.equal(mergeTokenQuality('recorded', 'estimated'), 'mixed');
  assert.equal(mergeTokenQuality('ledger', undefined), 'mixed');
});

test('shared totals and buckets retain token quality', () => {
  assert.equal(
    sumTokenTotals(totals('recorded'), totals('estimated')).token_quality,
    'mixed',
  );
  const state = new Map([
    [
      'key',
      {
        ...totals('ledger'),
        model: 'model',
        project: 'project',
        hour_start: '2026-08-03T14:00:00.000Z',
      },
    ],
  ]);
  assert.equal(bucketsFromState(state, 'codex')[0]?.token_quality, 'ledger');

  const aligned = alignUnknownIntoDominant([
    {
      hour_start: '2026-08-03T14:00:00.000Z',
      source: 'codex',
      model: 'unknown',
      project: 'project',
      input_tokens: 1,
      output_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 1,
      conversation_count: 1,
      token_quality: 'estimated',
    },
    {
      hour_start: '2026-08-03T14:00:00.000Z',
      source: 'codex',
      model: 'gpt-5',
      project: 'project',
      input_tokens: 2,
      output_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 2,
      conversation_count: 1,
      token_quality: 'recorded',
    },
  ]);
  assert.equal(aligned.find((bucket) => bucket.model === 'gpt-5')?.token_quality, 'mixed');
});

test('Claude normalization and cumulative usage deltas are recorded', async () => {
  assert.equal(normalizeClaudeUsage({ input_tokens: 10, output_tokens: 2 }).token_quality, 'recorded');

  await withHome(async (home) => {
    const projectDir = join(home, '.claude', 'projects', 'sample-project');
    await mkdir(projectDir, { recursive: true });
    const file = join(projectDir, 'session.jsonl');
    const line = (input: number) =>
      JSON.stringify({
        type: 'assistant',
        uuid: `event-${input}`,
        timestamp: '2026-08-03T14:01:00.000Z',
        requestId: 'request-1',
        message: {
          id: 'message-1',
          model: 'claude-sonnet-4',
          usage: { input_tokens: input, output_tokens: 2 },
        },
      });

    await writeFile(file, `${line(10)}\n`);
    const first = await parseClaudeIncremental({}, SINCE);
    assert.equal(first.result.buckets[0]?.token_quality, 'recorded');

    await appendFile(file, `${line(15)}\n`);
    const next = await parseClaudeIncremental(first.cursors, SINCE);
    assert.equal(next.result.buckets[0]?.input_tokens, 5);
    assert.equal(next.result.buckets[0]?.token_quality, 'recorded');
  });
});

test('Cursor CSV buckets and OpenCode normalized and accumulated totals are recorded', async () => {
  const csv =
    'Date,Kind,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\n' +
    '2026-08-03T14:15:00.000Z,Usage-based,cursor-model,12,10,2,4,18,0.01\n';
  assert.equal(recordsToBuckets(parseCursorCsv(csv), SINCE)[0]?.token_quality, 'recorded');

  assert.equal(
    normalizeOpencodeTokens({ input: 10, output: 2 })?.token_quality,
    'recorded',
  );
  await withHome(async (home) => {
    const messagesDir = join(home, 'opencode', 'storage', 'message', 'session-1');
    await mkdir(messagesDir, { recursive: true });
    await writeFile(
      join(messagesDir, 'msg-1.json'),
      JSON.stringify({
        id: 'msg-1',
        sessionID: 'session-1',
        role: 'assistant',
        modelID: 'opencode-model',
        time: { created: Date.parse('2026-08-03T14:15:00.000Z') },
        tokens: { input: 10, output: 2 },
      }),
    );
    process.env.OPENCODE_HOME = join(home, 'opencode');
    const parsed = await parseOpencodeIncremental({}, SINCE);
    assert.equal(parsed.result.buckets[0]?.token_quality, 'recorded');
  });
});

test('Antigravity and QwenWork transcript buckets are estimated', async () => {
  await withHome(async (home) => {
    process.env.GEMINI_HOME = home;
    const transcriptDir = join(
      home,
      'antigravity-cli',
      'brain',
      'session-1',
      '.system_generated',
      'logs',
    );
    await mkdir(transcriptDir, { recursive: true });
    await writeFile(
      join(transcriptDir, 'transcript.jsonl'),
      [
        { type: 'USER_INPUT', created_at: '2026-08-03T14:00:00.000Z', content: 'question' },
        { type: 'PLANNER_RESPONSE', created_at: '2026-08-03T14:01:00.000Z', content: 'answer' },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n') + '\n',
    );
    const antigravity = await parseAntigravityIncremental({}, SINCE);
    assert.equal(antigravity.result.buckets[0]?.token_quality, 'estimated');
  });

  await withHome(async (home) => {
    const sessionDir = join(home, '.qwenworkcn', 'projects', 'C--work-demo');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'session.jsonl'),
      `${JSON.stringify({
        type: 'assistant',
        timestamp: '2026-08-03T14:01:00.000Z',
        message: {
          id: 'message-1',
          role: 'assistant',
          model: 'qwenwork-model',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'answer' }],
        },
      })}\n`,
    );
    const qwenwork = await parseQwenworkIncremental({}, SINCE);
    assert.equal(qwenwork.result.buckets[0]?.token_quality, 'estimated');
  });
});

test('Kiro JSONL estimates and SQLite rows distinguish recorded tokens from fallback estimates', async () => {
  await withHome(async (home) => {
    const sessionsDir = join(home, 'sessions', 'cli');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'session-1.jsonl'),
      [
        {
          kind: 'Prompt',
          data: {
            meta: { timestamp: Date.parse('2026-08-03T14:00:00.000Z') / 1000 },
            content: [{ kind: 'text', data: 'prompt text' }],
          },
        },
        {
          kind: 'AssistantMessage',
          data: {
            message_id: 'jsonl-request',
            content: [{ kind: 'text', data: { text: 'response text' } }],
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n') + '\n',
    );

    const dbPath = join(home, 'kiro.sqlite3');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE conversations_v2 (conversation_id TEXT, value TEXT)');
    db.prepare('INSERT INTO conversations_v2 VALUES (?, ?)').run(
      'conversation-1',
      JSON.stringify({
        model_info: { model_id: 'kiro-model' },
        user_turn_metadata: {
          requests: [
            {
              request_id: 'db-recorded',
              input_token_count: 8,
              output_token_count: 3,
              request_start_timestamp_ms: Date.parse('2026-08-03T15:01:00.000Z'),
            },
            {
              request_id: 'db-estimated',
              input_token_count: 0,
              output_token_count: 0,
              user_prompt_length: 40,
              response_size: 20,
              request_start_timestamp_ms: Date.parse('2026-08-03T16:01:00.000Z'),
            },
          ],
        },
      }),
    );
    db.close();

    process.env.KIRO_CLI_SESSIONS_DIR = sessionsDir;
    process.env.KIRO_CLI_DB_PATH = dbPath;
    const parsed = await parseKiroIncremental({}, SINCE);
    const atHour = (hour: number) =>
      parsed.result.buckets.find((bucket) => bucket.hour_start.includes(`T${String(hour).padStart(2, '0')}:00`));
    assert.equal(atHour(14)?.token_quality, 'estimated');
    assert.equal(atHour(15)?.token_quality, 'recorded');
    assert.equal(atHour(16)?.token_quality, 'estimated');
  });
});
