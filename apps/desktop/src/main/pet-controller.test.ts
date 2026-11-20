import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { build } from 'esbuild';
import type { desktopPets as desktopPetsType } from '../sidecar/pets.js';
import type { PetCatalogError as PetCatalogErrorType } from './pet-catalog-errors.js';
import type { PetCatalogStore as PetCatalogStoreType } from './pet-catalog-store.js';
import type { BUILTIN_PETS as BUILTIN_PETS_TYPE } from './pet-core.js';
import type { PetState } from '../shared/pet.js';
import type { QuotaState } from '../shared/quota.js';

const quota = () => ({ providers: [] } as unknown as QuotaState);
let fixtureRoot: string | undefined;
const fixture = (async () => {
  fixtureRoot = await mkdtemp(path.resolve('dist-test/sidecar/pet-catalog-fixture-'));
  const { prepareDshPet } = await import(pathToFileURL(path.resolve('scripts/prepare-dsh-pet.mjs')).href) as { prepareDshPet(options: { outputRoot: string }): Promise<void> };
  await prepareDshPet({ outputRoot: path.join(fixtureRoot, 'dsh-pet') });
  const fixturePath = path.join(fixtureRoot, 'catalog.mjs');
  const result = await build({
    stdin: { contents: `export { desktopPets } from './src/sidecar/pets';\nexport { PetCatalogStore } from './src/main/pet-catalog-store';\nexport { PetCatalogError } from './src/main/pet-catalog-errors';\nexport { BUILTIN_PETS } from './src/main/pet-core';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false,
    define: { __dirname: JSON.stringify(fixtureRoot) },
    banner: { js: `import { fileURLToPath as __fixtureFileURLToPath } from 'node:url'; const __filename = __fixtureFileURLToPath(import.meta.url);` },
  });
  await writeFile(fixturePath, result.outputFiles[0]!.contents);
  return import(pathToFileURL(fixturePath).href) as Promise<{
    desktopPets: typeof desktopPetsType; PetCatalogStore: typeof PetCatalogStoreType;
    PetCatalogError: typeof PetCatalogErrorType; BUILTIN_PETS: typeof BUILTIN_PETS_TYPE;
  }>;
})();
after(async () => { if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true }); });

test('catalog requests persist a sanitized failure before returning its localized message', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-request-'));
  const { desktopPets, PetCatalogStore, PetCatalogError } = await fixture;
  const catalog = new PetCatalogStore(path.join(root, 'pets'));
  const pets = await desktopPets(root, async () => undefined, () => {}, quota, async () => {}, () => 'en', undefined, catalog, root);
  try {
    catalog.installFromUrl = async () => { throw new PetCatalogError('PET_DOWNLOAD_NETWORK', 'download', 'Bearer secret-marker', { cause: { code: 'ENOTFOUND' }, petId: 'clawd' }); };
    const result = await pets.request('pet:catalog', [{ action: 'install-url', url: 'https://codex-pets.net/#/pets/clawd?token=secret-marker' }]) as { ok: boolean; error: string };
    assert.equal(result.ok, false);
    assert.match(result.error, /system proxy or network/);
    const log = await readFile(path.join(root, 'logs', 'pet-import.log'), 'utf8');
    const entry = JSON.parse(log.trim());
    assert.ok(entry.ts);
    assert.equal(entry.phase, 'download');
    assert.equal(entry.diagnosticCode, 'ENOTFOUND');
    assert.doesNotMatch(log, /secret-marker|Bearer|https:/);
    assert.deepEqual(await pets.request('pet:catalog', [{ action: 'import-zip' }]), { ok: true, data: { canceled: true } });
    assert.equal(await readFile(path.join(root, 'logs', 'pet-import.log'), 'utf8'), log);
  } finally {
    await pets.close();
    await rm(root, { recursive: true, force: true });
  }
});

for (const selected of [false, true]) {
  test(`catalog requests remove a ${selected ? 'selected' : 'non-selected'} pet despite state broadcasts during the directory read`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-remove-request-'));
    const { desktopPets, PetCatalogStore, BUILTIN_PETS } = await fixture;
    const broadcasts: PetState[] = [];
    const catalog = new PetCatalogStore(path.join(root, 'pets'));
    const atlas = readFileSync('src/main/fixtures/pet-atlas-v1.webp');
    const imported = await catalog.installBuffers(Buffer.from(JSON.stringify({ id: 'clawd', displayName: 'Imported Clawd', description: 'Test', spritesheetPath: 'spritesheet.webp' })), atlas);
    const list = catalog.list.bind(catalog);
    let notifyListStarted!: () => void;
    let releaseList!: () => void;
    const listStarted = new Promise<void>(resolve => { notifyListStarted = resolve; });
    const continueList = new Promise<void>(resolve => { releaseList = resolve; });
    const pets = await desktopPets(root, async () => undefined, (channel, state) => {
      if (channel === 'pet:state') broadcasts.push(structuredClone(state as PetState));
    }, quota, async () => {}, () => 'en', undefined, catalog, root);
    try {
      if (selected) await pets.request('pet:set', [{ character: imported.id }]);
      assert.ok((await pets.request('pet:get', []) as PetState).catalog.some(pet => pet.id === imported.id));
      catalog.list = async () => {
        const entries = await list();
        notifyListStarted();
        await continueList;
        return entries;
      };
      const remove = pets.request('pet:catalog', [{ action: 'remove', id: imported.id }]);
      await listStarted;
      await pets.request('pet:hover', [true]);
      releaseList();
      const result = await remove as { ok: boolean; data: { catalog: { id: string }[] } };
      assert.equal(result.ok, true);
      assert.ok(!result.data.catalog.some(pet => pet.id === imported.id));
      const state = await pets.request('pet:get', []) as PetState;
      assert.deepEqual(state.catalog.map(pet => pet.id), BUILTIN_PETS.map(pet => pet.id));
      assert.equal(state.settings.character, 'clawd');
      assert.deepEqual(broadcasts.at(-1)?.catalog.map(pet => pet.id), BUILTIN_PETS.map(pet => pet.id));
      if (selected) assert.equal(JSON.parse(await readFile(path.join(root, 'pet-settings.json'), 'utf8')).character, 'clawd');
    } finally { releaseList(); await pets.close(); await rm(root, { recursive: true, force: true }); }
  });
}
