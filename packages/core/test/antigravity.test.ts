import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  ANTIGRAVITY_COLLECTOR_APP,
  ANTIGRAVITY_COLLECTOR_CLI,
  ANTIGRAVITY_COLLECTOR_IDE,
  antigravityCollectorForPath,
  estimateAntigravityTokens,
  listAntigravitySessionFiles,
  listAntigravityTranscripts,
  parseAntigravityIncremental,
  parseAntigravityModelSelection,
} from '../src/parsers/antigravity.js';

const SINCE = '2020-01-01T00:00:00.000Z';

async function writeTranscript(
  home: string,
  variant: 'antigravity' | 'antigravity-ide' | 'antigravity-cli',
  sessionId: string,
  lines: unknown[],
  settingsModel?: string,
): Promise<string> {
  const logsDir = join(
    home,
    variant,
    'brain',
    sessionId,
    '.system_generated',
    'logs',
  );
  await mkdir(logsDir, { recursive: true });
  const transcriptPath = join(logsDir, 'transcript.jsonl');
  await writeFile(
    transcriptPath,
    lines.map((line) => JSON.stringify(line)).join('\n') + '\n',
  );
  if (settingsModel) {
    await writeFile(
      join(home, variant, 'settings.json'),
      JSON.stringify({ model: settingsModel }),
    );
  }
  return transcriptPath;
}

test('antigravityCollectorForPath tags cli / ide / app', () => {
  assert.equal(
    antigravityCollectorForPath('/Users/x/.gemini/antigravity-cli/brain/s/logs/t.jsonl'),
    ANTIGRAVITY_COLLECTOR_CLI,
  );
  assert.equal(
    antigravityCollectorForPath('/Users/x/.gemini/antigravity-ide/brain/s/logs/t.jsonl'),
    ANTIGRAVITY_COLLECTOR_IDE,
  );
  assert.equal(
    antigravityCollectorForPath('/Users/x/.gemini/antigravity/brain/s/logs/t.jsonl'),
    ANTIGRAVITY_COLLECTOR_APP,
  );
});

test('listAntigravityTranscripts discovers cli + ide + legacy brains', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-agy-discover-'));
  const prev = process.env.GEMINI_HOME;
  process.env.GEMINI_HOME = home;
  try {
    const legacy = await writeTranscript(home, 'antigravity', 'session-legacy', []);
    const ide = await writeTranscript(home, 'antigravity-ide', 'session-ide', []);
    const cli = await writeTranscript(home, 'antigravity-cli', 'session-cli', []);
    const all = listAntigravityTranscripts(home).sort();
    assert.deepEqual(all, [cli, ide, legacy].sort());
    assert.deepEqual(listAntigravitySessionFiles(join(home, 'missing', 'brain')), []);
  } finally {
    if (prev === undefined) delete process.env.GEMINI_HOME;
    else process.env.GEMINI_HOME = prev;
  }
});

test('parseAntigravityModelSelection normalizes Gemini Flash', () => {
  const model = parseAntigravityModelSelection(
    'changed setting `Model Selection` from Auto to Gemini 3.5 Flash.\n',
  );
  assert.equal(model, 'gemini-3.5-flash');
});

test('parseAntigravityIncremental bills delta context for CLI + IDE collectors', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-agy-parse-'));
  const prev = process.env.GEMINI_HOME;
  process.env.GEMINI_HOME = home;
  try {
    const modelSelection =
      'changed setting `Model Selection` from Auto to Gemini 3.5 Flash.\n';
    const userA = 'u'.repeat(40);
    const toolResult = 'r'.repeat(80);
    const answerA = 'a'.repeat(20);
    const thinkingA = 't'.repeat(12);
    const userB = 'b'.repeat(40);
    const answerB = 'c'.repeat(20);
    const thinkingB = 'd'.repeat(12);

    const sharedLines = [
      {
        type: 'USER_INPUT',
        created_at: '2026-04-05T14:00:00.000Z',
        content: modelSelection + userA,
      },
      { type: 'TOOL_RESULT', created_at: '2026-04-05T14:01:00.000Z', content: toolResult },
      {
        type: 'PLANNER_RESPONSE',
        created_at: '2026-04-05T14:02:00.000Z',
        content: answerA,
        thinking: thinkingA,
      },
      { type: 'USER_INPUT', created_at: '2026-04-05T14:03:00.000Z', content: userB },
      {
        type: 'PLANNER_RESPONSE',
        created_at: '2026-04-05T14:04:00.000Z',
        content: answerB,
        thinking: thinkingB,
      },
    ];

    await writeTranscript(home, 'antigravity-cli', 'sess-cli', sharedLines);
    await writeTranscript(home, 'antigravity-ide', 'sess-ide', sharedLines);

    const { result, cursors } = await parseAntigravityIncremental({}, SINCE);
    assert.equal(result.eventsParsed, 4); // 2 planners × 2 variants
    assert.equal(result.buckets.length, 2);

    const byCollector = new Map(result.buckets.map((b) => [b.collector, b]));
    assert.ok(byCollector.has(ANTIGRAVITY_COLLECTOR_CLI));
    assert.ok(byCollector.has(ANTIGRAVITY_COLLECTOR_IDE));

    const cli = byCollector.get(ANTIGRAVITY_COLLECTOR_CLI)!;
    assert.equal(cli.source, 'antigravity');
    assert.equal(cli.model, 'gemini-3.5-flash');
    const firstInput =
      estimateAntigravityTokens(modelSelection + userA) +
      estimateAntigravityTokens(toolResult);
    const secondInput =
      estimateAntigravityTokens(answerA) + estimateAntigravityTokens(userB);
    assert.equal(cli.input_tokens, firstInput + secondInput);
    assert.equal(cli.output_tokens, 10);
    assert.equal(cli.reasoning_output_tokens, 6);
    assert.equal(cli.conversation_count, 2);
    assert.equal(
      cli.total_tokens,
      cli.input_tokens + cli.output_tokens + cli.reasoning_output_tokens,
    );

    // Unchanged → no new events
    const again = await parseAntigravityIncremental(cursors, SINCE);
    assert.equal(again.result.eventsParsed, 0);
  } finally {
    if (prev === undefined) delete process.env.GEMINI_HOME;
    else process.env.GEMINI_HOME = prev;
  }
});

test('parseAntigravityIncremental resumes after append (trailing newline safe)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-agy-append-'));
  const prev = process.env.GEMINI_HOME;
  process.env.GEMINI_HOME = home;
  try {
    const firstLine = {
      type: 'USER_INPUT',
      created_at: '2026-04-05T14:00:00.000Z',
      content:
        'changed setting `Model Selection` from Auto to Gemini 3.5 Flash.\n' +
        'u'.repeat(40),
    };
    const transcriptPath = await writeTranscript(
      home,
      'antigravity-cli',
      'sess-append',
      [firstLine],
    );

    const first = await parseAntigravityIncremental({}, SINCE);
    assert.equal(first.result.eventsParsed, 0);
    assert.equal(first.cursors.antigravity?.files[transcriptPath]?.lastLine, 1);

    const plannerLine = {
      type: 'PLANNER_RESPONSE',
      created_at: '2026-04-05T14:02:00.000Z',
      content: 'a'.repeat(20),
    };
    await writeFile(
      transcriptPath,
      `${JSON.stringify(firstLine)}\n${JSON.stringify(plannerLine)}\n`,
    );

    const second = await parseAntigravityIncremental(first.cursors, SINCE);
    assert.equal(second.result.eventsParsed, 1);
    assert.equal(second.result.buckets[0]!.collector, ANTIGRAVITY_COLLECTOR_CLI);
    assert.equal(second.result.buckets[0]!.model, 'gemini-3.5-flash');
  } finally {
    if (prev === undefined) delete process.env.GEMINI_HOME;
    else process.env.GEMINI_HOME = prev;
  }
});
