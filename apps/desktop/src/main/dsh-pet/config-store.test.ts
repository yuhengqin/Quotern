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
    for (const invalid of [{ chatMemoryRounds: -1 }, { chatImageLimit: -1 }, { whisperPrompt: 42 }, { workStatusTexts: 42 }]) await assert.rejects(store.saveText(JSON.stringify(invalid)), /配置/i);
    assert.equal(await readFile(path.join(root, 'main-config.jsonc'), 'utf8'), valid);
    await store.reset();
    assert.equal(store.read().main!.font && (store.read().main!.font as { family: string }).family, 'system');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('pack display changes preserve its actual JSONC file and advanced fields', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-pack-'));
  try {
    const store = new DshPetConfigStore(root, runtime), main = store.read().main!;
    await mkdir(path.join(root, 'pet'), { recursive: true });
    const file = path.join(root, 'pet/fish-config.jsonc');
    await writeFile(file, JSON.stringify({ pets: [{ ...(main.pets as object[])[0], id: 'fish' }], whisperPrompt: 'keep', advancedField: { keep: true } }));
    await store.setDisplay('fish', 'none');
    const raw = JSON.parse(await readFile(file, 'utf8')); assert.equal(raw.pets[0].display, 'none'); assert.equal(raw.whisperPrompt, 'keep'); assert.deepEqual(raw.advancedField, { keep: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});
