import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { appendBuckets, rebuildManifest } from '../src/queue/index.js';
import type { ManifestFile, QueueBucket } from '../src/types.js';

function row(hourStart: string, tokens: number): QueueBucket {
  return {
    hour_start: hourStart,
    source: 'codex',
    model: 'gpt-5',
    project: 'demo',
    input_tokens: tokens,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: tokens,
    conversation_count: 1,
  };
}

test('appendBuckets updates manifest incrementally without rewriting untouched months', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-manifest-'));
  try {
    await mkdir(join(dir, 'queue'), { recursive: true });
    // Seed an old month file + manifest entry.
    await writeFile(
      join(dir, 'queue', '2025-01.jsonl'),
      `${JSON.stringify(row('2025-01-15T00:00:00.000Z', 10))}\n`,
      'utf8',
    );
    await rebuildManifest(dir);

    const before = JSON.parse(
      await readFile(join(dir, 'queue', 'manifest.json'), 'utf8'),
    ) as ManifestFile;
    assert.ok(before.files.some((f) => f.month === '2025-01'));

    await appendBuckets(dir, [row('2026-03-01T00:00:00.000Z', 20)]);

    const after = JSON.parse(
      await readFile(join(dir, 'queue', 'manifest.json'), 'utf8'),
    ) as ManifestFile;
    const jan = after.files.find((f) => f.month === '2025-01');
    const mar = after.files.find((f) => f.month === '2026-03');
    assert.ok(jan);
    assert.equal(jan.firstHour, '2025-01-15T00:00:00.000Z');
    assert.ok(mar);
    assert.equal(mar.lastHour, '2026-03-01T00:00:00.000Z');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
