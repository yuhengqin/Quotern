import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DshPetControls } from './controls.js';

test('terminal receipts with a nonmatching wait remain safe when retention expires', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0;
  const store = new DshPetControls(() => now, () => {});
  const record = store.create('main', 'idle')!;
  store.report(record.playbackId, 'ended');
  const waiting = store.query(record.playbackId, new URLSearchParams({ wait: 'playing', timeout: '50' }));
  now = 61_000; store.sweep();
  context.mock.timers.tick(50);
  const result = await waiting;
  assert.equal(result.body.status, 'ended');
  assert.equal(result.body.matched, false);
});
