import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PetCatalog, petIdFromCodexPetsUrl, readWebpDimensions, validatePetPackage } from './pet-catalog.js';

test('Codex Pets page and download links resolve to the same package ID', () => {
  assert.equal(petIdFromCodexPetsUrl('https://codex-pets.net/#/pets/Star-Fox'), 'star-fox');
  assert.equal(petIdFromCodexPetsUrl('https://codex-pets.net/api/pets/star-fox/download'), 'star-fox');
  assert.equal(petIdFromCodexPetsUrl('star-fox'), 'star-fox');
  assert.throws(() => petIdFromCodexPetsUrl('http://127.0.0.1/pets/star-fox'));
});

test('standard pet atlas dimension validation accepts V1 and rejects mismatched V2', () => {
  const atlas = readFileSync('src/main/fixtures/pet-atlas-v1.webp');
  assert.deepEqual(readWebpDimensions(atlas), { width: 1536, height: 1872 });
  const manifest = { id: 'custom-sprout', displayName: 'Custom Sprout', description: 'Test', spritesheetPath: 'spritesheet.webp' };
  assert.equal(validatePetPackage(Buffer.from(JSON.stringify(manifest)), atlas).spriteVersionNumber, 1);
  assert.throws(() => validatePetPackage(Buffer.from(JSON.stringify({ ...manifest, spriteVersionNumber: 2 })), atlas));
});

for (const id of ['custom-sprout', 'sprout', 'byte', 'ember']) {
  test(`a custom pet (${id}) can be removed and imported again with the same ID`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-catalog-'));
    try {
      const catalog = new PetCatalog(root);
      const atlas = readFileSync('src/main/fixtures/pet-atlas-v1.webp');
      const manifest = Buffer.from(JSON.stringify({ id, displayName: 'Custom Pet', description: 'Test', spritesheetPath: 'spritesheet.webp' }));
      await catalog.installBuffers(manifest, atlas);
      assert.ok((await catalog.list()).some(pet => pet.id === id));
      await catalog.remove(id);
      assert.ok(!(await catalog.list()).some(pet => pet.id === id));
      await catalog.installBuffers(manifest, atlas);
      assert.ok((await catalog.list()).some(pet => pet.id === id));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('importable Codex pets expose a preview atlas and can be imported', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'quotern-codex-pet-'));
  try {
    const source = path.join(temp, 'codex-pets');
    const petDir = path.join(source, 'custom-sprout');
    await mkdir(petDir, { recursive: true });
    const atlas = readFileSync('src/main/fixtures/pet-atlas-v1.webp');
    const manifest = Buffer.from(JSON.stringify({ id: 'custom-sprout', displayName: 'Custom Sprout', description: 'Test', spritesheetPath: 'spritesheet.webp' }));
    await Promise.all([
      writeFile(path.join(petDir, 'pet.json'), manifest),
      writeFile(path.join(petDir, 'spritesheet.webp'), atlas),
    ]);
    const catalog = new PetCatalog(path.join(temp, 'installed'), source);
    assert.equal((await catalog.listCodex())[0]?.assetUrl, 'quotern-pet://codex/custom-sprout/spritesheet.webp');
    await catalog.importCodex(['custom-sprout']);
    assert.equal((await catalog.listCodex()).length, 0);
    assert.ok((await catalog.list()).some(pet => pet.id === 'custom-sprout'));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
