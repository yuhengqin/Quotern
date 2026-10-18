import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
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
