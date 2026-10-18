import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connect } from 'node:net';
import { once } from 'node:events';
import { DshPetRpcServer } from './rpc.js';

test('authenticates private pipe requests and aborts handlers when their client disconnects', async () => {
  const server = new DshPetRpcServer();
  let observedAbort: Promise<void> | undefined;
  const { endpoint, token } = await server.start(async (request, signal) => {
    if (request.url.endsWith('/state')) return { status: 200, body: '{"ready":true}' };
    observedAbort = new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    await observedAbort;
    return { status: 499 };
  });
  try {
    const invalid = connect(endpoint);
    const invalidClosed = once(invalid, 'close');
    invalid.write(JSON.stringify({ token: 'wrong', id: 1, method: 'GET', url: '/dsh-pet-7340/state' }) + '\n');
    await invalidClosed;
    const client = connect(endpoint);
    const result = once(client, 'data');
    client.write(JSON.stringify({ token, id: 1, method: 'GET', url: '/dsh-pet-7340/state' }) + '\n');
    const [data] = await result;
    assert.deepEqual(JSON.parse(String(data)), { id: 1, status: 200, body: '{"ready":true}' });
    client.write(JSON.stringify({ token, id: 2, method: 'POST', url: '/dsh-pet-7340/chat' }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 30));
    client.destroy();
    assert.ok(observedAbort);
    await observedAbort;
  } finally { await server.close(); }
});

test('drops oversized input before any action is dispatched', async () => {
  const server = new DshPetRpcServer({ maxBytes: 128 });
  let dispatched = false;
  const { endpoint } = await server.start(async () => { dispatched = true; return { status: 200 }; });
  try {
    const client = connect(endpoint);
    const closed = once(client, 'close');
    client.write('x'.repeat(256));
    await closed;
    assert.equal(dispatched, false);
  } finally { await server.close(); }
});

test('bounds a stalled host request and returns an explicit timeout response', async () => {
  const server = new DshPetRpcServer({ timeoutMs: 25 });
  const { endpoint, token } = await server.start(async () => new Promise(() => {}));
  const client = connect(endpoint);
  try {
    const response = once(client, 'data');
    client.write(JSON.stringify({ token, id: 1, method: 'GET', url: '/dsh-pet-7340/state' }) + '\n');
    const [data] = await response;
    assert.deepEqual(JSON.parse(String(data)), { id: 1, status: 504 });
  } finally { client.destroy(); await server.close(); }
});
