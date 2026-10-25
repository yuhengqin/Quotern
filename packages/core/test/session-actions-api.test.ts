import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore } from '../src/server/state.js';
import { request as httpRequest } from 'node:http';
import { createHttpServer, listenServer } from '../src/server/http-server.js';
import type { TudConfig } from '../src/types.js';

const route = '/functions/tud-session-actions';
const target = { source: 'codex', sessionId: 'session-123' };

async function fixture(run: (app: ReturnType<typeof createLocalApiApp>, directory: string, launches: unknown[]) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'quotern-session-actions-'));
  const directory = join(root, "项目 ' & workspace");
  const launches: unknown[] = [];
  try {
    await mkdir(join(root, 'sessions'));
    await mkdir(directory);
    const log = join(root, 'session.jsonl');
    await writeFile(log, JSON.stringify({ type: 'session_meta', payload: { id: target.sessionId, cwd: directory } }) + '\n');
    await writeFile(join(root, 'sessions', 'codex.json'), JSON.stringify({ files: { [log]: { context: { sessionId: target.sessionId } } } }));
    const deps = {
      dataDir: root, bucketStore: new BucketStore(), getConfig: () => ({ statsSince: '2020-01-01' } as TudConfig),
      sessionActions: {
        openDirectory: async (path: string) => { launches.push({ action: 'open-directory', directory: path }); },
        resume: async (path: string, command: unknown) => { launches.push({ action: 'resume', directory: path, command }); },
      },
    };
    await run(createLocalApiApp(deps), await realpath(directory), launches);
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function capabilities(app: ReturnType<typeof createLocalApiApp>) {
  const response = await app.request(`${route}?${new URLSearchParams(target)}`);
  assert.equal(response.status, 200);
  return (await response.json()).data as { token: string; directory: string; canResume: boolean; canOpenDirectory: boolean };
}

test('session actions use the collected project directory and fixed resume argv', async () => {
  await fixture(async (app, directory, launches) => {
    const details = await capabilities(app);
    assert.equal(details.directory, directory);
    assert.equal(details.canResume, true);
    assert.equal(details.canOpenDirectory, true);
    assert.ok(details.token.length >= 32);
    for (const action of ['open-directory', 'resume']) {
      const response = await app.request(route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Quotern-Session-Action': details.token }, body: JSON.stringify({ ...target, action }) });
      assert.equal(response.status, 200);
    }
    assert.deepEqual(launches, [
      { action: 'open-directory', directory },
      { action: 'resume', directory, command: { executable: 'codex', args: ['resume', 'session-123'] } },
    ]);
  });
});

test('foreign origins, remote hosts and missing or forged tokens cannot launch actions', async () => {
  await fixture(async (app, _directory, launches) => {
    const { token } = await capabilities(app);
    for (const url of ['http://127.0.0.1' + route, 'http://tud.local' + route]) {
      for (const origin of ['https://evil.example', 'null']) {
        assert.equal((await app.request(url + '?' + new URLSearchParams(target), { headers: { Origin: origin } })).status, 403);
        assert.equal((await app.request(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Quotern-Session-Action': token }, body: JSON.stringify({ ...target, action: 'resume' }) })).status, 403);
      }
    }
    assert.equal((await app.request('http://192.168.1.2' + route + '?' + new URLSearchParams(target))).status, 403);
    assert.equal((await app.request('http://rebind.example' + route + '?' + new URLSearchParams(target))).status, 403);
    for (const supplied of ['', 'wrong-token']) {
      assert.equal((await app.request(route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Quotern-Session-Action': supplied }, body: JSON.stringify({ ...target, action: 'resume' }) })).status, 403);
    }
    assert.deepEqual(launches, []);
  });
});

test('session actions reject arbitrary command fields, malformed IDs and non-JSON requests', async () => {
  await fixture(async (app, _directory, launches) => {
    const { token } = await capabilities(app);
    const headers = { 'Content-Type': 'application/json', 'X-Quotern-Session-Action': token };
    for (const body of [
      { ...target, action: 'resume', command: 'calc.exe' },
      { ...target, action: 'resume', directory: 'C:/other' },
      { ...target, action: 'delete' },
      { ...target, action: ['resume'] },
      { ...target, sessionId: 's;calc', action: 'resume' },
      { ...target, sessionId: '--help', action: 'resume' },
      { ...target, source: 'constructor', action: 'resume' },
      [], null,
    ]) assert.equal((await app.request(route, { method: 'POST', headers, body: JSON.stringify(body) })).status, 400, JSON.stringify(body));
    assert.equal((await app.request(route, { method: 'POST', headers, body: '{' })).status, 400);
    assert.equal((await app.request(route, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: JSON.stringify({ ...target, action: 'resume' }) })).status, 400);
    assert.deepEqual(launches, []);
  });
});

test('HTTP peer address cannot be replaced by a loopback URL or spoofed headers', async () => {
  await fixture(async (app, _directory, launches) => {
    const response = await app.fetch(new Request(`http://127.0.0.1${route}?${new URLSearchParams(target)}`, { headers: { 'X-Forwarded-For': '127.0.0.1' } }), { quoternRemoteAddress: '192.168.1.50' });
    assert.equal(response.status, 403);
    assert.deepEqual(launches, []);
  });
});

test('real HTTP transport checks the incoming Host and accepts loopback on a wildcard listener', async () => {
  await fixture(async (app, directory, launches) => {
    for (const host of ['127.0.0.1', '0.0.0.0']) {
      const server = createHttpServer({ honoApp: app, staticDir: directory, host, port: 0 });
      const { port } = await listenServer(server, host, 0);
      try {
        const get = (header: string) => new Promise<number>((resolve, reject) => {
          const request = httpRequest({ hostname: '127.0.0.1', port, path: `${route}?${new URLSearchParams(target)}`, headers: { Host: header } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode!)); });
          request.on('error', reject); request.end();
        });
        assert.equal(await get('rebind.example'), 403, host);
        assert.equal(await get(`127.0.0.1:${port}`), 200, host);
      } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    }
    assert.deepEqual(launches, []);
  });
});

test('missing sessions and directories never launch and return actionable errors', async () => {
  await fixture(async (app, directory, launches) => {
    const { token } = await capabilities(app);
    await rm(directory, { recursive: true });
    const response = await app.request(route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Quotern-Session-Action': token }, body: JSON.stringify({ ...target, action: 'resume' }) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, 'SESSION_DIRECTORY_UNAVAILABLE');
    assert.deepEqual(launches, []);
  });
});
