import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  createCodexLineReader,
  findCodexLogFiles,
  logicalCodexPath,
} from '../src/parsers/codex-log-reader.js';

const ZSTD_PARTIAL_JSONL = Buffer.from(
  'KLUv/SAYwQAAeyJ0ZXh0Ijoi6ZuqIn0NCnsidGFpbCI6',
  'base64',
);

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'tud-codex-log-reader-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readLines(path: string, start = 0): Promise<{
  lines: string[];
  reader: ReturnType<typeof createCodexLineReader>;
}> {
  const reader = createCodexLineReader(path, start);
  const lines: string[] = [];
  for await (const line of reader) lines.push(line);
  return { lines, reader };
}

test('logicalCodexPath strips only the trailing .zst from .jsonl.zst paths', () => {
  assert.equal(logicalCodexPath('/logs/session.jsonl.zst'), '/logs/session.jsonl');
  assert.equal(logicalCodexPath('/logs/session.jsonl'), '/logs/session.jsonl');
  assert.equal(logicalCodexPath('/logs/session.zst'), '/logs/session.zst');
});

test('findCodexLogFiles prefers plain files and keeps equal basenames in separate directories', async () => {
  await withTempDir(async (root) => {
    const firstDir = join(root, 'first');
    const secondDir = join(root, 'second');
    await mkdir(firstDir);
    await mkdir(secondDir);

    const plain = join(firstDir, 'session.jsonl');
    const compressed = `${plain}.zst`;
    const otherDirectory = join(secondDir, 'session.jsonl');
    await writeFile(plain, '{"plain":true}\n');
    await writeFile(compressed, ZSTD_PARTIAL_JSONL);
    await writeFile(otherDirectory, '{"other":true}\n');
    await writeFile(join(firstDir, 'ignored.json'), '{}');

    const files = await findCodexLogFiles([root]);
    assert.deepEqual(files, [plain, otherDirectory].sort());
  });
});

test('zstd reader uses decompressed byte offsets and leaves an invalid UTF-8-width tail partial', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'session.jsonl.zst');
    await writeFile(path, ZSTD_PARTIAL_JSONL);

    const { lines, reader } = await readLines(path);
    const committed = '{"text":"雪"}\r\n';
    assert.deepEqual(lines, ['{"text":"雪"}']);
    assert.equal(reader.nextOffset, Buffer.byteLength(committed));
    assert.notEqual(reader.nextOffset, committed.length);
    assert.equal(reader.pendingPartial, true);
  });
});

test('plain path falls back once to its compressed counterpart after ENOENT', async () => {
  await withTempDir(async (dir) => {
    const compressedPath = join(dir, 'session.jsonl.zst');
    await writeFile(compressedPath, ZSTD_PARTIAL_JSONL);

    const { lines, reader } = await readLines(join(dir, 'session.jsonl'));
    assert.deepEqual(lines, ['{"text":"雪"}']);
    assert.equal(reader.nextOffset, Buffer.byteLength('{"text":"雪"}\r\n'));
    assert.equal(reader.pendingPartial, true);
  });
});

test('compressed path falls back once to its plain counterpart after ENOENT', async () => {
  await withTempDir(async (dir) => {
    const plainPath = join(dir, 'session.jsonl');
    const body = '{"text":"雪"}\r\n';
    await writeFile(plainPath, body);

    const { lines, reader } = await readLines(`${plainPath}.zst`);
    assert.deepEqual(lines, ['{"text":"雪"}']);
    assert.equal(reader.nextOffset, Buffer.byteLength(body));
    assert.equal(reader.pendingPartial, false);
  });
});

test('zstd reader rejects corrupt compressed data', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'corrupt.jsonl.zst');
    await writeFile(path, Buffer.from('not a zstd frame'));

    await assert.rejects(async () => {
      for await (const _line of createCodexLineReader(path)) {
        // The corrupt frame must fail before yielding any lines.
      }
    });
  });
});
