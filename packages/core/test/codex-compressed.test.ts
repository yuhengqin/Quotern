import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { parseCodexIncremental } from '../src/parsers/codex.js';

// A standards-compliant zstd frame with one raw block, no native zstd dependency.
function frame(text: string): Buffer {
  const bytes = Buffer.from(text);
  const header = Buffer.alloc(12);
  header.set([0x28, 0xb5, 0x2f, 0xfd, 0xa0]);
  header.writeUInt32LE(bytes.length, 5);
  header.writeUIntLE((bytes.length << 3) | 1, 9, 3);
  return Buffer.concat([header, bytes]);
}
const meta = JSON.stringify({ type: 'session_meta', payload: { id: 'compressed-session', cwd: '/work/demo' } });
const turn = JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.4' } });
const token = (input: number) => JSON.stringify({ type: 'event_msg', timestamp: '2026-06-09T10:00:00Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: input, output_tokens: 10 } } } });

test('Codex meters compressed archives, encoding switches, append and archive movement once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-zst-'));
  const keys = ['HOME', 'USERPROFILE', 'CODEX_HOME', 'AI_USAGE_CODEX_HOME'] as const;
  const env = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.HOME = process.env.USERPROFILE = root;
  process.env.CODEX_HOME = join(root, '.codex'); delete process.env.AI_USAGE_CODEX_HOME;
  try {
    const dir = join(root, '.codex', 'sessions'); await mkdir(dir, { recursive: true });
    const plain = join(dir, 'rollout-test.jsonl');
    const content = [meta, turn, token(100), ''].join('\n');
    await writeFile(`${plain}.zst`, frame(content));
    const first = await parseCodexIncremental({}, '2026-01-01T00:00:00Z');
    assert.equal(first.result.buckets.reduce((n, row) => n + row.total_tokens, 0), 110);
    assert.equal(first.result.buckets[0]?.model, 'gpt-5.4');
    assert.equal(first.cursors.codex!.files[plain].offset, Buffer.byteLength(content));
    const unchanged = await parseCodexIncremental(first.cursors, '2026-01-01T00:00:00Z');
    assert.equal(unchanged.result.filesProcessed, 0);
    await writeFile(plain, content);
    const restored = await parseCodexIncremental(unchanged.cursors, '2026-01-01T00:00:00Z');
    assert.equal(restored.result.buckets.length, 0);
    await appendFile(plain, `${token(20)}\n`);
    const appended = await parseCodexIncremental(restored.cursors, '2026-01-01T00:00:00Z');
    assert.equal(appended.result.buckets[0]?.total_tokens, 30);
    await writeFile(`${plain}.zst`, frame(content + token(20) + '\n'));
    await rm(plain);
    const compressed = await parseCodexIncremental(appended.cursors, '2026-01-01T00:00:00Z');
    assert.equal(compressed.result.buckets.length, 0);
    const archive = join(root, '.codex', 'archived_sessions'); await mkdir(archive);
    await rename(`${plain}.zst`, join(archive, 'rollout-test.jsonl.zst'));
    const moved = await parseCodexIncremental(compressed.cursors, '2026-01-01T00:00:00Z');
    assert.equal(moved.result.buckets.length, 0);
    const before = structuredClone(moved.cursors);
    await writeFile(join(archive, 'rollout-bad.jsonl.zst'), 'broken');
    await assert.rejects(parseCodexIncremental(moved.cursors, '2026-01-01T00:00:00Z'));
    assert.deepEqual(moved.cursors, before);
  } finally {
    for (const key of keys) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; }
    await rm(root, { recursive: true, force: true });
  }
});
