import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PetActivation } from './pet-activation.js';

test('concurrent pet activations disable the other pet before starting and persist one winner', async () => {
  const visible = { builtin: false, dsh: false };
  const coordinator = new PetActivation({
    builtin: async () => { visible.builtin = false; },
    dsh: async () => { visible.dsh = false; },
  });
  const enable = (kind: 'builtin' | 'dsh') => coordinator.run(kind, true, async () => {
    assert.equal(visible[kind === 'builtin' ? 'dsh' : 'builtin'], false);
    await new Promise(resolve => setImmediate(resolve));
    visible[kind] = true;
  });
  await Promise.all([enable('builtin'), enable('dsh'), enable('builtin')]);
  assert.deepEqual(visible, { builtin: true, dsh: false });
  await assert.rejects(coordinator.run('dsh', true, async () => { throw new Error('failed'); }));
  await enable('dsh');
  assert.deepEqual(visible, { builtin: false, dsh: true });
});
