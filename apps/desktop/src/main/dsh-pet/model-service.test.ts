import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DshPetModelService } from './model-service.js';

function secretStorage() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value: string) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]); },
    decryptString(value: Buffer) { const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8'); },
  };
}

async function mockModel(handler: (body: Record<string, unknown>, request: IncomingMessage, response: ServerResponse) => void | Promise<void>) {
  const server = createServer(async (request, response) => {
    let text = ''; for await (const chunk of request) text += String(chunk);
    await handler(JSON.parse(text), request, response);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/v1`, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
const completion = (response: ServerResponse, text = 'Hello') => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] })); };

test('encrypts separate credentials, redacts settings, and records a single fallback to the configured default', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-model-'));
  const calls: string[] = [];
  const api = await mockModel((body, request, response) => { calls.push(String(body.model)); assert.equal(request.headers.authorization, 'Bearer private-model-key'); if (body.model === 'bad') { response.writeHead(503); response.end(); } else completion(response); });
  const service = new DshPetModelService(root, secretStorage());
  try {
    await service.setProviders({ id: 'local', name: 'Local', baseUrl: api.url, models: ['good', 'bad'], apiKey: 'private-model-key' });
    await service.setDefaultModel({ provider: 'local', model: 'good' });
    const result = await service.generate({ petId: 'main', kind: 'chat', messages: [{ role: 'user', content: 'Hi' }], preferred: { provider: 'local', model: 'bad' } });
    assert.equal(result.text, 'Hello'); assert.equal(result.model, 'good'); assert.equal(result.fallback, true);
    assert.deepEqual(calls, ['bad', 'good']);
    assert.ok(!JSON.stringify(service.publicState()).includes('private-model-key'));
    assert.ok(!(await readFile(path.join(root, 'models.json'), 'utf8')).includes('private-model-key'));
  } finally { service.dispose(); await api.close(); await rm(root, { recursive: true, force: true }); }
});

test('never persists plaintext when system encryption is unavailable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-model-'));
  const service = new DshPetModelService(root, { isEncryptionAvailable: () => false, encryptString: () => { throw new Error('unavailable'); }, decryptString: () => { throw new Error('unavailable'); } });
  try {
    await assert.rejects(service.setProviders({ id: 'local', name: 'Local', baseUrl: 'http://localhost:1/v1', models: ['good'], apiKey: 'private-model-key' }), /加密|encrypt/i);
    await assert.rejects(readFile(path.join(root, 'models.json')), { code: 'ENOENT' });
  } finally { service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('serializes chats per pet, keeps whispers from interrupting them, and never falls back on cancellation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-model-'));
  let active = 0, peak = 0;
  const calls: string[] = [];
  const api = await mockModel(async (body, _request, response) => { calls.push(String(body.model)); active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 60)); active--; if (!response.destroyed) completion(response); });
  const service = new DshPetModelService(root, secretStorage());
  try {
    await service.setProviders({ id: 'local', name: 'Local', baseUrl: api.url, models: ['good', 'slow'] });
    await service.setDefaultModel({ provider: 'local', model: 'good' });
    const input = { petId: 'main', kind: 'chat' as const, messages: [{ role: 'user' as const, content: 'Hi' }] };
    const first = service.generate(input), second = service.generate(input);
    assert.equal((await service.generate({ ...input, kind: 'whisper' })).reason, 'busy');
    assert.equal((await first).ok, true); assert.equal((await second).ok, true); assert.equal(peak, 1);
    const abort = new AbortController();
    const cancelled = service.generate({ ...input, preferred: { provider: 'local', model: 'slow' }, signal: abort.signal });
    await new Promise(resolve => setTimeout(resolve, 15)); abort.abort();
    assert.equal((await cancelled).reason, 'cancelled');
    assert.deepEqual(calls, ['good', 'good', 'slow']);
  } finally { service.dispose(); await api.close(); await rm(root, { recursive: true, force: true }); }
});

test('enforces one total time budget across a slow primary and fallback', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quotern-dsh-model-'));
  const api = await mockModel(async (_body, _request, response) => { await new Promise(resolve => setTimeout(resolve, 100)); if (!response.destroyed) { response.writeHead(503); response.end(); } });
  const service = new DshPetModelService(root, secretStorage(), { timeoutMs: 35 });
  try {
    await service.setProviders({ id: 'local', name: 'Local', baseUrl: api.url, models: ['good', 'bad'] });
    await service.setDefaultModel({ provider: 'local', model: 'good' });
    const start = Date.now();
    const result = await service.generate({ petId: 'main', kind: 'chat', messages: [], preferred: { provider: 'local', model: 'bad' } });
    assert.equal(result.ok, false); assert.equal(result.reason, 'timeout');
    assert.ok(Date.now() - start < 200);
  } finally { service.dispose(); await api.close(); await rm(root, { recursive: true, force: true }); }
});
