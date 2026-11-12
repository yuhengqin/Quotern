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
    await Promise.all([store.set({ modes: { agentComplete: 'always' } }), store.set({ sound: 'none' })]);
    const loaded = await NotificationPreferencesStore.open(file);
    assert.equal(loaded.preferences.modes.agentComplete, 'always'); assert.equal(loaded.preferences.sound, 'none');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).version, 1);
    await assert.rejects(store.set({ modes: { unknown: 'always' } } as never));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('legacy mute survives migration; corrupt data fails closed; a failed save preserves effective state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-notice-migrate-'));
  try {
    const file = path.join(root, 'prefs.json');
    const muted = await NotificationPreferencesStore.open(file, { legacyAgentMuted: true });
    assert.equal(muted.preferences.modes.agentComplete, 'off'); assert.equal(muted.preferences.modes.quota, 'always');
    await writeFile(file, '{broken'); const corrupt = await NotificationPreferencesStore.open(file);
    assert.equal(corrupt.issue, 'load'); assert.ok(Object.values(corrupt.preferences.modes).every(value => value === 'off'));
    const brokenWriter = await NotificationPreferencesStore.open(path.join(root, 'other.json'), { write: async () => { throw new Error('read only'); } });
    await assert.rejects(brokenWriter.set({ sound: 'bell' })); assert.equal(brokenWriter.preferences.sound, 'soft');
  } finally { await rm(root, { recursive: true, force: true }); }
});
