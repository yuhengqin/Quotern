import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import http from 'node:http';
import test from 'node:test';
import { createDevSession as createSession, readDevStatus } from './dev-instance.mjs';

const ownedSessions = new Map();
async function createDevSession(...args) {
  const session = await createSession(...args);
  const list = ownedSessions.get(args[0]) ?? [];
  list.push(session);
  ownedSessions.set(args[0], list);
  return session;
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'quotern-dev-'));
  t.after(async () => {
    for (const session of ownedSessions.get(root) ?? []) await session.close();
    ownedSessions.delete(root);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
async function listener(t, port = 0) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.end('other-session');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });
  return server.address().port;
}
async function ownApi(t, session) {
  const server = http.createServer((_request, response) => {
    response.setHeader('X-Quotern-Dev-Instance', session.record.sessionId);
    response.end('{"ok":true}');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(session.config.apiPort, '127.0.0.1', resolve); });
  const close = () => new Promise((resolve) => server.close(resolve));
  t.after(close);
  return close;
}

test('occupied explicit port fails without stopping its listener', async (t) => {
  const root = await fixture(t);
  const port = await listener(t);
  await assert.rejects(createDevSession(root, 'api', { QUOTERN_DEV_API_PORT: String(port) }), /占用/);
  const socket = net.connect(port, '127.0.0.1');
  assert.equal(await new Promise((resolve) => socket.once('data', (data) => resolve(data.toString()))), 'other-session');
});

test('two worktrees get private state and a free port when the saved port is busy', async (t) => {
  const a = await createDevSession(await fixture(t), 'cli', {});
  t.after(() => a.close());
  await listener(t, a.config.apiPort);
  await listener(t, a.config.uiPort);
  const b = await createDevSession(await fixture(t), 'cli', {});
  t.after(() => b.close());
  assert.notEqual(a.env.QUOTERN_DATA_DIR, b.env.QUOTERN_DATA_DIR);
  assert.notEqual(a.env.QUOTERN_CONFIG_HOME, b.env.QUOTERN_CONFIG_HOME);
  assert.notEqual(a.config.apiPort, b.config.apiPort);
  assert.notEqual(a.config.uiPort, b.config.uiPort);
  assert.equal(b.env.VITE_CLI_API_ORIGIN, `http://127.0.0.1:${b.config.apiPort}`);
  assert.equal(b.env.QUOTERN_DEV_ISOLATED, '1');
});

test('a second runtime in the same worktree is refused and cannot remove the first lease', async (t) => {
  const root = await fixture(t);
  const first = await createDevSession(root, 'api', {});
  t.after(() => first.close());
  await assert.rejects(createDevSession(root, 'desktop', {}), /会话|归属/);
  const status = await readDevStatus(root);
  assert.equal(status.sessions[0].sessionId, first.record.sessionId);
  assert.equal(status.sessions[0].status, 'starting');
});

test('API and UI may run separately, UI uses this worktree API and retains ports', async (t) => {
  const root = await fixture(t);
  const api = await createDevSession(root, 'api', {});
  t.after(() => api.close());
  await ownApi(t, api);
  const ui = await createDevSession(root, 'ui', {});
  t.after(() => ui.close());
  assert.equal(ui.env.VITE_CLI_API_ORIGIN, `http://127.0.0.1:${api.config.apiPort}`);
  await ui.update({ status: 'running', children: [{ name: 'vite', pid: 42 }] });
  await ui.close(0);
  const record = JSON.parse(await readFile(ui.recordPath, 'utf8'));
  assert.equal(record.status, 'stopped');
  assert.equal(record.exitCode, 0);
  assert.ok(record.stoppedAt);
  assert.equal((await readDevStatus(root)).sessions.find((s) => s.mode === 'api').sessionId, api.record.sessionId);
});

test('invalid configuration fails before creating a runtime lease', async (t) => {
  const root = await fixture(t);
  await assert.rejects(createDevSession(root, 'cli', { QUOTERN_DEV_API_PORT: 'NaN' }), /端口/);
  await assert.rejects(createDevSession(root, 'cli', { QUOTERN_DEV_API_PORT: '42001', QUOTERN_DEV_UI_PORT: '42001' }), /端口/);
  await assert.rejects(createDevSession(root, 'ui', { VITE_CLI_API_ORIGIN: 'http://user:pass@localhost:1/path' }), /代理/);
  assert.deepEqual((await readDevStatus(root)).sessions, []);
});

test('UI cannot silently proxy an unrelated API without explicit reuse', async (t) => {
  const root = await fixture(t);
  await assert.rejects(createDevSession(root, 'ui', {}), /本 worktree.*API/);
  const ui = await createDevSession(root, 'ui', { VITE_CLI_API_ORIGIN: 'http://127.0.0.1:42099' });
  assert.equal(ui.env.VITE_CLI_API_ORIGIN, 'http://127.0.0.1:42099');
});

test('API restart refuses port drift while its existing UI is still serving', async (t) => {
  const root = await fixture(t);
  const api = await createDevSession(root, 'api', {});
  const closeApi = await ownApi(t, api);
  const ui = await createDevSession(root, 'ui', {});
  const originalPort = api.config.apiPort;
  await api.close();
  await closeApi();
  await listener(t, originalPort);
  await assert.rejects(createDevSession(root, 'api', {}), /占用/);
  await assert.rejects(createDevSession(root, 'api', { QUOTERN_DEV_API_PORT: String(originalPort + 20) }), /代理|UI/);
  assert.equal(ui.env.VITE_CLI_API_ORIGIN, `http://127.0.0.1:${originalPort}`);
  assert.equal((await readDevStatus(root)).config.apiPort, originalPort);
});

test('an API lease published before its port configuration cannot authorize a UI proxy', async (t) => {
  const root = await fixture(t);
  const port = await listener(t);
  const dir = join(root, '.quotern-dev');
  await mkdir(join(dir, 'runtime.lock'), { recursive: true });
  await writeFile(join(dir, 'runtime.lock/owner.json'), JSON.stringify({ pid: process.pid, mode: 'api', sessionId: 'new-api-starting' }));
  await writeFile(join(dir, 'instance.json'), JSON.stringify({ apiPort: port, apiSessionId: 'old-api', apiOwnerPid: process.pid }));
  await assert.rejects(createDevSession(root, 'ui', {}), /API.*发布|API.*归属/);
  assert.equal(JSON.parse(await readFile(join(dir, 'runtime.lock/owner.json'), 'utf8')).sessionId, 'new-api-starting');
});

test('a published API lease cannot authorize an unrelated server on its port', async (t) => {
  const root = await fixture(t);
  const api = await createDevSession(root, 'api', {});
  await listener(t, api.config.apiPort);
  await assert.rejects(createDevSession(root, 'ui', {}), /API.*标识|API.*就绪/);
});
