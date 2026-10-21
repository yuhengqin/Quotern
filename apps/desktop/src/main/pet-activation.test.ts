import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PetActivation } from './pet-activation.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

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

test('current pet can be changed while disabled and restored after restarting the coordinator', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-current-pet-'));
  const file = path.join(root, 'pet-selection.json');
  const visible = { builtin: false, dsh: false };
  let character = 'clawd';
  const make = () => new PetActivation({
    builtin: async () => { visible.builtin = false; },
    dsh: async () => { visible.dsh = false; },
  }, {
    file,
    isEnabled: () => visible.builtin || visible.dsh,
    enable: {
      builtin: async () => { visible.builtin = true; },
      dsh: async () => { visible.dsh = true; },
    },
    selectBuiltin: async (id: string) => {
      if (!['clawd', 'bot'].includes(id)) throw new Error('unknown pet');
      character = id;
    },
  });
  try {
    let activation = make();
    await activation.initialize();
    await activation.select({ kind: 'dsh' });
    assert.deepEqual(visible, { builtin: false, dsh: false });
    activation = make();
    await activation.initialize();
    assert.equal(activation.currentKind, 'dsh');
    await activation.setEnabled(true);
    assert.deepEqual(visible, { builtin: false, dsh: true });
    await activation.select({ kind: 'builtin', character: 'bot' });
    assert.equal(character, 'bot');
    assert.deepEqual(visible, { builtin: true, dsh: false });
    await activation.setEnabled(false);
    await activation.select({ kind: 'dsh' });
    await activation.select({ kind: 'builtin', character: 'bot' });
    assert.deepEqual(visible, { builtin: false, dsh: false });
    activation = make();
    await activation.initialize();
    await activation.setEnabled(true);
    assert.equal(character, 'bot');
    assert.deepEqual(visible, { builtin: true, dsh: false });
    await assert.rejects(activation.select({ kind: 'builtin', character: 'missing' }));
    assert.deepEqual(visible, { builtin: true, dsh: false });
    assert.equal(JSON.parse(await readFile(file, 'utf8')).kind, 'builtin');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('legacy activation remembers the current system, rapid global requests remain exclusive', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-current-pet-queue-'));
  const file = path.join(root, 'pet-selection.json');
  const visible = { builtin: false, dsh: false };
  const activation = new PetActivation({
    builtin: async () => { visible.builtin = false; },
    dsh: async () => { visible.dsh = false; },
  }, { file, isEnabled: () => visible.builtin || visible.dsh,
    enable: { builtin: async () => { assert.equal(visible.dsh, false); visible.builtin = true; }, dsh: async () => { assert.equal(visible.builtin, false); visible.dsh = true; } },
    selectBuiltin: async () => {},
  });
  try {
    await writeFile(file, '{"kind":"unrecognized"}');
    await activation.initialize();
    assert.equal(activation.currentKind, 'builtin');
    await activation.run('dsh', true, async () => { visible.dsh = true; });
    await activation.run('dsh', false, async () => { visible.dsh = false; });
    assert.equal(activation.currentKind, 'dsh');
    await Promise.all([activation.setEnabled(true), activation.select({ kind: 'dsh' }), activation.setEnabled(false)]);
    assert.deepEqual(visible, { builtin: false, dsh: false });
    assert.equal(JSON.parse(await readFile(file, 'utf8')).kind, 'dsh');
    await assert.rejects(activation.select({ kind: 'invalid' } as never));
    await activation.setEnabled(true);
    assert.deepEqual(visible, { builtin: false, dsh: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});
