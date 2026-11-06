import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { registerAccountLaunchApi } from '../src/server/account-launch-api.js';
import { registerBillingApi } from '../src/server/billing-api.js';
import { createHttpServer, listenServer } from '../src/server/http-server.js';

test('real HTTP preserves Host checks and bounds new privileged routes before buffering their bodies', async t => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-account-http-')); t.after(() => rm(root, { recursive: true, force: true }));
  const app = new Hono(); registerAccountLaunchApi(app, { dataDir: root, quotaDirectory: join(root, 'quota'), getState: () => null }); registerBillingApi(app, { dataDir: root });
  // The configured bind address is not the request's Host.
  const server = createHttpServer({ honoApp: app, staticDir: root, host: '0.0.0.0', port: 0 });
  const { port } = await listenServer(server, '127.0.0.1', 0); t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const send = (path: string, host: string, body?: string, chunked = false) => new Promise<number>((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method: body ? 'POST' : 'GET', headers: { Host: host, ...(body ? { 'Content-Type': 'application/json', ...(chunked ? {} : { 'Content-Length': Buffer.byteLength(body) }) } : {}) } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
    req.on('error', reject); if (chunked && body) { req.write(body.slice(0, 100)); req.end(body.slice(100)); } else req.end(body);
  });
  for (const path of ['/functions/tud-account-launch', '/functions/tud-claude-billing']) {
    assert.equal(await send(path, 'attacker.example'), 403);
    assert.equal(await send(path, `localhost:${port}`), 200);
    assert.equal(await send(path, `127.0.0.1:${port}`, JSON.stringify({ padding: 'x'.repeat(25 * 1024) })), 413);
  }
  for (const path of ['/functions/x/../tud-account-launch', '/functions/%2e/tud-claude-billing', '/functions/x/%2e%2e/tud-account-launch']) {
    assert.equal(await send(path, 'attacker.example'), 403);
    assert.equal(await send(path, `localhost:${port}`), 200);
    assert.equal(await send(path, `localhost:${port}`, JSON.stringify({ padding: 'x'.repeat(25 * 1024) }), true), 413);
  }
});
