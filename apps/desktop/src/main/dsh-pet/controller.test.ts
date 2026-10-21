import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { ChildProcess } from 'node:child_process';
import { DshPetController } from './controller.js';
test('disabled by default; serial enable/reload/pause/crash/retry owns one child and isolates helper profile', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-controller-'));
  const children: Array<EventEmitter & { kill(): boolean }> = [], launches: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
  const controller = new DshPetController({ root, runtimeRoot: path.resolve('out/dsh-pet'), executable: 'electron.exe', appPath: 'isolated-app', packaged: false,
    secrets: { isEncryptionAvailable: () => false, encryptString: () => { throw new Error(); }, decryptString: () => { throw new Error(); } }, getQuota: () => null, showMainWindow: () => {}, openDirectory: async () => {},
    roots: [], spawn: (_exe, args, options) => { launches.push({ args, env: options.env! }); const child = Object.assign(new EventEmitter(), { pid: 1234, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => { queueMicrotask(() => child.emit('exit', 0, null)); return true; } }); children.push(child); queueMicrotask(() => child.emit('spawn')); return child as unknown as ChildProcess; },
  });
  try {
    await controller.initialize(); assert.equal(children.length, 0); assert.equal(controller.getState().enabled, false);
    await Promise.all([controller.dispatch({ type: 'set-enabled', enabled: true }), controller.dispatch({ type: 'set-enabled', enabled: true })]);
    assert.equal(children.length, 1); assert.equal(controller.getState().status, 'running');
    assert.ok(launches[0]!.args.includes('--quotern-dsh-pet-helper')); assert.equal(launches[0]!.env.QUOTERN_DSH_USER_DATA, path.join(root, 'helper')); assert.equal(launches[0]!.env.ELECTRON_RUN_AS_NODE, undefined);
    children[0]!.emit('exit', 7, null); await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(controller.getState().status, 'error'); assert.equal(children.length, 1);
    await controller.dispatch({ type: 'retry' }); assert.equal(children.length, 2);
    await controller.pause(); assert.equal(controller.getState().enabled, true); assert.equal(controller.getState().status, 'disabled');
    await controller.resume(); assert.equal(children.length, 3);
    await controller.dispatch({ type: 'set-enabled', enabled: false }); assert.equal(controller.getState().enabled, false);
    await assert.rejects(controller.dispatch({ type: 'unknown' } as never));
  } finally { await controller.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('one visibility switch stops the subsystem, preserves the web bit and restores its selected pet', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-visibility-'));
  const children: EventEmitter[] = [];
  const makeController = () => new DshPetController({ root, runtimeRoot: path.resolve('out/dsh-pet'), executable: 'electron.exe', appPath: 'isolated-app', packaged: false,
    secrets: { isEncryptionAvailable: () => false, encryptString: () => { throw new Error(); }, decryptString: () => { throw new Error(); } },
    getQuota: () => null, showMainWindow: () => {}, openDirectory: async () => {}, roots: [],
    spawn: (_exe, _args, options) => {
      assert.equal(JSON.parse(options.env!.DSH_PET_PETS!).length, 1, 'the helper must receive only one pet');
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => { queueMicrotask(() => child.emit('exit', 0, null)); return true; } });
      children.push(child); queueMicrotask(() => child.emit('spawn')); return child as unknown as ChildProcess;
    },
  });
  let controller = makeController();
  const display = () => (controller.getState().config.main!.pets as Array<{ display: string }>)[0]!.display;
  const visible = (value: boolean) => controller.dispatch({ type: 'set-desktop-visible', petId: 'main', visible: value });
  try {
    const main = controller.getState().config.main!;
    const pet = (main.pets as object[])[0]!;
    await controller.dispatch({ type: 'patch-config', patch: { pets: [{ ...pet, display: 'both', whisperEnabled: false }] } });
    await controller.dispatch({ type: 'set-enabled', enabled: true });
    assert.equal(children.length, 1);
    await visible(false);
    assert.equal(display(), 'web'); assert.equal(controller.getState().enabled, false); assert.equal(controller.getState().status, 'disabled');
    assert.equal(children.length, 1, 'hiding the last pet must create no fallback window');
    await visible(true);
    assert.equal(display(), 'both'); assert.equal(children.length, 2);
    await controller.dispatch({ type: 'patch-config', patch: { pets: [{ ...pet, display: 'desktop', whisperEnabled: false }] } });
    await visible(false); assert.equal(display(), 'none');
    await visible(true); assert.equal(display(), 'desktop');
    const before = children.length;
    await visible(true); assert.equal(children.length, before, 'repeating the current visibility does not restart the helper');
    await Promise.all([visible(false), visible(true), visible(false)]);
    assert.equal(display(), 'none', 'rapid toggles are applied in order');
    await controller.dispatch({ type: 'set-enabled', enabled: false });
    const disabledChildren = children.length;
    await controller.dispatch({ type: 'patch-pet', petId: 'main', patch: { name: 'One companion' } });
    assert.equal(controller.getState().enabled, false); assert.equal(children.length, disabledChildren);
    await mkdir(path.join(root, 'pet'), { recursive: true });
    const packFile = path.join(root, 'pet/fish-config.jsonc');
    await writeFile(packFile, JSON.stringify({ pets: [{ ...pet, id: 'fish.extra', display: 'both' }], advancedField: 'keep' }));
    await assert.rejects(controller.dispatch({ type: 'set-desktop-visible', petId: 'fish.extra', visible: false }));
    const pack = JSON.parse(await readFile(packFile, 'utf8'));
    assert.equal(pack.pets[0].display, 'both'); assert.equal(pack.advancedField, 'keep');
    assert.equal(display(), 'none', 'an inactive pack must not replace the selected pet');
    await assert.rejects(controller.dispatch({ type: 'set-desktop-visible', petId: 'missing', visible: true }));
    await assert.rejects(controller.dispatch({ type: 'set-desktop-visible', petId: 'main', visible: 'yes' } as never));
    await controller.dispatch({ type: 'patch-config', patch: { pets: [{ ...pet, display: 'none' }, { ...pet, id: 'legacy', display: 'desktop' }] } });
    await controller.dispatch({ type: 'set-enabled', enabled: false });
    await controller.dispose(); controller = makeController();
    await controller.initialize();
    assert.deepEqual(controller.config.vendor.flattenPetList(controller.getState().config).map(pet => pet.id), ['main'], 'restart keeps the persisted selection even when another legacy pet is visible');
    await controller.dispatch({ type: 'set-enabled', enabled: true });
    assert.equal(display(), 'desktop'); assert.equal(controller.getState().status, 'running');
    assert.equal(controller.config.vendor.flattenPetList(controller.config.readAll()).length, 3, 'legacy configuration is retained');
    await controller.dispatch({ type: 'set-enabled', enabled: false });
    await controller.config.setDisplay('main', 'none');
    await controller.dispose();
    await writeFile(path.join(root, 'preferences.json'), JSON.stringify({ enabled: true, quotaSource: null }));
    controller = makeController(); await controller.initialize();
    assert.equal(JSON.parse(await readFile(path.join(root, 'preferences.json'), 'utf8')).petId, 'legacy', 'first startup persists the legacy selection before launching');
  } finally { await controller.dispose(); await rm(root, { recursive: true, force: true }); }
});
