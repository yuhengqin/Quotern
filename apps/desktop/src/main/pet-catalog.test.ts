import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PetCatalog, petIdFromCodexPetsUrl, readWebpDimensions, validatePetPackage } from './pet-catalog.js';

function packageZip(id = 'clawd'): Buffer {
  const manifest = Buffer.from(JSON.stringify({ id, displayName: 'Downloaded Pet', description: 'Test', spritesheetPath: 'spritesheet.webp' }));
  const entries = [['pet.json', manifest], ['spritesheet.webp', readFileSync('src/main/fixtures/pet-atlas-v1.webp')]] as const;
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [filename, body] of entries) {
    const name = Buffer.from(filename);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const header = Buffer.alloc(30), directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 16); directory.writeUInt32LE(body.length, 20); directory.writeUInt32LE(body.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, name, body); central.push(directory, name);
    offset += header.length + name.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function catalogWithFetch(root: string, fetcher: typeof fetch): PetCatalog {
  return new PetCatalog(root, undefined, { fetch: fetcher });
}

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

for (const id of ['clawd', 'bot']) {
  test(`importing ${id} preserves the built-in and reuses an identical imported package`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-reserved-'));
    try {
      const catalog = new PetCatalog(root);
      const atlas = readFileSync('src/main/fixtures/pet-atlas-v1.webp');
      const manifest = Buffer.from(JSON.stringify({ id, displayName: 'Imported Pet', description: 'Test', spritesheetPath: 'spritesheet.webp' }));
      const [first, repeated] = await Promise.all([catalog.installBuffers(manifest, atlas), catalog.installBuffers(manifest, atlas)]);
      assert.notEqual(first.id, id);
      assert.equal(repeated.id, first.id);
      assert.match(first.id, /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/);
      assert.equal(JSON.parse(await readFile(path.join(root, first.id, 'pet.json'), 'utf8')).id, first.id);
      const pets = await catalog.list();
      assert.equal(pets.filter(pet => pet.id === id && !pet.custom).length, 1);
      assert.equal(pets.filter(pet => pet.custom).length, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test('different packages with the same ID remain independently removable without overwrites', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-collision-'));
  try {
    const catalog = new PetCatalog(root);
    const atlas = readFileSync('src/main/fixtures/pet-atlas-v1.webp');
    const manifest = { id: 'same-pet', displayName: 'Original', description: 'Test', spritesheetPath: 'spritesheet.webp' };
    const first = await catalog.installBuffers(Buffer.from(JSON.stringify(manifest)), atlas);
    const next = await catalog.installBuffers(Buffer.from(JSON.stringify({ ...manifest, displayName: 'Different' })), atlas);
    assert.equal(first.id, 'same-pet');
    assert.notEqual(next.id, first.id);
    assert.equal(JSON.parse(await readFile(path.join(root, first.id, 'pet.json'), 'utf8')).displayName, 'Original');
    await catalog.remove(next.id);
    assert.ok((await catalog.list()).some(pet => pet.id === first.id));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Codex pets whose IDs match built-ins can be previewed and imported once', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'quotern-codex-reserved-'));
  try {
    const source = path.join(temp, 'codex-pets');
    const petDir = path.join(source, 'clawd');
    await mkdir(petDir, { recursive: true });
    const atlas = readFileSync('src/main/fixtures/pet-atlas-v1.webp');
    const manifest = Buffer.from(JSON.stringify({ id: 'clawd', displayName: 'Codex Clawd', description: 'Test', spritesheetPath: 'spritesheet.webp' }));
    await Promise.all([writeFile(path.join(petDir, 'pet.json'), manifest), writeFile(path.join(petDir, 'spritesheet.webp'), atlas)]);
    const catalog = new PetCatalog(path.join(temp, 'installed'), source);
    assert.equal((await catalog.listCodex())[0]?.assetUrl, 'quotern-pet://codex/clawd/spritesheet.webp');
    const imported = await catalog.importCodex(['clawd']);
    assert.notEqual(imported[0]?.id, 'clawd');
    assert.equal((await catalog.listCodex()).length, 0);
    assert.equal((await catalog.list()).filter(pet => pet.custom).length, 1);
    assert.equal(JSON.parse(await readFile(path.join(petDir, 'pet.json'), 'utf8')).id, 'clawd');
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('URL downloads use the supplied desktop transport and import ZIPs with reserved IDs', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-download-'));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Node fetch must not be used'); });
  try {
    let requested = false;
    const catalog = catalogWithFetch(root, async (input, init) => {
      requested = true;
      assert.equal(input, 'https://codex-pets.net/api/pets/clawd/download');
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.cache, 'no-store');
      assert.ok(init?.signal instanceof AbortSignal);
      return new Response(new Uint8Array(packageZip()));
    });
    const imported = await catalog.installFromUrl('https://codex-pets.net/#/pets/clawd');
    assert.equal(requested, true);
    assert.notEqual(imported.id, 'clawd');
    assert.equal((await catalog.list()).filter(pet => pet.custom).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('network and timeout failures retain diagnostic causes and stages', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Node fetch must not be used'); });
  const network = new TypeError('fetch failed', { cause: Object.assign(new Error('DNS failure'), { code: 'ENOTFOUND' }) });
  for (const [error, code] of [[network, 'PET_DOWNLOAD_NETWORK'], [new DOMException('Timed out', 'TimeoutError'), 'PET_DOWNLOAD_TIMEOUT']] as const) {
    const catalog = catalogWithFetch('unused-test-directory', async () => { throw error; });
    await assert.rejects(catalog.installFromUrl('clawd'), failure => {
      assert.equal((failure as { code: string }).code, code);
      assert.equal((failure as { phase: string }).phase, 'download');
      assert.equal((failure as Error).cause, error);
      return true;
    });
  }
});

test('HTTP and oversized download failures cancel their response streams', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Node fetch must not be used'); });
  for (const [status, length, code] of [[503, '10', 'PET_DOWNLOAD_HTTP'], [200, String(13 * 1024 * 1024), 'PET_PACKAGE_TOO_LARGE']] as const) {
    let canceled = false;
    const body = new ReadableStream({ cancel() { canceled = true; } });
    const catalog = catalogWithFetch('unused-test-directory', async () => new Response(body, { status, headers: { 'content-length': length } }));
    await assert.rejects(catalog.installFromUrl('clawd'), failure => {
      assert.equal((failure as { code: string }).code, code);
      if (status !== 200) assert.equal((failure as { httpStatus: number }).httpStatus, status);
      return true;
    });
    assert.equal(canceled, true);
  }
});

test('a previously renamed import is reused even after its original ID becomes free', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-reimport-'));
  try {
    const catalog = new PetCatalog(root);
    const atlas = readFileSync('src/main/fixtures/pet-atlas-v1.webp');
    const manifest = { id: 'a'.repeat(64), displayName: 'Original', description: 'Test', spritesheetPath: 'spritesheet.webp' };
    const original = await catalog.installBuffers(Buffer.from(JSON.stringify(manifest)), atlas);
    const changed = Buffer.from(JSON.stringify({ ...manifest, displayName: 'Different' }));
    const renamed = await catalog.installBuffers(changed, atlas);
    assert.ok(renamed.id.length <= 64);
    await catalog.remove(original.id);
    assert.equal((await catalog.installBuffers(changed, atlas)).id, renamed.id);
    assert.equal((await catalog.list()).filter(pet => pet.custom).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('stream size checks survive cancellation errors and retain the size failure', async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(12 * 1024 * 1024 + 1)); },
    cancel() { canceled = true; throw new Error('cleanup failure'); },
  });
  const catalog = catalogWithFetch('unused-test-directory', async () => new Response(body));
  await assert.rejects(catalog.installFromUrl('clawd'), error => (error as { code: string }).code === 'PET_PACKAGE_TOO_LARGE');
  assert.equal(canceled, true);
});

test('archive, validation and installation failures report their own phases', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-phases-'));
  try {
    const catalog = catalogWithFetch(root, async () => new Response('invalid ZIP'));
    await assert.rejects(catalog.installFromUrl('clawd'), error => (error as { phase: string }).phase === 'archive');
    const atlas = readFileSync('src/main/fixtures/pet-atlas-v1.webp');
    await assert.rejects(catalog.installBuffers(Buffer.from('{}'), atlas), error => (error as { phase: string }).phase === 'validation');
    const blockedRoot = path.join(root, 'file-instead-of-directory');
    await writeFile(blockedRoot, 'keep');
    const blocked = new PetCatalog(blockedRoot);
    const manifest = Buffer.from(JSON.stringify({ id: 'clawd', displayName: 'Test', description: 'Test', spritesheetPath: 'spritesheet.webp' }));
    await assert.rejects(blocked.installBuffers(manifest, atlas), error => (error as { code: string }).code === 'PET_INSTALL_FAILED' && (error as { phase: string }).phase === 'install');
    assert.equal(await readFile(blockedRoot, 'utf8'), 'keep');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an occupied directory with unrelated files is preserved during ID allocation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-occupied-'));
  try {
    await mkdir(path.join(root, 'occupied'));
    await writeFile(path.join(root, 'occupied', 'unrelated.txt'), 'keep');
    const catalog = new PetCatalog(root);
    const atlas = readFileSync('src/main/fixtures/pet-atlas-v1.webp');
    const manifest = Buffer.from(JSON.stringify({ id: 'occupied', displayName: 'Test', description: 'Test', spritesheetPath: 'spritesheet.webp' }));
    const imported = await catalog.installBuffers(manifest, atlas);
    assert.notEqual(imported.id, 'occupied');
    assert.equal(await readFile(path.join(root, 'occupied', 'unrelated.txt'), 'utf8'), 'keep');
  } finally { await rm(root, { recursive: true, force: true }); }
});
