import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);
const moduleUrl = new URL('../src/quota/readers/quota-fetch-state.js', import.meta.url).href;

async function listen(server: Server, t: TestContext): Promise<number> {
  const sockets = new Set<Socket>();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return (server.address() as { port: number }).port;
}

async function fixture(t: TestContext) {
  const requests: Array<{ path: string | undefined; authorization: string | undefined }> = [];
  const port = await listen(createServer((request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization });
    request.resume();
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/credential-leak' });
      response.end();
      return;
    }
    response.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '90' });
    response.write('{"ok":');
    setImmediate(() => response.end('true}'));
  }), t);
  const tunnels: Array<{ target: string | undefined; authorization: string | undefined }> = [];
  const proxy = createServer();
  proxy.on('connect', (request, client, head) => {
    tunnels.push({ target: request.url, authorization: request.headers.authorization });
    const upstream = connect(port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    client.on('error', () => upstream.destroy());
    client.on('close', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    upstream.on('close', () => client.destroy());
  });
  const proxyPort = await listen(proxy, t);
  return {
    requests, tunnels,
    remote: `http://quota.invalid:${port}`,
    local: `http://127.0.0.1:${port}`,
    proxy: `http://127.0.0.1:${proxyPort}`,
    async read(url: string, overrides: NodeJS.ProcessEnv = {}, abort = false) {
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (/^(?:https?_proxy|all_proxy|no_proxy|node_use_env_proxy|node_options)$/i.test(key)) delete env[key];
      }
      const { stdout } = await run(process.execPath, ['--input-type=module', '-e', `
        import { quotaNodeFetch, captureQuotaRead, quotaReadRetryAfter } from ${JSON.stringify(moduleUrl)};
        try {
          const snapshot = await captureQuotaRead(async () => {
            const response = await quotaNodeFetch(new Request(process.argv[1]), {
              headers: { Authorization: 'Bearer fixture-token' },
              redirect: 'error', credentials: 'omit', cache: 'no-store',
              signal: ${abort ? 'AbortSignal.abort()' : 'AbortSignal.timeout(3000)'},
            });
            return { status: response.status, body: await response.json() };
          });
          console.log(JSON.stringify({ ...snapshot, retryAfter: quotaReadRetryAfter(snapshot) }));
        } catch (error) {
          console.log(JSON.stringify({ error: error.name, code: error.cause?.code ?? error.code ?? null }));
        }
      `, url], { env: { ...env, ...overrides }, timeout: 10_000 });
      return JSON.parse(stdout);
    },
  };
}

for (const proxyVariable of ['HTTP_PROXY', 'http_proxy']) {
  test(`quota fetch uses ${proxyVariable} without NODE_USE_ENV_PROXY and retains body/auth/cooldown`, async t => {
    const current = await fixture(t);
    const result = await current.read(`${current.remote}/usage`, { [proxyVariable]: current.proxy });
    assert.deepEqual(result, { status: 429, body: { ok: true }, retryAfter: 90 });
    assert.deepEqual(current.tunnels, [{ target: new URL(current.remote).host, authorization: undefined }]);
    assert.deepEqual(current.requests, [{ path: '/usage', authorization: 'Bearer fixture-token' }]);
  });
}

test('quota fetch keeps loopback direct even with a proxy and no NO_PROXY', async t => {
  const current = await fixture(t);
  const result = await current.read(`${current.local}/usage`, { HTTP_PROXY: current.proxy });
  assert.equal(result.status, 429);
  assert.deepEqual(current.tunnels, []);
  assert.equal(current.requests.length, 1);
});

test('quota fetch keeps local credentials direct when global Node environment proxying is enabled', async t => {
  const current = await fixture(t);
  const result = await current.read(`${current.local}/usage`, { HTTP_PROXY: current.proxy, NODE_USE_ENV_PROXY: '1' });
  assert.equal(result.status, 429);
  assert.deepEqual(current.tunnels, []);
  assert.equal(current.requests.length, 1);
});

test('quota fetch respects NO_PROXY for remote hosts', async t => {
  const current = await fixture(t);
  const result = await current.read(`${current.remote}/usage`, { HTTP_PROXY: current.proxy, NO_PROXY: 'quota.invalid' });
  assert.equal(result.error, 'TypeError');
  assert.deepEqual(current.tunnels, []);
  assert.deepEqual(current.requests, []);
});

test('quota fetch works without proxy configuration', async t => {
  const current = await fixture(t);
  assert.deepEqual(await current.read(`${current.local}/usage`), { status: 429, body: { ok: true }, retryAfter: 90 });
  assert.deepEqual(current.tunnels, []);
});

test('proxied quota requests preserve redirect rejection and do not forward credentials', async t => {
  const current = await fixture(t);
  const result = await current.read(`${current.remote}/redirect`, { HTTP_PROXY: current.proxy });
  assert.equal(result.error, 'TypeError');
  assert.deepEqual(current.requests, [{ path: '/redirect', authorization: 'Bearer fixture-token' }]);
});

test('quota fetch preserves an aborted signal without making a proxy request', async t => {
  const current = await fixture(t);
  const result = await current.read(`${current.remote}/usage`, { HTTP_PROXY: current.proxy }, true);
  assert.equal(result.error, 'AbortError');
  assert.deepEqual(current.tunnels, []);
  assert.deepEqual(current.requests, []);
});
