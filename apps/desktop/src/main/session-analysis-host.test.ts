import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { transformSync } from 'esbuild';
import type { AnalysisContext, AnalysisRequest } from './session-analysis-protocol.js';

class Child extends EventEmitter {
  stdout = new EventEmitter(); stderr = new EventEmitter(); pid = 500; killed = false; failSend = false;
  messages: AnalysisRequest[] = [];
  postMessage(message: AnalysisRequest) { if (this.failSend) throw new Error('send failed'); this.messages.push(message); this.emit('sent', message); }
  kill() { this.killed = true; queueMicrotask(() => this.emit('exit', 0)); return true; }
  ready() { this.emit('message', { type: 'ready', pid: this.pid }); }
}
const context = (): AnalysisContext => ({ dataDir: 'fixture', config: { statsSince: '2026-01-01T00:00:00Z' } as AnalysisContext['config'],
  bucketRevision: 1, collectSince: '2026-01-01T00:00:00Z', rows: [], pricingFingerprint: 'one', pricing: { builtin: { exact: {} }, overlay: null }, quotaState: null });
const url = 'http://tud.local/functions/tud-session-activity?days=7';
function loadHost(t: TestContext) {
  const children: Child[] = [];
  const code = transformSync(readFileSync(join(__dirname, '../../src/main/session-analysis-host.ts'), 'utf8'), { loader: 'ts', format: 'cjs', target: 'node22' }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'console', code)((id: string) => id === 'electron' ? { utilityProcess: { fork: () => {
    const child = new Child(); child.pid += children.length; children.push(child); return child;
  } } } : id.includes('?modulePath') ? 'worker.js' : require(id), module, module.exports, { log() {}, warn() {}, error() {} });
  const host = module.exports as { runSessionAnalysisRequest(url: string, init: undefined, snapshot: AnalysisContext): Promise<{ status: number; body: unknown }>; stopSessionAnalysisWorker(): Promise<void> };
  t.after(() => host.stopSessionAnalysisWorker());
  return { host, children };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('analysis startup is shared and unchanged requests do not resend buckets or pricing', async t => {
  const { host, children } = loadHost(t);
  const first = host.runSessionAnalysisRequest(url, undefined, context());
  const second = host.runSessionAnalysisRequest(url, undefined, context());
  assert.equal(children.length, 1);
  children[0]!.ready(); await flush();
  assert.equal(children[0]!.messages.length, 2);
  assert.deepEqual(children[0]!.messages[0]!.snapshot.rows, []);
  assert.equal(children[0]!.messages[1]!.snapshot.rows, undefined);
  assert.equal(children[0]!.messages[1]!.snapshot.pricing, undefined);
  for (const message of children[0]!.messages) children[0]!.emit('message', { type: 'result', id: message.id, result: { status: 200, body: { query: message.id } } });
  assert.equal((await first).status, 200); assert.equal((await second).status, 200);
});

test('stopping during startup rejects callers and a late ready cannot revive that process', async t => {
  const { host, children } = loadHost(t);
  const old = host.runSessionAnalysisRequest(url, undefined, context()).catch(error => error);
  await host.stopSessionAnalysisWorker(); children[0]!.ready();
  assert.match((await old).message, /stopped/);
  const current = host.runSessionAnalysisRequest(url, undefined, context());
  children[1]!.ready(); await flush();
  const request = children[1]!.messages[0]!;
  children[0]!.emit('message', { type: 'error', id: request.id, error: 'obsolete' });
  children[1]!.emit('message', { type: 'result', id: request.id, result: { status: 200, body: 'current' } });
  assert.equal((await current).body, 'current');
});

test('an analysis timeout rejects pending work and terminates only its analysis process', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { host, children } = loadHost(t);
  const pending = host.runSessionAnalysisRequest(url, undefined, context()).catch(error => error);
  children[0]!.ready(); await flush(); t.mock.timers.tick(30000); await flush();
  assert.match((await pending).message, /timed out/);
  assert.equal(children[0]!.killed, true);
});

test('a failed send does not mark an unsent snapshot as applied', async t => {
  const { host, children } = loadHost(t);
  const first = host.runSessionAnalysisRequest(url, undefined, context()).catch(error => error);
  children[0]!.failSend = true; children[0]!.ready(); await flush();
  assert.match((await first).message, /send failed/);
  children[0]!.failSend = false;
  const next = host.runSessionAnalysisRequest(url, undefined, context()); await flush();
  const request = children[0]!.messages[0]!;
  assert.deepEqual(request.snapshot.rows, []);
  children[0]!.emit('message', { type: 'result', id: request.id, result: { status: 200, body: null } }); await next;
});
