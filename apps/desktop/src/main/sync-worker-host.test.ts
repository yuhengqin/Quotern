import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { transformSync } from 'esbuild';

class Child extends EventEmitter {
  pid = 100;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  messages: Array<{ type: string; id?: number }> = [];
  killed = false;
  failSend = false;
  postMessage(message: { type: string; id?: number }) {
    if (this.failSend) throw new Error('send failed');
    this.messages.push(message);
    this.emit('sent', message);
  }
  kill() { this.killed = true; queueMicrotask(() => this.emit('exit', 0)); return true; }
  ready() { this.emit('message', { type: 'ready', pid: this.pid }); }
}

function loadHost(t: TestContext) {
  const children: Child[] = [];
  const logs: string[] = [];
  const source = readFileSync(join(__dirname, '../../src/main/sync-worker-host.ts'), 'utf8');
  const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'node22' }).code;
  const module = { exports: {} };
  const electron = { utilityProcess: { fork: () => {
    const child = new Child(); child.pid += children.length; children.push(child); return child;
  } } };
  new Function('require', 'module', 'exports', 'console', code)(
    (id: string) => id === 'electron' ? electron : id.includes('?modulePath') ? 'worker.js' : require(id),
    module, module.exports, { log: () => {}, warn: (...args: unknown[]) => logs.push(args.join(' ')), error: (...args: unknown[]) => logs.push(args.join(' ')) },
  );
  const host = module.exports as {
    startSyncWorker(dir: string): Promise<boolean>;
    stopSyncWorker(): void | Promise<void>;
    runSyncViaWorker(reason: string): Promise<unknown[]>;
    isSyncWorkerRunning(): boolean;
  };
  t.after(async () => { await host.stopSyncWorker(); });
  return { host, children, logs };
}

test('concurrent startup and sync requests share one initializing worker', async (t) => {
  const { host, children } = loadHost(t);
  const first = host.startSyncWorker('data');
  const second = host.startSyncWorker('data');
  const sync = host.runSyncViaWorker('poll').catch(error => error);
  await Promise.resolve();
  assert.equal(children.length, 1);
  children[0].ready();
  assert.equal(await first, true);
  assert.equal(await second, true);
  await Promise.resolve();
  const request = children[0].messages.find(message => message.type === 'runSync')!;
  children[0].emit('message', { type: 'syncDone', id: request.id, results: [] });
  assert.deepEqual(await sync, []);
});

test('events from a replaced worker cannot reject or complete the current request', async (t) => {
  const { host, children } = loadHost(t);
  const first = host.startSyncWorker('first');
  await Promise.resolve(); children[0].ready(); await first;
  await host.stopSyncWorker();
  const second = host.startSyncWorker('second');
  await Promise.resolve();
  const current = children.at(-1)!;
  current.ready(); await second;
  const request = host.runSyncViaWorker('poll');
  const outcome = request.catch(error => error);
  await Promise.resolve();
  const id = current.messages.find(message => message.type === 'runSync')!.id;
  children[0].emit('exit', 1);
  children[0].emit('message', { type: 'syncError', id, error: 'obsolete worker' });
  current.emit('message', { type: 'syncDone', id, results: [{ source: 'codex' }] });
  assert.deepEqual(await outcome, [{ source: 'codex' }]);
  assert.equal(host.isSyncWorkerRunning(), true);
});

test('exit during initialization settles startup immediately and can be retried', async (t) => {
  const { host, children } = loadHost(t);
  const start = host.startSyncWorker('data');
  await Promise.resolve(); children[0].emit('exit', 1);
  const result = await Promise.race([start, new Promise(resolve => setTimeout(() => resolve('still waiting'), 50))]);
  assert.equal(result, false);
  const retry = host.startSyncWorker('data');
  await Promise.resolve(); children.at(-1)!.ready();
  assert.equal(await retry, true);
});

test('stop during initialization prevents late ready or automatic restart', async (t) => {
  const { host, children } = loadHost(t);
  const start = host.startSyncWorker('data');
  await Promise.resolve(); await host.stopSyncWorker();
  children[0].ready();
  assert.equal(await start, false);
  assert.equal(host.isSyncWorkerRunning(), false);
});

test('a failed send rejects immediately without retaining a pending request', async (t) => {
  const { host, children } = loadHost(t);
  const start = host.startSyncWorker('data');
  await Promise.resolve(); children[0].ready(); await start;
  children[0].failSend = true;
  await assert.rejects(host.runSyncViaWorker('poll'), /send failed/);
  children[0].failSend = false;
  const request = host.runSyncViaWorker('manual');
  await Promise.resolve();
  const id = children[0].messages.at(-1)!.id;
  children[0].emit('message', { type: 'syncDone', id, results: [] });
  assert.deepEqual(await request, []);
});

test('automatic restart does not replace a worker already being initialized by a request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { host, children } = loadHost(t);
  const start = host.startSyncWorker('data');
  children[0].ready(); await start;
  children[0].emit('exit', 1);
  const request = host.runSyncViaWorker('poll').catch(error => error);
  t.mock.timers.tick(500);
  assert.equal(children.length, 2);
  const sent = new Promise<number>(resolve => children[1].on('sent', message => {
    if (message.type === 'runSync') resolve(message.id);
  }));
  children[1].ready();
  const id = await sent;
  children[1].emit('message', { type: 'syncDone', id, results: [] });
  assert.deepEqual(await request, []);
});

test('a timed out sync cannot return until its writer has exited', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { host, children } = loadHost(t);
  const start = host.startSyncWorker('data'); children[0].ready(); await start;
  children[0].kill = () => { children[0].killed = true; return true; };
  let settled = false;
  const request = host.runSyncViaWorker('poll').catch(error => { settled = true; return error; });
  t.mock.timers.tick(600_000);
  await Promise.resolve();
  assert.equal(children[0].killed, true); assert.equal(settled, false);
  children[0].emit('exit', 1);
  assert.match((await request).message, /timed out/);
});
