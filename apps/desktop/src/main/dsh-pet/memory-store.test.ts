import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DshPetMemoryStore } from './memory-store.js';

test('keeps pack and instance histories independent across concurrent writes, restart and clearing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-memory-'));
  try {
    const store = new DshPetMemoryStore(root);
    const messages = [{ role: 'user' as const, content: 'Hi', ts: 1 }, { role: 'assistant' as const, content: 'Hello', ts: 2 }];
    await Promise.all([store.append('main', 'main', messages), store.append('fish', 'fish.extra', messages), store.append('main', '__proto__', messages)]);
    assert.equal(store.get('main', 'main', 1).length, 2);
    assert.equal(store.get('main', 'main', 0).length, 0);
    await store.clear('main');
    const reloaded = new DshPetMemoryStore(root);
    assert.equal(reloaded.get('main', 'main', 10).length, 0);
    assert.equal(reloaded.get('fish', 'fish.extra', 10).length, 2);
    assert.equal(reloaded.get('main', '__proto__', 10).length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preserves a corrupt memory file as a backup before starting fresh', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-memory-'));
  try {
    await writeFile(path.join(root, 'memory.json'), '{broken');
    const store = new DshPetMemoryStore(root);
    assert.deepEqual(store.get('main', 'main', 10), []);
    assert.ok((await readdir(root)).some(file => file.startsWith('memory.json.bak-')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
