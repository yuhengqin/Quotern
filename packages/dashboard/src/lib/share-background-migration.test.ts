import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSharedBackgroundLibrary } from './share-background-migration.ts';
import type { ShareBackground } from './share-backgrounds.ts';

const item = (id: string): ShareBackground => ({ id, name: id, image: 'data:image/png;base64,test', createdAt: 1, lastUsedAt: 2 });

test('legacy images are merged through Core and pending items are visible without discarding the shared gallery', async () => {
  const result = await loadSharedBackgroundLibrary({
    list: async () => [item('shared')],
    legacy: async () => [item('old'), item('full')],
    importLegacy: async () => ({ items: [item('shared'), item('imported')], acceptedIds: ['old'], pendingIds: ['full'] }),
  });
  assert.deepEqual(result.items.map(({ id }) => id), ['shared', 'imported']);
  assert.equal(result.pendingCount, 1);
  assert.match(result.migrationNotice ?? '', /1/);
});

test('a failed import keeps the usable shared library and retry recovers after an unknown outcome', async () => {
  let failed = true;
  const source = {
    list: async () => [item('shared')], legacy: async () => [item('old')],
    importLegacy: async () => {
      if (failed) throw new Error('connection lost');
      return { items: [item('shared')], acceptedIds: ['old'], pendingIds: [] };
    },
  };
  const first = await loadSharedBackgroundLibrary(source);
  assert.deepEqual(first.items.map(({ id }) => id), ['shared']);
  assert.match(first.migrationNotice ?? '', /重试/);
  failed = false;
  const retry = await loadSharedBackgroundLibrary(source);
  assert.equal(retry.migrationNotice, null);
  assert.equal(retry.items.length, 1);
});

test('unavailable legacy browser storage does not disable shared uploads, but unavailable Core does', async () => {
  const result = await loadSharedBackgroundLibrary({
    list: async () => [item('shared')], legacy: async () => { throw new Error('storage disabled'); },
    importLegacy: async () => { throw new Error('unexpected import'); },
  });
  assert.equal(result.items.length, 1);
  assert.match(result.migrationNotice ?? '', /旧/);
  await assert.rejects(loadSharedBackgroundLibrary({
    list: async () => { throw new Error('Core unavailable'); }, legacy: async () => [],
    importLegacy: async () => { throw new Error('unexpected import'); },
  }), /Core unavailable/);
});
