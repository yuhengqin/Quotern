import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NotificationPreferencesStore } from './preferences.js';

test('concurrent preference writes preserve modes and sound, and persist for restart', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-notice-prefs-'));
  try {
    const file = path.join(root, 'prefs.json'), store = await NotificationPreferencesStore.open(file);
    await Promise.all([store.set({ modes: { quota: 'background' } }), store.set({ sound: 'none' })]);
    const loaded = await NotificationPreferencesStore.open(file);
    assert.equal(loaded.preferences.modes.quota, 'background'); assert.equal(loaded.preferences.sound, 'none');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).version, 1);
    await assert.rejects(store.set({ modes: { unknown: 'always' } } as never));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('retired Agent modes are discarded without losing quota, service or sound preferences', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-notice-retired-'));
  try {
    const file = path.join(root, 'prefs.json');
    await writeFile(file, JSON.stringify({ version: 1, modes: { agentComplete: 'always', agentConfirmation: 'background', agentError: 'off', quota: 'background', service: 'off' }, sound: 'bell' }));
    const store = await NotificationPreferencesStore.open(file);
    assert.equal(store.issue, null);
    assert.deepEqual(store.preferences, { modes: { quota: 'background', service: 'off' }, sound: 'bell' });
    await store.set({ modes: { quota: 'off' } });
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 1, modes: { quota: 'off', service: 'off' }, sound: 'bell' });
    assert.deepEqual((await NotificationPreferencesStore.open(file)).preferences, store.preferences);
    await assert.rejects(store.set({ modes: { agentComplete: 'always' } } as never));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('missing preferences keep defaults; corrupt data fails closed; a failed save preserves effective state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-notice-migrate-'));
  try {
    const file = path.join(root, 'prefs.json');
    const defaults = await NotificationPreferencesStore.open(file);
    assert.deepEqual(defaults.preferences.modes, { quota: 'always', service: 'always' });
    await writeFile(file, '{broken'); const corrupt = await NotificationPreferencesStore.open(file);
    assert.equal(corrupt.issue, 'load'); assert.ok(Object.values(corrupt.preferences.modes).every(value => value === 'off'));
    const brokenWriter = await NotificationPreferencesStore.open(path.join(root, 'other.json'), { write: async () => { throw new Error('read only'); } });
    await assert.rejects(brokenWriter.set({ sound: 'bell' })); assert.equal(brokenWriter.preferences.sound, 'soft');
  } finally { await rm(root, { recursive: true, force: true }); }
});
