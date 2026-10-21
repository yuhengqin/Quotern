import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DshPetConfigStore } from './config-store.js';

const runtime = path.resolve('out/dsh-pet');

test('runtime sizes use three Clawd-scale presets without rewriting legacy files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-size-'));
  try {
    const store = new DshPetConfigStore(root, runtime);
    const base = store.readAll().main!;
    const pet = (base.pets as object[])[0]!;
    for (const [width, expected] of [[160, 160], [204, 204], [264, 264], [462, 264], [190, 204]]) {
      const raw = JSON.stringify({ pets: [{ ...pet, size: width }] });
      await writeFile(store.paths.userFile, raw);
      assert.equal(store.vendor.flattenPetList(store.read())[0]!.size, expected);
      assert.equal(await store.readText(), raw);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('legacy instances and pet packs expose one stable companion without deleting configuration', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-single-'));
  try {
    const store = new DshPetConfigStore(root, runtime);
    const base = store.vendor.readAllConfig({ ...store.paths, userFile: store.paths.defaultFile }).main!;
    const pet = (base.pets as object[])[0]!;
    const file = path.join(root, 'main-config.jsonc');
    const raw = JSON.stringify({ ...base, pets: [{ ...pet, display: 'none' }, { ...pet, id: 'current', display: 'desktop' }, { ...pet, id: 'other', display: 'desktop' }] });
    await writeFile(file, raw);
    await mkdir(path.join(root, 'pet'));
    const packFile = path.join(root, 'pet/fish-config.jsonc');
    const pack = JSON.stringify({ pets: [{ ...pet, id: 'pack', display: 'desktop' }] });
    await writeFile(packFile, pack);
    assert.deepEqual(store.vendor.flattenPetList(store.read()).map(pet => pet.id), ['current']);
    assert.equal(await readFile(file, 'utf8'), raw);
    assert.equal(await readFile(packFile, 'utf8'), pack);
    await store.setDisplay('current', 'none');
    assert.deepEqual(store.vendor.flattenPetList(store.read()).map(pet => pet.id), ['current'], 'hiding must not switch to another legacy pet');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('first launch inherits built-in pets without warnings or creating a user config', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-first-config-'));
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => { warnings.push(args.join(' ')); });
  try {
    const store = new DshPetConfigStore(root, runtime);
    const defaults = store.read().main!;
    assert.ok(Array.isArray(defaults.pets) && defaults.pets.length > 0);
    assert.deepEqual(warnings, [], 'an absent optional user config is a normal first launch');
    assert.equal(store.version(), '0');
    await assert.rejects(readFile(store.paths.userFile), { code: 'ENOENT' });
    await writeFile(store.paths.userFile, JSON.stringify({ pets: [] }));
    assert.deepEqual(store.read().main!.pets, defaults.pets);
    assert.ok(warnings.some(message => /pets.*为空/.test(message)), 'keep warnings for an explicitly empty pets list');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('saves full JSONC without damaging URL or comment-like text, and keeps pack overrides', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-config-'));
  try {
    const store = new DshPetConfigStore(root, runtime);
    const config = store.read().main!;
    const prompt = 'Visit https://example.com/a//b and keep /* literal */ text';
    await store.saveText('// a real comment\n' + JSON.stringify({ ...config, pets: (config.pets as object[]).map(pet => ({ ...pet, name: prompt })), font: { family: 'system', size: 23, followPet: false } }));
    assert.equal(store.vendor.flattenPetList(store.read())[0]!.name, prompt);
    await mkdir(path.join(root, 'pet'), { recursive: true });
    const pet = { ...(config.pets as Record<string, unknown>[])[0], id: 'fish.extra', name: 'Extra', display: 'desktop' };
    await writeFile(path.join(root, 'pet/fish-config.json'), JSON.stringify({ pets: [pet] }));
    const merged = store.readAll();
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
    for (const invalid of [{ font: { size: -1 } }, { workStatusTexts: 42 }]) await assert.rejects(store.saveText(JSON.stringify(invalid)), /配置/i);
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

test('a selected pet pack can be edited while other configured pets stay inactive', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-single-pack-'));
  try {
    const store = new DshPetConfigStore(root, runtime, 'fish');
    const main = store.readAll().main!;
    await mkdir(path.join(root, 'pet'));
    const file = path.join(root, 'pet/fish-config.jsonc');
    await writeFile(file, JSON.stringify({ pets: [{ ...(main.pets as object[])[0], id: 'fish' }], advancedField: 'keep' }));
    assert.deepEqual(store.vendor.flattenPetList(store.read()).map(pet => pet.id), ['fish']);
    await store.patchPet('fish', { name: 'One fish', position: { marginX: 31 } });
    const pet = store.vendor.flattenPetList(store.read())[0]!;
    assert.equal(pet.name, 'One fish'); assert.equal((pet.position as { marginX: number }).marginX, 31);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).advancedField, 'keep');
    await assert.rejects(store.patchPet('fish', { size: -1 }));
    await assert.rejects(store.patchPet('fish', { id: 'another' }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
