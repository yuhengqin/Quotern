import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DshPetService } from './service.js';
import { DshPetConfigStore } from './config-store.js';
import { DshPetAssetStore } from './asset-store.js';
import { DshPetModelService, type ModelMessage } from './model-service.js';
import { DshPetMemoryStore } from './memory-store.js';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-service-'));
  const calls: ModelMessage[][] = [];
  const api = createServer(async (request, response) => {
    let text = ''; for await (const chunk of request) text += String(chunk);
    const body = JSON.parse(text) as { messages: ModelMessage[] };
    calls.push(body.messages);
    const slow = body.messages.at(-1)?.content === 'Slow';
    if (slow) await new Promise(resolve => setTimeout(resolve, 100));
    if (!response.destroyed) { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content: `reply-${calls.length}` }, finish_reason: 'stop' }] })); }
  });
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
  const models = new DshPetModelService(root, { isEncryptionAvailable: () => false, encryptString: () => { throw new Error(); }, decryptString: () => { throw new Error(); } });
  await models.setProviders({ id: 'local', name: 'Local', baseUrl: `http://127.0.0.1:${(api.address() as { port: number }).port}/v1`, models: ['test'] });
  await models.setDefaultModel({ provider: 'local', model: 'test' });
  const config = new DshPetConfigStore(root, path.resolve('out/dsh-pet'));
  const memory = new DshPetMemoryStore(root);
  let reloads = 0, now = Date.now();
  const service = new DshPetService({ config, models, memory, assets: new DshPetAssetStore(root, path.resolve('out/dsh-pet')), getQuota: () => null, quotaSource: () => null, reload: async () => { reloads++; }, showMainWindow: () => {}, now: () => now });
  const call = async (method: string, route: string, body?: unknown, signal?: AbortSignal) => {
    const result = await service.handle({ id: 1, method, url: `/dsh-pet-7340/${route}`, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, signal);
    return { status: result.status, body: JSON.parse(result.body ?? '{}') };
  };
  return { root, models, memory, config, service, call, calls, get reloads() { return reloads; }, advance: (ms: number) => { now += ms; }, close: async () => { service.dispose(); api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve())); await rm(root, { recursive: true, force: true }); } };
}

test('preserves runtime state/action contracts and validates every built-in animation', async () => {
  const f = await fixture();
  try {
    const cfg = (await f.call('GET', 'config')).body;
    assert.ok(Array.isArray(cfg.main.pets));
    const initial = (await f.call('GET', 'state')).body;
    assert.deepEqual(initial.sections.workStatus, { counter: 0, data: null });
    const names = f.config.vendor.animationNames(cfg.main.animations);
    assert.equal(names.length, 106);
    for (const name of names) assert.equal((await f.call('POST', 'anim?pet=main', { name })).body.ok, true);
    assert.equal((await f.call('POST', 'anim?pet=main', { name: 'missing' })).body.ok, false);
    assert.equal((await f.call('POST', 'broadcast?pet=main', { text: 'hello' })).body.ok, true);
    const state = (await f.call('GET', 'state')).body;
    assert.equal(state.pets.main.say.data.text, 'hello'); assert.ok(state.pets.main.anim.counter > 0);
    assert.equal((await f.call('POST', 'balance')).body.ok, true);
    assert.equal((await f.call('GET', 'state')).body.sections.balance.data.ok, false);
    assert.equal((await f.call('POST', 'pet-display', { id: 'main', display: 'none' })).status, 200);
    assert.equal((f.config.read().main!.pets as Array<{ display: string }>)[0]!.display, 'none');
    await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(f.reloads, 1);
  } finally { await f.close(); }
});

test('serializes the whole conversation, publishes after memory commits, and cancels without stale writes', async () => {
  const f = await fixture();
  try {
    const replies = await Promise.all([f.call('POST', 'chat?pet=main', { text: 'One' }), f.call('POST', 'chat?pet=main', { text: 'Two' })]);
    assert.ok(replies.every(reply => reply.body.ok && reply.body.text === undefined));
    assert.deepEqual(f.calls[1]!.filter(message => message.role === 'user').map(message => message.content), ['One', 'Two']);
    assert.equal(f.memory.get('main', 'main', 10).length, 4);
    const before = (await f.call('GET', 'state')).body.pets.main.say.counter;
    const abort = new AbortController();
    const slow = f.call('POST', 'chat?pet=main', { text: 'Slow' }, abort.signal);
    await new Promise(resolve => setTimeout(resolve, 20)); abort.abort();
    assert.equal((await slow).body.ok, false);
    assert.equal(f.memory.get('main', 'main', 10).length, 4);
    assert.equal((await f.call('GET', 'state')).body.pets.main.say.counter, before);
    assert.equal((await f.call('GET', 'chat?pet=main')).body.messages.length, 4);
  } finally { await f.close(); }
});

test('keeps six-state priorities, deduplicates events and clears expired work without celebrating', async () => {
  const f = await fixture();
  try {
    const event = { id: '1', source: 'dsh', sessionId: 'a', timestamp: new Date(Date.now()).toISOString(), state: 'working' as const, evidence: 'tool/call' };
    f.service.onActivity(event);
    f.service.onActivity({ ...event, id: '2', sessionId: 'b', state: 'waiting' });
    let work = (await f.call('GET', 'state')).body.sections.workStatus;
    assert.equal(work.data.state, 'waiting'); const counter = work.counter;
    f.service.onActivity({ ...event, id: '2', sessionId: 'b', state: 'waiting' });
    assert.equal((await f.call('GET', 'state')).body.sections.workStatus.counter, counter);
    f.service.onActivity({ ...event, id: '3', sessionId: 'b', state: null });
    assert.equal((await f.call('GET', 'state')).body.sections.workStatus.data.state, 'working');
    f.advance(130_000); await f.service.refreshAutomatic();
    work = (await f.call('GET', 'state')).body.sections.workStatus;
    assert.deepEqual(work.data, { state: null, task: null });
  } finally { await f.close(); }
});
