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
    const slow = body.messages.at(-1)?.content === 'Slow' || body.messages.at(-1)?.content.includes('随口说一句');
    if (slow) await new Promise(resolve => setTimeout(resolve, 100));
    if (!response.destroyed) { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content: `reply-${calls.length}` }, finish_reason: 'stop' }] })); }
  });
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
  const models = new DshPetModelService(root, { isEncryptionAvailable: () => false, encryptString: () => { throw new Error(); }, decryptString: () => { throw new Error(); } });
  await models.setProviders({ id: 'local', name: 'Local', baseUrl: `http://127.0.0.1:${(api.address() as { port: number }).port}/v1`, models: ['test'] });
  await models.setDefaultModel({ provider: 'local', model: 'test' });
  const config = new DshPetConfigStore(root, path.resolve('out/dsh-pet'));
  const memory = new DshPetMemoryStore(root);
  let reloads = 0, now = Date.now(), focused = false; const notifications: string[] = [], targets: unknown[] = [];
  const service = new DshPetService({ config, models, memory, assets: new DshPetAssetStore(root, path.resolve('out/dsh-pet')), getQuota: () => null, quotaSource: () => null, reload: async () => { reloads++; }, showMainWindow: () => {}, now: () => now, notify: (title, _body, target) => { notifications.push(title); targets.push(target); }, isMainWindowVisible: () => focused });
  const call = async (method: string, route: string, body?: unknown, signal?: AbortSignal) => {
    const result = await service.handle({ id: 1, method, url: `/dsh-pet-7340/${route}`, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, signal);
    return { status: result.status, body: JSON.parse(result.body ?? '{}') };
  };
  return { root, models, memory, config, service, call, calls, notifications, targets, focus: (value: boolean) => { focused = value; }, get reloads() { return reloads; }, advance: (ms: number) => { now += ms; }, close: async () => { service.dispose(); api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve())); await rm(root, { recursive: true, force: true }); } };
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

test('legacy inactive companions receive neither automatic model requests nor manual actions', async () => {
  const f = await fixture();
  try {
    const pet = (f.config.read().main!.pets as object[])[0]!;
    await f.config.patchMain({ pets: [{ ...pet, whisperEnabled: true }, { ...pet, id: 'unused', whisperEnabled: true }] });
    await f.service.refreshAutomatic();
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(f.calls.length, 1, 'only the active companion can generate automatic whispers');
    assert.equal((await f.call('POST', 'chat?pet=unused', { text: 'No request' })).status, 404);
    assert.equal(f.calls.length, 1);
    assert.equal((await f.call('GET', 'state')).body.pets.unused, undefined);
  } finally { await f.close(); }
});

test('explicit notifications respect focus, the global switch and event deduplication', async () => {
  const f = await fixture();
  try {
    const event = { id: 'notice', source: 'dsh', sessionId: 's', timestamp: new Date(Date.now()).toISOString(), state: 'waiting' as const, evidence: 'approval/asked' };
    f.service.onActivity(event); f.service.onActivity(event); assert.equal(f.notifications.length, 1);
    assert.deepEqual(f.targets[0], { source: 'dsh', sessionId: 's' });
    f.focus(true); f.service.onActivity({ ...event, id: 'focused' }); assert.equal(f.notifications.length, 1);
    f.focus(false); await f.config.patchMain({ notificationsEnabled: false }); f.service.onActivity({ ...event, id: 'muted' }); assert.equal(f.notifications.length, 1);
  } finally { await f.close(); }
});

test('manual whisper works with automatic whispers off; an incoming chat cancels a pending whisper', async () => {
  const f = await fixture();
  try {
    const main = f.config.read().main!;
    await f.config.patchMain({ pets: (main.pets as Record<string, unknown>[]).map(pet => ({ ...pet, whisperEnabled: false })) });
    assert.equal((await f.call('POST', 'whisper?pet=main')).body.ok, true);
    const counter = (await f.call('GET', 'state')).body.pets.main.say.counter;
    const pending = f.call('POST', 'whisper?pet=main'); await new Promise(resolve => setTimeout(resolve, 20));
    const chat = f.call('POST', 'chat?pet=main', { text: 'Slow' });
    assert.equal((await pending).body.ok, false);
    assert.equal((await f.call('GET', 'state')).body.pets.main.say.counter, counter);
    assert.equal((await chat).body.ok, true);
    assert.equal(f.memory.get('main', 'main', 5).length, 2);
  } finally { await f.close(); }
});

test('model replies clear their own work bubble while retaining external agent status', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call('POST', 'chat?pet=main', { text: 'Visible reply' })).body.ok, true);
    let state = (await f.call('GET', 'state')).body;
    assert.equal(state.sections.workStatus.data.state, null, 'a synthetic completion must not cover the chat reply');
    assert.match(state.pets.main.say.data.text, /reply-/);
    assert.equal((await f.call('POST', 'whisper?pet=main')).body.ok, true);
    state = (await f.call('GET', 'state')).body;
    assert.equal(state.sections.workStatus.data.state, null);
    f.service.onActivity({ id: 'external-success', source: 'dsh', sessionId: 'external', state: 'success', timestamp: new Date().toISOString(), evidence: 'real-event', terminal: true });
    assert.equal((await f.call('POST', 'chat?pet=main', { text: 'Another reply' })).body.ok, true);
    assert.equal((await f.call('GET', 'state')).body.sections.workStatus.data.state, 'success');
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

test('DSH todo text stays with its owning session and clears on new turn or expiration', async () => {
  const f = await fixture();
  try {
    const base = { source: 'dsh', timestamp: new Date(Date.now()).toISOString(), evidence: 'tool/call' };
    f.service.onActivity({ ...base, id: 'task-a', sessionId: 'a', state: 'working' });
    f.service.onActivity({ ...base, id: 'todo-a', sessionId: 'a', state: null, taskOnly: true, task: 'Task A' });
    f.service.onActivity({ ...base, id: 'task-b', sessionId: 'b', state: 'waiting' });
    f.service.onActivity({ ...base, id: 'todo-b', sessionId: 'b', state: null, taskOnly: true, task: 'Task B' });
    assert.equal((await f.call('GET', 'state')).body.sections.workStatus.data.task, 'Task B');
    f.service.onActivity({ ...base, id: 'clear-b', sessionId: 'b', state: null });
    assert.equal((await f.call('GET', 'state')).body.sections.workStatus.data.task, 'Task A');
    f.service.onActivity({ ...base, id: 'turn-a', sessionId: 'a', evidence: 'turn/start', state: 'thinking', task: null });
    assert.equal((await f.call('GET', 'state')).body.sections.workStatus.data.task, null);
    f.service.onActivity({ ...base, id: 'todo-again', sessionId: 'a', state: null, taskOnly: true, task: 'Expires with session' });
    f.advance(130_000); await f.service.refreshAutomatic();
    assert.deepEqual((await f.call('GET', 'state')).body.sections.workStatus.data, { state: null, task: null });
  } finally { await f.close(); }
});

test('animation receipts follow renderer reports, keep terminal state and cancel replaced playback', async () => {
  const f = await fixture();
  try {
    const names = f.config.vendor.animationNames(f.config.read().main!.animations);
    const accepted = (await f.call('POST', 'anim?pet=main', { name: names[0] })).body;
    assert.equal(typeof accepted.playbackId, 'string');
    assert.equal((await f.call('GET', `playback/${accepted.playbackId}`)).body.status, 'accepted');
    await f.call('POST', `playback/${accepted.playbackId}/report?pet=main`, { status: 'playing' });
    const waiting = f.call('GET', `playback/${accepted.playbackId}?wait=ended,failed,cancelled&timeout=1000`);
    await f.call('POST', `playback/${accepted.playbackId}/report?pet=main`, { status: 'ended' });
    assert.equal((await waiting).body.status, 'ended');
    await f.call('POST', `playback/${accepted.playbackId}/report?pet=main`, { status: 'failed', reason: 'late' });
    assert.equal((await f.call('GET', `playback/${accepted.playbackId}`)).body.status, 'ended');
    const one = (await f.call('POST', 'anim?pet=main', { name: names[0] })).body;
    await f.call('POST', 'anim?pet=main', { name: names[1] });
    assert.equal((await f.call('GET', `playback/${one.playbackId}`)).body.reason, 'replaced');
    assert.equal((await f.call('GET', `playback/${one.playbackId}?wait=ended`)).status, 400);
  } finally { await f.close(); }
});

test('locks gate control, expire and let user input preempt without dropping agent state', async () => {
  const f = await fixture();
  try {
    const lock = (await f.call('POST', 'lock?pet=main', { ttl: 1000 })).body;
    assert.equal(lock.ok, true);
    await f.service.refreshAutomatic(); assert.equal(f.calls.length, 0, 'automatic whisper must not spend model calls while occupied');
    assert.equal((await f.call('POST', 'lock?pet=main')).body.reason, 'locked');
    assert.equal((await f.call('POST', 'position?pet=main', { x: .2, y: .3, mode: 'instant' })).body.reason, 'lock-required');
    const query = `pet=main&lock=${lock.lockId}`;
    assert.equal((await f.call('POST', `position?${query}`, { x: -1, y: 2, mode: 'line', duration: 100 })).body.ok, true);
    const pos = (await f.call('GET', 'state')).body.pets.main.position.data;
    assert.deepEqual(pos, { x: 0, y: 1, mode: 'line', duration: 100 });
    assert.equal((await f.call('POST', `throw?${query}`, { angle: 90, power: 1 })).body.ok, true);
    assert.equal((await f.call('POST', `throw?${query}`, { angle: 90, power: 0 })).body.reason, 'bad-request');
    f.service.onActivity({ id: 'locked-work', source: 'dsh', sessionId: 's', state: 'working', timestamp: new Date().toISOString(), evidence: 'tool/call' });
    assert.equal((await f.call('GET', 'state')).body.sections.workStatus.data.state, 'working');
    f.advance(1001);
    assert.equal((await f.call('POST', `throw?${query}`, { angle: 0, power: 1 })).body.cause, 'expired');
    const renewed = (await f.call('POST', 'lock?pet=main')).body;
    await f.call('POST', 'lock/release?pet=main', { force: true });
    assert.equal((await f.call('POST', 'lock?pet=main', { lockId: renewed.lockId })).body.cause, 'preempted');
    assert.equal((await f.call('POST', 'position?pet=missing', { x: .2, y: .3, mode: 'spring' })).body.ok, false);
  } finally { await f.close(); }
});

test('pending playback waits cancel on shutdown and caller abort', async () => {
  const f = await fixture();
  try {
    const name = f.config.vendor.animationNames(f.config.read().main!.animations)[0];
    const cue = (await f.call('POST', 'anim?pet=main', { name })).body;
    const abort = new AbortController();
    const pending = f.call('GET', `playback/${cue.playbackId}?wait=ended&timeout=10000`, undefined, abort.signal);
    abort.abort();
    assert.equal((await pending).body.reason, 'cancelled');
    const stopped = f.call('GET', `playback/${cue.playbackId}?wait=ended,failed,cancelled&timeout=10000`);
    f.service.dispose();
    assert.equal((await stopped).body.status, 'cancelled');
  } finally { await f.close(); }
});
