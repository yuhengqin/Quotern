import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rename, rm, symlink } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { readKimiDesktopContext } from './kimi-desktop-context';

const unixTest = process.platform === 'win32' ? test.skip : test;
const identity = { uid: 'test-account', user_region: 'cn' };
const jwt = (sub = identity.uid, exp = Date.now() / 1_000 + 3_600) =>
  `header.${Buffer.from(JSON.stringify({ sub, exp })).toString('base64url')}.signature`;

async function fixture(t: TestContext) {
  // Short paths keep fake sockets below macOS's Unix socket path limit.
  const root = await mkdtemp('/tmp/kimi-context-test-');
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, options: { socketRoot: root, platform: 'darwin' as const, env: {}, timeoutMs: 100 } };
}

async function socketServer(
  t: TestContext,
  root: string,
  name: string,
  handle: (op: string) => unknown,
) {
  const directory = path.join(root, `kimi-work-${name}`);
  await mkdir(directory, { mode: 0o700 });
  const endpoint = path.join(directory, 'context.sock');
  const connections = new Set<Socket>();
  const operations: string[] = [];
  const server = createServer((socket) => {
    connections.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => connections.delete(socket));
    let input = '';
    socket.on('data', (chunk: Buffer) => {
      input += chunk.toString('utf8');
      if (!input.includes('\n')) return;
      const request = JSON.parse(input) as { op: string };
      assert.deepEqual(Object.keys(request), ['op']);
      operations.push(request.op);
      const response = handle(request.op);
      if (response === undefined) return;
      socket.end((typeof response === 'string' ? response : JSON.stringify(response)) + '\n');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, resolve);
  });
  await chmod(endpoint, 0o600);
  t.after(async () => {
    for (const socket of connections) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { endpoint, directory, operations };
}

async function deadSocket(root: string, name: string) {
  const directory = path.join(root, `kimi-work-${name}`);
  await mkdir(directory, { mode: 0o700 });
  const temporary = path.join(directory, 'temp.sock');
  const endpoint = path.join(directory, 'context.sock');
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(temporary, resolve);
  });
  await rename(temporary, endpoint);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await chmod(endpoint, 0o600);
}

unixTest('reads a current desktop token between matching identities and validates without refreshing', async (t) => {
  const { root, options } = await fixture(t);
  let current = identity;
  const token = jwt();
  const server = await socketServer(t, root, 'one', (op) => op === 'get_user_info' ? current : { access_token: token });
  const context = await readKimiDesktopContext(options);
  assert.ok(context);
  assert.equal(context.userId, identity.uid);
  assert.equal(context.region, 'china');
  assert.equal(context.accessToken, token);
  assert.deepEqual(server.operations, ['get_user_info', 'get_access_token', 'get_user_info']);
  assert.equal(await context.validateIdentity(), true);
  assert.equal(server.operations.at(-1), 'get_user_info');
  current = { uid: 'new-account', user_region: 'cn' };
  assert.equal(await context.validateIdentity(), false);
  assert.equal(server.operations.filter((op) => op === 'get_access_token').length, 1);
});

unixTest('returns no context when the official socket is absent', async (t) => {
  const { options } = await fixture(t);
  assert.equal(await readKimiDesktopContext(options), null);
  assert.equal(await readKimiDesktopContext({ ...options, platform: 'win32', env: {} }), null);
  assert.equal(await readKimiDesktopContext({ ...options, platform: 'win32', env: { KIMI_WORK_CONTEXT_IPC: '\\\\.\\pipe\\unrelated' } }), null);
});

unixTest('rejects ambiguous accounts before requesting any token', async (t) => {
  const { root, options } = await fixture(t);
  const first = await socketServer(t, root, 'one', () => identity);
  const second = await socketServer(t, root, 'two', () => ({ ...identity, uid: 'another-account' }));
  await assert.rejects(readKimiDesktopContext(options), /Kimi desktop context is unavailable/);
  assert.deepEqual(first.operations, ['get_user_info']);
  assert.deepEqual(second.operations, ['get_user_info']);
});

unixTest('deduplicates matching active contexts and maps the overseas region', async (t) => {
  const { root, options } = await fixture(t);
  const handle = (op: string) => op === 'get_user_info' ? { ...identity, user_region: 'oversea' } : { access_token: jwt() };
  const first = await socketServer(t, root, 'one', handle);
  const second = await socketServer(t, root, 'two', handle);
  const context = await readKimiDesktopContext(options);
  assert.equal(context?.region, 'overseas');
  assert.equal([...first.operations, ...second.operations].filter((op) => op === 'get_access_token').length, 1);
});

unixTest('rejects identity changes during token retrieval', async (t) => {
  const { root, options } = await fixture(t);
  let reads = 0;
  await socketServer(t, root, 'one', (op) => op === 'get_user_info'
    ? (++reads === 1 ? identity : { ...identity, uid: 'new-account' })
    : { access_token: jwt() });
  await assert.rejects(readKimiDesktopContext(options), /Kimi desktop context is unavailable/);
});

unixTest('rejects tokens with a different subject, expired tokens, and unsafe token text', async (t) => {
  for (const token of [jwt('different-account'), jwt(identity.uid, 1), 'unsafe\r\ntoken']) {
    await t.test('invalid token', async (t) => {
      const { root, options } = await fixture(t);
      await socketServer(t, root, 'one', (op) => op === 'get_user_info' ? identity : { access_token: token });
      await assert.rejects(readKimiDesktopContext(options), /Kimi desktop context is unavailable/);
    });
  }
});

unixTest('bounds requests and never includes server response details in errors', async (t) => {
  for (const response of [undefined, 'not-json-secret', 'x'.repeat(17_000), { error: 'not_authenticated', detail: 'secret' }]) {
    await t.test('unavailable response', async (t) => {
      const { root, options } = await fixture(t);
      await socketServer(t, root, 'one', () => response);
      await assert.rejects(readKimiDesktopContext({ ...options, timeoutMs: 20 }), (error: Error) => {
        assert.equal(error.message, 'Kimi desktop context is unavailable');
        return true;
      });
    });
  }
});

unixTest('does not ignore a live invalid context when another valid context is available', async (t) => {
  for (const response of [undefined, 'not-json-secret', 'x'.repeat(17_000), { uid: 'invalid-region', user_region: 'unknown' }]) {
    await t.test('invalid active context', async (t) => {
      const { root, options } = await fixture(t);
      const valid = await socketServer(t, root, 'valid', (op) => op === 'get_user_info' ? identity : { access_token: jwt() });
      await socketServer(t, root, 'invalid', () => response);
      await assert.rejects(readKimiDesktopContext({ ...options, timeoutMs: 20 }), /Kimi desktop context is unavailable/);
      assert.equal(valid.operations.includes('get_access_token'), false);
    });
  }
});

unixTest('does not connect to insecure or symlinked socket directories', async (t) => {
  const { root, options } = await fixture(t);
  const server = await socketServer(t, root, 'one', () => identity);
  await chmod(server.directory, 0o755);
  await symlink(server.directory, path.join(root, 'kimi-work-link'));
  await assert.rejects(readKimiDesktopContext(options), /Kimi desktop context is unavailable/);
  assert.deepEqual(server.operations, []);
  await chmod(server.directory, 0o700);
  await chmod(server.endpoint, 0o666);
  await assert.rejects(readKimiDesktopContext(options), /Kimi desktop context is unavailable/);
});

unixTest('bounds the directory scan before making any requests', async (t) => {
  const { root, options } = await fixture(t);
  await Promise.all(Array.from({ length: 65 }, (_, index) => mkdir(path.join(root, `kimi-work-${index}`), { mode: 0o700 })));
  await assert.rejects(readKimiDesktopContext(options), /Kimi desktop context is unavailable/);
});

unixTest('ignores empty leftover directories when counting valid socket candidates', async (t) => {
  const { root, options } = await fixture(t);
  await Promise.all(Array.from({ length: 9 }, (_, index) => mkdir(path.join(root, `kimi-work-${index}`), { mode: 0o700 })));
  await socketServer(t, root, 'active', (op) => op === 'get_user_info' ? identity : { access_token: jwt() });
  assert.equal((await readKimiDesktopContext(options))?.userId, identity.uid);
});

unixTest('ignores more than eight dead sockets when finding the live context', async (t) => {
  const { root, options } = await fixture(t);
  await Promise.all(Array.from({ length: 9 }, (_, index) => deadSocket(root, String(index))));
  await socketServer(t, root, 'active', (op) => op === 'get_user_info' ? identity : { access_token: jwt() });
  assert.equal((await readKimiDesktopContext(options))?.userId, identity.uid);
});

unixTest('returns no desktop context when only crash leftovers remain', async (t) => {
  const { root, options } = await fixture(t);
  await Promise.all(Array.from({ length: 9 }, (_, index) => deadSocket(root, String(index))));
  assert.equal(await readKimiDesktopContext(options), null);
});

test('Windows never scans unrelated pipes when the official endpoint is unavailable', async () => {
  assert.equal(await readKimiDesktopContext({ platform: 'win32', env: {} }), null);
  for (const address of ['https://example.com', '/tmp/context.sock', '\\\\.\\pipe\\kimi-work-unverified']) {
    assert.equal(await readKimiDesktopContext({ platform: 'win32', env: { KIMI_WORK_CONTEXT_IPC: address } }), null);
  }
  assert.equal(await readKimiDesktopContext({
    platform: 'win32',
    env: { KIMI_WORK_CONTEXT_IPC: '\\\\.\\pipe\\kimi-work-00000000-0000-0000-0000-000000000000' },
  }), null);
});

unixTest('rejects conflicting regions for the same account and invalidates removed sockets', async (t) => {
  const { root, options } = await fixture(t);
  const first = await socketServer(t, root, 'one', (op) => op === 'get_user_info' ? identity : { access_token: jwt() });
  const context = await readKimiDesktopContext(options);
  assert.ok(context);
  await socketServer(t, root, 'two', () => ({ ...identity, user_region: 'oversea' }));
  await assert.rejects(readKimiDesktopContext(options), /Kimi desktop context is unavailable/);
  await rm(first.endpoint);
  assert.equal(await context.validateIdentity(), false);
});
