import assert from 'node:assert/strict';
import test from 'node:test';
import { addBackground, defaultBackground, replacementSuggestion, cropRect, type ShareBackground } from './share-backgrounds.ts';

const background = (id: string, createdAt: number, lastUsedAt = createdAt): ShareBackground => ({
  id, name: id, createdAt, lastUsedAt, image: 'data:image/jpeg;base64,dGVzdA==',
});

test('default remains the latest upload even after an older background is used', () => {
  const saved = [background('old', 1, 100), background('new', 2, 2)];
  assert.equal(defaultBackground(saved)?.id, 'new');
  assert.equal(defaultBackground(saved.filter(({ id }) => id !== 'new'))?.id, 'old');
  assert.equal(defaultBackground([]), null);
});

test('a fourth background requires an explicit replacement and keeps the input intact', () => {
  const saved = [background('a', 1, 20), background('b', 2, 4), background('c', 3, 9)];
  const before = structuredClone(saved);
  assert.equal(replacementSuggestion(saved)?.id, 'b');
  assert.throws(() => addBackground(saved, background('d', 4)), /替换/);
  assert.throws(() => addBackground(saved, background('d', 4), 'missing'), /不存在/);
  assert.deepEqual(addBackground(saved, background('d', 4), 'b').map(({ id }) => id).sort(), ['a', 'c', 'd']);
  assert.deepEqual(saved, before);
});

test('crop stays inside landscape and portrait sources at all pan/zoom boundaries', () => {
  for (const [width, height] of [[2400, 1200], [600, 2000], [1200, 1800]]) {
    for (const zoom of [1, 1.5, 3]) for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) {
      const rect = cropRect(width, height, zoom, x, y);
      assert.ok(rect.x >= 0 && rect.y >= 0);
      assert.ok(rect.x + rect.width <= width + 1e-8);
      assert.ok(rect.y + rect.height <= height + 1e-8);
      assert.ok(Math.abs(rect.width / rect.height - 2 / 3) < 1e-8);
    }
  }
});
