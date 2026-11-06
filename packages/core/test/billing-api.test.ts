import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { BillingService, protectBillingSecret, unprotectBillingSecret } from '../src/quota/billing-store.js';
import { registerBillingApi } from '../src/server/billing-api.js';

const synthetic = 'sessionKey=synthetic-secret-never-return';
const codec = { protect: async (value: string) => ({ kind: 'test' as const, value: Buffer.from(value).toString('base64') }), unprotect: async (value: { value: string }) => Buffer.from(value.value, 'base64').toString() };
const response = (input: RequestInfo | URL) => String(input).endsWith('/organizations') ? Response.json([{ uuid: 'org-1', name: 'Work' }]) : Response.json({ used_credits: 125, monthly_credit_limit: 500, is_enabled: true, remaining_balance: 0, total_granted: 0, currency: 'USD' });

test('billing connections stay independent; local actions never expose credentials and reject remote and stale writes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-billing-api-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const service = new BillingService(dir, { fetch: (async input => response(input)) as typeof fetch, codec });
  const app = new Hono(); registerBillingApi(app, { service });
  const url = 'http://localhost/functions/tud-claude-billing', get = () => app.request(url);
  assert.equal((await app.request(url, { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await app.request(url, {}, { quoternRemoteAddress: '192.0.2.20' })).status, 403);
  const view = (await (await get()).json()).data;
  const post = (body: unknown, token = view.token) => app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Quotern-Billing-Action': token }, body: JSON.stringify(body) });
  assert.equal((await post({ action: 'discover', source: 'extra', cookie: synthetic }, '')).status, 403);
  assert.equal((await post({ action: 'discover', source: 'extra', cookie: synthetic, url: 'https://elsewhere' })).status, 400);
  const discovery = await (await post({ action: 'discover', source: 'extra', cookie: synthetic })).json(); assert.deepEqual(discovery.data, [{ id: 'org-1', name: 'Work' }]);
  const connected = await (await post({ action: 'connect', source: 'extra', cookie: synthetic, organizationId: 'org-1', revision: 'initial' })).json();
  assert.equal(connected.data.connections.extra.organization.name, 'Work'); assert.equal(connected.data.connections.console.organization, null);
  assert.ok(!JSON.stringify(connected).includes('synthetic-secret'));
  const revision = connected.data.connections.extra.revision;
  assert.equal((await post({ action: 'disconnect', source: 'extra', revision: 'initial' })).status, 409);
  const refreshed = await (await post({ action: 'refresh', source: 'extra', revision })).json(); assert.equal(refreshed.data.connections.extra.report.spend.data.usedUsd, 1.25);
  assert.ok(!JSON.stringify(refreshed).includes(synthetic));
  await post({ action: 'disconnect', source: 'extra', revision: refreshed.data.connections.extra.revision });
  const disconnected = await (await get()).json(); assert.equal(disconnected.data.connections.extra.report, null);
  assert.ok(!(await readFile(join(dir, 'billing-private', 'extra.json'), 'utf8')).includes(Buffer.from(synthetic).toString('base64')));
});

test('disconnect during an in-flight refresh cannot resurrect the connection or its report', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-billing-race-')); t.after(() => rm(dir, { recursive: true, force: true }));
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }), begin = new Promise<void>(resolve => { started = resolve; });
  const service = new BillingService(dir, { codec, fetch: (async input => {
    if (String(input).endsWith('/organizations')) return response(input);
    started(); await waiting; return response(input);
  }) as typeof fetch });
  await service.connect('extra', synthetic, 'org-1', 'initial');
  const current = (await service.view()).extra;
  const refresh = service.refresh('extra', current.revision); await begin;
  await service.disconnect('extra', current.revision); release();
  await assert.rejects(refresh, /BILLING_CONFLICT/);
  assert.equal((await service.view()).extra.organization, null); assert.equal((await service.view()).extra.report, null);
});

test('Windows uses DPAPI ciphertext at rest and decrypts a synthetic secret without command-line secrets', { skip: process.platform !== 'win32' }, async () => {
  const protectedValue = await protectBillingSecret(synthetic);
  assert.equal(protectedValue.kind, 'dpapi'); assert.ok(!protectedValue.value.includes(synthetic));
  assert.equal(await unprotectBillingSecret(protectedValue), synthetic);
});

test('oversized projected billing retains the last readable connection and can still be removed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-billing-size-')); t.after(() => rm(dir, { recursive: true, force: true }));
  let large = false;
  const service = new BillingService(dir, { codec, now: () => new Date('2026-11-06T00:00:00Z'), fetch: (async input => {
    const url = String(input);
    if (url.endsWith('/organizations')) return response(input);
    if (url.includes('/api_keys')) return Response.json({ data: [{ id: 'k', name: 'x'.repeat(240) }] });
    if (url.includes('/usage_cost')) return Response.json({ costs: { '2026-11-01': Array.from({ length: large ? 20_000 : 1 }, () => ({ key_id: 'k', total: 1 })) } });
    return Response.json({ amount: 0, currency: 'USD' });
  }) as typeof fetch });
  await service.connect('console', synthetic, 'org-1', 'initial');
  await service.refresh('console', (await service.view()).console.revision);
  const before = (await service.view()).console; large = true;
  await assert.rejects(service.refresh('console', before.revision), /BILLING_RESPONSE_TOO_LARGE/);
  assert.deepEqual((await service.view()).console, before);
  await service.disconnect('console', before.revision); assert.equal((await service.view()).console.organization, null);
});
