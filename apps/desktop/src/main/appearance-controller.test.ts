import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAppearanceController } from './appearance-controller.js';
import type { AppearancePreferences } from '../shared/appearance.js';

test('rapid appearance writes remain ordered and a new window reads the latest committed preference', async () => {
  const saved: AppearancePreferences[] = [], published: AppearancePreferences[] = [];
  const controller = createAppearanceController({
    read: async () => null,
    write: async value => { await new Promise(resolve => setTimeout(resolve, value.style === 'win95' ? 20 : 0)); saved.push(value); },
    publish: value => published.push(value), apply: () => {},
  });
  assert.equal(await controller.get(), null);
  const first = controller.set({ style: 'win95', palette: 'rose' });
  const last = controller.set({ style: 'newspaper', palette: 'theme' });
  assert.deepEqual(await controller.get(), { style: 'newspaper', palette: 'theme' });
  await Promise.all([first, last]);
  assert.deepEqual(saved.map(value => value.style), ['win95', 'newspaper']);
  assert.deepEqual(published, saved);
});

test('a failed appearance save leaves persisted state and all other windows unchanged, then allows retry', async () => {
  let fail = true;
  const published: AppearancePreferences[] = [];
  const controller = createAppearanceController({
    read: async () => ({ style: 'catppuccin', palette: 'teal' }),
    write: async () => { if (fail) throw Error('disk unavailable'); },
    publish: value => published.push(value), apply: () => {},
  });
  await assert.rejects(controller.set({ style: 'newspaper', palette: 'teal' }), /disk unavailable/);
  assert.deepEqual(await controller.get(), { style: 'catppuccin', palette: 'teal' });
  assert.equal(published.length, 0);
  fail = false;
  await controller.set({ style: 'newspaper', palette: 'teal' });
  assert.deepEqual(await controller.get(), { style: 'newspaper', palette: 'teal' });
  assert.equal(published.length, 1);
});

test('invalid IPC input cannot write or change the active appearance', async () => {
  let writes = 0;
  const controller = createAppearanceController({ read: async () => null, write: async () => { writes++; }, publish: () => {}, apply: () => {} });
  await assert.rejects(controller.set({ style: 'url(file:///)', palette: 'rose' }), /Invalid appearance/);
  assert.equal(writes, 0);
  assert.equal(await controller.get(), null);
});

test('a late legacy migration cannot overwrite a choice already saved by another window', async () => {
  const saved: AppearancePreferences[] = [];
  const controller = createAppearanceController({ read: async () => null, write: async value => { saved.push(value); }, publish: () => {}, apply: () => {} });
  const delayedInitialResponse = await controller.get();
  assert.equal(delayedInitialResponse, null);
  await controller.set({ style: 'win95', palette: 'rose' });
  const migrated = await controller.initialize({ style: 'default', palette: 'teal' });
  assert.deepEqual(migrated, { style: 'win95', palette: 'rose' });
  assert.deepEqual(await controller.get(), { style: 'win95', palette: 'rose' });
  assert.equal(saved.length, 1);
});

test('two first windows initialize once and receive the same authoritative appearance', async () => {
  let writes = 0;
  const controller = createAppearanceController({ read: async () => null, write: async () => { writes++; }, publish: () => {}, apply: () => {} });
  const values = await Promise.all([controller.initialize({ style: 'catppuccin', palette: 'rose' }), controller.initialize({ style: 'default', palette: 'theme' })]);
  assert.deepEqual(values, [{ style: 'catppuccin', palette: 'rose' }, { style: 'catppuccin', palette: 'rose' }]);
  assert.equal(writes, 1);
});

test('decoration choices survive durable writes, broadcasts and controller recreation', async () => {
  let disk: unknown = { style: 'matrix', palette: 'theme', decorations: true, version: 1 };
  const published: AppearancePreferences[] = [];
  const ports = { read: async () => disk, write: async (value: AppearancePreferences) => { disk = structuredClone(value); }, publish: (value: AppearancePreferences) => published.push(value), apply: () => {} };
  const controller = createAppearanceController(ports);
  assert.deepEqual(await controller.get(), { style: 'matrix', palette: 'theme', decorations: true });
  await controller.set({ style: 'aquarium', palette: 'rose', decorations: false });
  assert.deepEqual(published.at(-1), { style: 'aquarium', palette: 'rose', decorations: false });
  assert.deepEqual(await createAppearanceController(ports).get(), published.at(-1));
  await assert.rejects(controller.set({ style: 'aquarium', palette: 'rose', decorations: 1 }), /Invalid appearance/);
});
