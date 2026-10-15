import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
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
  const atlas = readFileSync('src/renderer/public/pets/sprout/spritesheet.webp');
  assert.deepEqual(readWebpDimensions(atlas), { width: 1536, height: 1872 });
  const manifest = { id: 'custom-sprout', displayName: 'Custom Sprout', description: 'Test', spritesheetPath: 'spritesheet.webp' };
  assert.equal(validatePetPackage(Buffer.from(JSON.stringify(manifest)), atlas).spriteVersionNumber, 1);
  assert.throws(() => validatePetPackage(Buffer.from(JSON.stringify({ ...manifest, spriteVersionNumber: 2 })), atlas));
});

test('a custom pet can be removed and imported again with the same ID', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-catalog-'));
  try {
    const catalog = new PetCatalog(root);
    const atlas = readFileSync('src/renderer/public/pets/sprout/spritesheet.webp');
    const manifest = Buffer.from(JSON.stringify({ id: 'custom-sprout', displayName: 'Custom Sprout', description: 'Test', spritesheetPath: 'spritesheet.webp' }));
    await catalog.installBuffers(manifest, atlas);
    assert.ok((await catalog.list()).some(pet => pet.id === 'custom-sprout'));
    await catalog.remove('custom-sprout');
    assert.ok(!(await catalog.list()).some(pet => pet.id === 'custom-sprout'));
    await catalog.installBuffers(manifest, atlas);
    assert.ok((await catalog.list()).some(pet => pet.id === 'custom-sprout'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
