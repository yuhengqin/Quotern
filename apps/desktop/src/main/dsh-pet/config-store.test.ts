import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DshPetConfigStore } from './config-store.js';

const runtime = path.resolve('out/dsh-pet');

test('saves full JSONC without damaging URL or comment-like prompt text, and keeps pack overrides', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-config-'));
  try {
    const store = new DshPetConfigStore(root, runtime);
    const config = store.read().main!;
    const prompt = 'Visit https://example.com/a//b and keep /* literal */ text';
    await store.saveText('// a real comment\n' + JSON.stringify({ ...config, whisperPrompt: prompt, font: { family: 'system', size: 23, followPet: false } }));
    assert.equal(store.read().main!.whisperPrompt, prompt);
    await mkdir(path.join(root, 'pet'), { recursive: true });
    const pet = { ...(config.pets as Record<string, unknown>[])[0], id: 'fish.extra', name: 'Extra', display: 'desktop' };
    await writeFile(path.join(root, 'pet/fish-config.json'), JSON.stringify({ pets: [pet] }));
    const merged = store.read();
    assert.equal((merged.fish!.font as Record<string, unknown>).size, 23);
    assert.equal((merged.fish!.pets as Record<string, unknown>[])[0]!.id, 'fish.extra');
    assert.ok((await store.readText()).startsWith('// a real comment'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects malformed and invalid settings while preserving the last valid configuration', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-config-'));
  try {
    const store = new DshPetConfigStore(root, runtime);
    const valid = JSON.stringify(store.read().main);
    await store.saveText(valid);
    await assert.rejects(store.saveText('{broken'), /JSON|配置|syntax/i);
    await assert.rejects(store.saveText(JSON.stringify({ ...JSON.parse(valid), physics: { gravity: -5 } })), /physics|配置/i);
    assert.equal(await readFile(path.join(root, 'main-config.jsonc'), 'utf8'), valid);
    await store.reset();
    assert.equal(store.read().main!.font && (store.read().main!.font as { family: string }).family, 'system');
  } finally { await rm(root, { recursive: true, force: true }); }
});
