import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ShareBackgroundFileStore } from './share-background-store.js';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+XqY5WQAAAABJRU5ErkJggg==';

test('desktop backgrounds survive reopening and require explicit replacement at capacity', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-background-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new ShareBackgroundFileStore(dir);
  await Promise.all(['one', 'two', 'three'].map((name) => store.add({ name, image })));
  const saved = await new ShareBackgroundFileStore(dir).list();
  assert.equal(saved.length, 3);
  await assert.rejects(store.add({ name: 'four', image }), /替换/);
  assert.deepEqual(await store.list(), saved);
  const replaced = await store.add({ name: 'four', image }, saved[1].id);
  assert.equal(replaced.length, 3);
  assert.ok(!replaced.some(({ id }) => id === saved[1].id));
  assert.ok(replaced.some(({ name }) => name === 'four'));
  const latest = replaced.find(({ name }) => name === 'four')!;
  await store.remove(latest.id);
  assert.equal((await store.list()).length, 2);
});

test('invalid images and broken persisted data cannot overwrite a saved library', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-background-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new ShareBackgroundFileStore(dir);
  await store.add({ name: 'valid', image });
  const before = await readFile(join(dir, 'share-backgrounds.json'), 'utf8');
  await assert.rejects(store.add({ name: 'bad', image: 'data:image/png;base64,dGVzdA==' }), /图片/);
  assert.equal(await readFile(join(dir, 'share-backgrounds.json'), 'utf8'), before);
  await writeFile(join(dir, 'share-backgrounds.json'), 'broken JSON');
  await assert.rejects(store.add({ name: 'new', image }), /读取/);
  assert.equal(await readFile(join(dir, 'share-backgrounds.json'), 'utf8'), 'broken JSON');
});
