import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { PetCatalogError } from './pet-catalog-errors.js';
import { PetCatalog } from './pet-catalog.js';
import { BUILTIN_PETS } from './pet-core.js';
import { PET_CATALOG_CHANNEL, PET_GET_CHANNEL, PET_STATE_CHANNEL, type PetCatalogRequest, type PetState } from '../shared/pet.js';

test('catalog IPC persists a sanitized failure before returning its localized message', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-ipc-'));
  const handlers = new Map<string, (_event: unknown, request: PetCatalogRequest) => Promise<unknown>>();
  const noop = () => {};
  const { appendJsonLog } = await import('quotern-core');
  const source = path.resolve('src/main/pet-controller.ts');
  const code = transformSync(readFileSync(source, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node22', define: { 'import.meta.url': JSON.stringify(pathToFileURL(source).href) } }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((id: string) => {
    if (id === 'electron') return { app: { getPath: () => root }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { removeHandler: noop, handle: (channel: string, handler: typeof handlers extends Map<string, infer H> ? H : never) => handlers.set(channel, handler), removeAllListeners: noop, on: noop }, screen: { on: noop, removeListener: noop } };
    if (id === 'quotern-core') return { appendJsonLog, resolveDataDir: () => root, logsDir: (dir: string) => path.join(dir, 'logs') };
    if (id === 'quotern-core/timezone') return { localDateNow: () => '2026-10-22' };
    if (id === './DesktopWindow') return {};
    if (id === './local-runtime') return { isLocalRuntimeSyncing: () => false, onLocalRuntimeSynced: () => noop, onLocalRuntimeSyncActivity: () => noop, localApiRequest: async () => ({ status: 200, body: { success: true, data: {} } }) };
    if (id === './pet-catalog') return { PetCatalog: class { list = async () => []; registerAssetProtocol = noop; unregisterAssetProtocol = noop; } };
    if (id === './pet-pointer') return { createPetCursorSampler: () => ({}) };
    if (id.startsWith('./') || id.startsWith('../')) return require(`${id}.js`);
    return require(id);
  }, module, module.exports);
  const { PetController } = module.exports as { PetController: new (options: unknown) => { initialize(): Promise<void>; dispose(): void; handleCatalog(request: PetCatalogRequest): Promise<unknown> } };
  const controller = new PetController({ getDark: () => false, getLocale: () => 'en' });
  try {
    await controller.initialize();
    controller.handleCatalog = async () => { throw new PetCatalogError('PET_DOWNLOAD_NETWORK', 'download', 'Bearer secret-marker', { cause: { code: 'ENOTFOUND' }, petId: 'clawd' }); };
    const handler = handlers.get(PET_CATALOG_CHANNEL);
    assert.ok(handler);
    const result = await handler(null, { action: 'install-url', url: 'https://codex-pets.net/#/pets/clawd?token=secret-marker' }) as { ok: boolean; error: string };
    assert.equal(result.ok, false);
    assert.match(result.error, /system proxy or network/);
    const log = await readFile(path.join(root, 'logs', 'pet-import.log'), 'utf8');
    const entry = JSON.parse(log.trim());
    assert.ok(entry.ts);
    assert.equal(entry.phase, 'download');
    assert.equal(entry.diagnosticCode, 'ENOTFOUND');
    assert.doesNotMatch(log, /secret-marker|Bearer|https:/);
    controller.handleCatalog = async () => ({ canceled: true });
    assert.deepEqual(await handler(null, { action: 'import-zip' }), { ok: true, data: { canceled: true } });
    assert.equal(await readFile(path.join(root, 'logs', 'pet-import.log'), 'utf8'), log);
  } finally { controller.dispose(); await rm(root, { recursive: true, force: true }); }
});

for (const selected of [false, true]) {
  test(`catalog IPC removes a ${selected ? 'selected' : 'non-selected'} pet despite state broadcasts during the directory read`, { skip: process.platform !== 'win32' }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-remove-ipc-'));
    const handlers = new Map<string, (_event: unknown, request?: PetCatalogRequest) => Promise<unknown>>();
    const broadcasts: PetState[] = [];
    const noop = () => {};
    const catalog = new PetCatalog(path.join(root, 'pets'));
    const atlas = readFileSync('src/main/fixtures/pet-atlas-v1.webp');
    const imported = await catalog.installBuffers(Buffer.from(JSON.stringify({ id: 'clawd', displayName: 'Imported Clawd', description: 'Test', spritesheetPath: 'spritesheet.webp' })), atlas);
    const list = catalog.list.bind(catalog);
    let notifyListStarted!: () => void;
    let releaseList!: () => void;
    const listStarted = new Promise<void>(resolve => { notifyListStarted = resolve; });
    const continueList = new Promise<void>(resolve => { releaseList = resolve; });
    catalog.registerAssetProtocol = noop;
    catalog.unregisterAssetProtocol = noop;
    const source = path.resolve('src/main/pet-controller.ts');
    const code = transformSync(readFileSync(source, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node22', define: { 'import.meta.url': JSON.stringify(pathToFileURL(source).href) } }).code;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)((id: string) => {
      if (id === 'electron') return { app: { getPath: () => root }, BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel: string, state: PetState) => { if (channel === PET_STATE_CHANNEL) broadcasts.push(structuredClone(state)); } } }] }, ipcMain: { removeHandler: noop, handle: (channel: string, handler: typeof handlers extends Map<string, infer H> ? H : never) => handlers.set(channel, handler), removeAllListeners: noop, on: noop }, screen: { on: noop, removeListener: noop } };
      if (id === 'quotern-core') return { appendJsonLog: async () => {}, resolveDataDir: () => root, logsDir: (dir: string) => path.join(dir, 'logs') };
      if (id === 'quotern-core/timezone') return { localDateNow: () => '2026-10-22' };
      if (id === './DesktopWindow') return {};
      if (id === './local-runtime') return { isLocalRuntimeSyncing: () => false, onLocalRuntimeSynced: () => noop, onLocalRuntimeSyncActivity: () => noop, localApiRequest: async () => ({ status: 200, body: { success: true, data: {} } }) };
      if (id === './pet-catalog') return { PetCatalog: class { constructor() { return catalog; } } };
      if (id === './pet-pointer') return { createPetCursorSampler: () => ({}) };
      if (id.startsWith('./') || id.startsWith('../')) return require(`${id}.js`);
      return require(id);
    }, module, module.exports);
    const { PetController } = module.exports as { PetController: new (options: unknown) => { initialize(): Promise<void>; dispose(): void; refreshSelection(): void; selectCharacter(id: string): Promise<PetState>; getState(): PetState } };
    const controller = new PetController({ getDark: () => false, getLocale: () => 'en' });
    try {
      await controller.initialize();
      if (selected) await controller.selectCharacter(imported.id);
      assert.ok(controller.getState().catalog.some(pet => pet.id === imported.id));
      catalog.list = async () => {
        const entries = await list();
        notifyListStarted();
        await continueList;
        return entries;
      };
      const remove = handlers.get(PET_CATALOG_CHANNEL)!(null, { action: 'remove', id: imported.id });
      await listStarted;
      controller.refreshSelection();
      releaseList();
      const result = await remove as { ok: boolean; data: { catalog: { id: string }[] } };
      assert.equal(result.ok, true);
      assert.ok(!result.data.catalog.some(pet => pet.id === imported.id));
      const state = await handlers.get(PET_GET_CHANNEL)!(null) as PetState;
      assert.deepEqual(state.catalog.map(pet => pet.id), BUILTIN_PETS.map(pet => pet.id));
      assert.equal(state.settings.character, 'clawd');
      assert.deepEqual(broadcasts.at(-1)?.catalog.map(pet => pet.id), BUILTIN_PETS.map(pet => pet.id));
      if (selected) assert.equal(JSON.parse(await readFile(path.join(root, 'pet-settings.json'), 'utf8')).character, 'clawd');
    } finally { releaseList(); controller.dispose(); await rm(root, { recursive: true, force: true }); }
  });
}
