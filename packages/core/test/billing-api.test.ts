import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { createBillingService } from '../src/billing/service.js';
import { registerBillingApi } from '../src/server/billing-api.js';

test('billing GET is network-free; explicit refresh coalesces and credential changes clear cached cost', async () => {
  let calls = 0, key = 'first';
  const service = createBillingService({ settings: () => ({ apiKey: key, projects: [] }), fetch: async () => {
    calls++; await new Promise(resolve => setTimeout(resolve, 10));
    return Response.json({ object: 'page', data: [], has_more: false, next_page: null });
  } });
  assert.equal(service.get(30).platform.status, 'not-queried'); assert.equal(calls, 0);
  await Promise.all([service.refresh(30), service.refresh(30)]); assert.equal(calls, 1);
  assert.equal(service.get(30).platform.status, 'ready');
  key = 'second'; assert.equal(service.get(30).platform.status, 'not-queried');
  assert.equal(calls, 1); assert.equal(service.get(7).platform.status, 'not-queried');
});
test('billing API validates local origin, exact ranges and JSON bodies without touching quota refresh', async () => {
  let calls = 0;
  const service = createBillingService({ settings: () => ({}), fetch: async () => { calls++; throw new Error('network forbidden'); } });
  const app = new Hono(); registerBillingApi(app, { service, local: range => ({ range, knownCostUsd: 0, costUsd: 0 }), quota: () => null });
  const response = await app.request('http://localhost/functions/tud-billing?days=30');
  assert.equal(response.status, 200); assert.equal(calls, 0);
  assert.equal((await response.json()).data.platform.status, 'not-configured');
  for (const url of ['http://remote.example/functions/tud-billing', 'http://localhost/functions/tud-billing?days=0', 'http://localhost/functions/tud-billing?days=7&days=30', 'http://localhost/functions/tud-billing?key=secret']) {
    assert.ok((await app.request(url)).status >= 400);
  }
  assert.equal((await app.request('http://localhost/functions/tud-billing', { headers: { Origin: 'https://remote.example' } })).status, 403);
  assert.equal((await app.request('http://localhost/functions/tud-billing/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"days":30,"apiKey":"secret"}' })).status, 400);
  assert.equal(calls, 0);
});
