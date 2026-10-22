import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { PetCatalogError } from './pet-catalog-errors.js';
import { PET_CATALOG_CHANNEL, type PetCatalogRequest } from '../shared/pet.js';

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
