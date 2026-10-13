import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMainWindowLauncher } from './main-window-launcher.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('normal launch opens a window after setup', async () => {
  let shown = 0;
  const launcher = createMainWindowLauncher(async () => { shown++; }, () => {});
  await launcher.initialize(false);
  assert.equal(shown, 1);
});

test('silent launch stays hidden, then every later open can restore a window', async () => {
  let shown = 0;
  let hidden = 0;
  const launcher = createMainWindowLauncher(async () => { shown++; }, () => { hidden++; });
  await launcher.initialize(true);
  assert.equal(shown, 0);
  assert.equal(hidden, 1);
  await launcher.show();
  await launcher.show();
  assert.equal(shown, 2);
});

test('an explicit open during setup overrides silent startup without creating duplicates', async () => {
  let shown = 0;
  let hidden = 0;
  const launcher = createMainWindowLauncher(async () => { shown++; }, () => { hidden++; });
  const pending = launcher.show();
  assert.equal(launcher.show(), pending);
  await Promise.resolve();
  assert.equal(shown, 0);
  await launcher.initialize(true);
  await pending;
  assert.equal(shown, 1);
  assert.equal(hidden, 0);
});

test('normal startup and a queued explicit open share one window request', async () => {
  let shown = 0;
  const launcher = createMainWindowLauncher(async () => { shown++; }, () => {});
  const pending = launcher.show();
  await launcher.initialize(false);
  await pending;
  assert.equal(shown, 1);
});

test('concurrent opens share the pending dock transition', async () => {
  const dock = deferred();
  let created = 0;
  const launcher = createMainWindowLauncher(async () => {
    await dock.promise;
    created++;
  }, () => {});
  await launcher.initialize(true);
  const first = launcher.show();
  await Promise.resolve();
  assert.equal(launcher.show(), first);
  dock.resolve();
  await first;
  assert.equal(created, 1);
});

test('a failed initial window attempt does not swallow a later open', async () => {
  let attempts = 0;
  const launcher = createMainWindowLauncher(async () => {
    if (++attempts === 1) throw new Error('initial window failed');
  }, () => {});
  await assert.rejects(launcher.initialize(false), /initial window failed/);
  await launcher.show();
  assert.equal(attempts, 2);
});
