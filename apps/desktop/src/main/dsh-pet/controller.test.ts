import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DshPetController } from './controller.js';
import { PetActivation } from '../pet-activation.js';

test('native window lifecycle forwards requests without spawning a helper', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-native-'));
  const opened: Record<string, unknown>[][] = [];
  let closed = 0;
  const controller = new DshPetController({ root, runtimeRoot: path.resolve('out/dsh-pet'),
    getQuota: () => null, showMainWindow: () => {}, openDirectory: async () => {}, roots: [],
    nativeWindow: { open: async pets => { opened.push(pets); }, close: async () => { closed++; } },
  });
  const request = { id: 1, method: 'GET', url: '/dsh-pet-7340/config' };
  try {
    assert.equal((await controller.handleNativeRequest(request)).status, 503);
    await controller.dispatch({ type: 'set-enabled', enabled: true });
    assert.equal(controller.getState().status, 'running');
    assert.equal(opened.length, 1); assert.equal(opened[0]!.length, 1);
    assert.equal((await controller.handleNativeRequest(request)).status, 200);
    assert.equal((await controller.handleNativeRequest({ ...request, url: '/invalid' })).status, 404);
    await controller.dispatch({ type: 'set-enabled', enabled: false });
    assert.equal(closed, 1); assert.equal((await controller.handleNativeRequest(request)).status, 503);
    await controller.pause(); assert.equal(closed, 1);
  } finally { await controller.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('failed native opening is cleaned up once and can be retried', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-native-failure-'));
  let opened = 0, closed = 0;
  const controller = new DshPetController({ root, runtimeRoot: path.resolve('out/dsh-pet'),
    getQuota: () => null, showMainWindow: () => {}, openDirectory: async () => {}, roots: [],
    nativeWindow: { open: async () => { if (++opened === 1) throw new Error('open failed'); }, close: async () => { closed++; } },
  });
  try {
    await controller.dispatch({ type: 'set-enabled', enabled: true });
    assert.equal(controller.getState().status, 'error'); assert.equal(closed, 1);
    await controller.dispatch({ type: 'retry' });
    assert.equal(controller.getState().status, 'running'); assert.equal(opened, 2); assert.equal(closed, 1);
    await controller.dispatch({ type: 'set-enabled', enabled: false }); assert.equal(closed, 2);
  } finally { await controller.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('enabling from settings, tray and startup waits for exclusive activation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-activation-'));
  let activated = 0, opened = 0;
  const options = { root, runtimeRoot: path.resolve('out/dsh-pet'),
    getQuota: () => null, showMainWindow: () => {}, openDirectory: async () => {}, roots: [],
    coordinateVisibility: async <T>(visible: boolean, operation: () => Promise<T>): Promise<T> => { if (visible) activated++; return operation(); },
    nativeWindow: { open: async () => { assert.ok(activated > opened); opened++; }, close: async () => {} },
  };
  let controller = new DshPetController(options);
  try {
    await controller.dispatch({ type: 'set-enabled', enabled: true });
    assert.equal(activated, 1);
    await controller.dispatch({ type: 'set-enabled', enabled: false });
    await controller.dispatch({ type: 'set-desktop-visible', petId: 'main', visible: true });
    assert.equal(activated, 2);
    await controller.dispose(); controller = new DshPetController(options);
    await controller.initialize(); assert.equal(activated, 3);
  } finally { await controller.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('an already disabled companion can be deactivated even when its default config is unreadable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-broken-config-'));
  const controller = new DshPetController({ root, runtimeRoot: path.resolve('out/dsh-pet'),
    getQuota: () => null, showMainWindow: () => {}, openDirectory: async () => {}, roots: [],
    nativeWindow: { open: async () => {}, close: async () => {} },
  });
  try {
    controller.config.paths.defaultFile = path.join(root, 'missing-default.jsonc');
    assert.throws(() => controller.getState());
    await assert.doesNotReject(controller.deactivate());
  } finally { await controller.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('rapid enable and disable requests preserve their order through the shared coordinator', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-toggle-order-'));
  const activation = new PetActivation({ builtin: async () => {}, dsh: async () => {} });
  const controller = new DshPetController({ root, runtimeRoot: path.resolve('out/dsh-pet'),
    getQuota: () => null, showMainWindow: () => {}, openDirectory: async () => {}, roots: [],
    coordinateVisibility: (visible, operation) => activation.run('dsh', visible, operation),
    nativeWindow: { open: async () => {}, close: async () => {} },
  });
  try {
    await Promise.all([controller.dispatch({ type: 'set-enabled', enabled: true }), controller.dispatch({ type: 'set-enabled', enabled: false })]);
    assert.equal(controller.getState().enabled, false);
    await Promise.all([false, true, false].map(enabled => controller.dispatch({ type: 'set-enabled', enabled })));
    assert.equal(controller.getState().enabled, false);
  } finally { await controller.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('disabled by default; serial enable/reload/pause/resume owns one native window', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-controller-'));
  let opens = 0, active = 0;
  const controller = new DshPetController({ root, runtimeRoot: path.resolve('out/dsh-pet'),
    getQuota: () => null, showMainWindow: () => {}, openDirectory: async () => {},
    roots: [], nativeWindow: { open: async () => { assert.equal(active, 0); active++; opens++; }, close: async () => { assert.equal(active, 1); active--; } },
  });
  try {
    await controller.initialize(); assert.equal(opens, 0); assert.equal(controller.getState().enabled, false);
    await Promise.all([controller.dispatch({ type: 'set-enabled', enabled: true }), controller.dispatch({ type: 'set-enabled', enabled: true })]);
    assert.equal(opens, 1); assert.equal(controller.getState().status, 'running');
    await controller.dispatch({ type: 'retry' }); assert.equal(opens, 2);
    await controller.pause(); assert.equal(controller.getState().enabled, true); assert.equal(controller.getState().status, 'disabled');
    await controller.resume(); assert.equal(opens, 3);
    await controller.dispatch({ type: 'set-enabled', enabled: false }); assert.equal(controller.getState().enabled, false);
    await assert.rejects(controller.dispatch({ type: 'unknown' } as never));
  } finally { await controller.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('one visibility switch stops the subsystem, preserves the web bit and restores its selected pet', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-pet-visibility-'));
  const windows: Record<string, unknown>[][] = [];
  const makeController = () => new DshPetController({ root, runtimeRoot: path.resolve('out/dsh-pet'),
    getQuota: () => null, showMainWindow: () => {}, openDirectory: async () => {}, roots: [],
    nativeWindow: { open: async pets => { assert.equal(pets.length, 1); windows.push(pets); }, close: async () => {} },
  });
  let controller = makeController();
  const display = () => (controller.getState().config.main!.pets as Array<{ display: string }>)[0]!.display;
  const visible = (value: boolean) => controller.dispatch({ type: 'set-desktop-visible', petId: 'main', visible: value });
  try {
    const main = controller.getState().config.main!;
    const pet = (main.pets as object[])[0]!;
    await controller.dispatch({ type: 'patch-config', patch: { pets: [{ ...pet, display: 'both', whisperEnabled: false }] } });
    await controller.dispatch({ type: 'set-enabled', enabled: true });
    assert.equal(windows.length, 1);
    await visible(false);
    assert.equal(display(), 'web'); assert.equal(controller.getState().enabled, false); assert.equal(controller.getState().status, 'disabled');
    assert.equal(windows.length, 1, 'hiding the last pet must create no fallback window');
    await visible(true);
    assert.equal(display(), 'both'); assert.equal(windows.length, 2);
    await controller.dispatch({ type: 'patch-config', patch: { pets: [{ ...pet, display: 'desktop', whisperEnabled: false }] } });
    await visible(false); assert.equal(display(), 'none');
    await visible(true); assert.equal(display(), 'desktop');
    const before = windows.length;
    await visible(true); assert.equal(windows.length, before, 'repeating the current visibility does not restart the helper');
    await Promise.all([visible(false), visible(true), visible(false)]);
    assert.equal(display(), 'none', 'rapid toggles are applied in order');
    await controller.dispatch({ type: 'set-enabled', enabled: false });
    const disabledChildren = windows.length;
    await controller.dispatch({ type: 'patch-pet', petId: 'main', patch: { name: 'One companion' } });
    assert.equal(controller.getState().enabled, false); assert.equal(windows.length, disabledChildren);
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
