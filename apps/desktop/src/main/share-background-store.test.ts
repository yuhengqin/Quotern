import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readDesktopLegacyBackgrounds } from './share-background-store.js';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+XqY5WQAAAABJRU5ErkJggg==';

test('Desktop migration reads old userData JSON and leaves the backup unchanged', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-background-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'share-backgrounds.json');
  const items = [{ id: 'old-desktop', name: 'saved', image, createdAt: 1, lastUsedAt: 2 }];
  const raw = JSON.stringify(items);
  await writeFile(path, raw);
  assert.deepEqual(await readDesktopLegacyBackgrounds(dir), items);
  assert.equal(await readFile(path, 'utf8'), raw);
  await writeFile(path, 'broken JSON');
  await assert.rejects(readDesktopLegacyBackgrounds(dir), /原文件已保留/);
  assert.equal(await readFile(path, 'utf8'), 'broken JSON');
});

test('Desktop legacy migration treats missing data as empty and rejects oversized sources', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-background-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.deepEqual(await readDesktopLegacyBackgrounds(dir), []);
  await writeFile(join(dir, 'share-backgrounds.json'), ' '.repeat(9_000_001));
  await assert.rejects(readDesktopLegacyBackgrounds(dir), /原文件已保留/);
});
