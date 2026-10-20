import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuotaTransport, type QuotaNetworkSession } from './quota-transport.js';

function network(fetch: QuotaNetworkSession['fetch']) {
  const events: string[] = [];
  const transport = createQuotaTransport({ fetch,
    forceReloadProxyConfig: async () => { events.push('proxy'); },
    closeAllConnections: async () => { events.push('close'); },
  });
  return { transport, events };
}
for (const code of ['ERR_NETWORK_CHANGED', 'ERR_NETWORK_IO_SUSPENDED', 'ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_RESET']) {
  test(`${code} recovers and retries a GET once with the original deadline`, async () => {
    let calls = 0;
    const signal = AbortSignal.timeout(1000);
    const { transport, events } = network(async (_input, init) => {
      assert.equal(init?.signal, signal);
      if (++calls === 1) throw new Error(`net::${code}`);
      return Response.json({ ready: true });
    });
    assert.deepEqual(await (await transport.fetch('https://example.test/usage', { signal })).json(), { ready: true });
    assert.equal(calls, 2); assert.deepEqual(events, ['proxy', 'close']);
  });
}
test('persistent failure is bounded to one recovery and two attempts', async () => {
  let calls = 0;
  const { transport, events } = network(async () => { calls++; throw new Error('net::ERR_CONNECTION_CLOSED'); });
  await assert.rejects(transport.fetch('https://example.test/usage'), /ERR_CONNECTION_CLOSED/);
  assert.equal(calls, 2); assert.deepEqual(events, ['proxy', 'close']);
});
for (const status of [401, 403, 429]) test(`HTTP ${status} preserves the response and cooldown without retry`, async () => {
  let calls = 0;
  const { transport, events } = network(async () => { calls++; return new Response(null, { status, headers: { 'Retry-After': '600' } }); });
  const response = await transport.fetch('https://example.test/usage');
  assert.equal(response.status, status); assert.equal(response.headers.get('Retry-After'), '600');
  assert.equal(calls, 1); assert.deepEqual(events, []);
});
test('certificate failures and non-idempotent methods never retry', async () => {
  for (const [method, code] of [['GET', 'ERR_CERT_AUTHORITY_INVALID'], ['POST', 'ERR_CONNECTION_CLOSED']]) {
    let calls = 0;
    const { transport, events } = network(async () => { calls++; throw new Error(`net::${code}`); });
    await assert.rejects(transport.fetch('https://example.test/usage', { method }), new RegExp(code));
    assert.equal(calls, 1); assert.deepEqual(events, []);
  }
});
test('an aborted request does not recover or obtain a fresh timeout', async () => {
  const controller = new AbortController();
  let calls = 0;
  const { transport, events } = network(async () => { calls++; controller.abort(); throw new Error('net::ERR_CONNECTION_CLOSED'); });
  await assert.rejects(transport.fetch('https://example.test/usage', { signal: controller.signal }));
  assert.equal(calls, 1); assert.deepEqual(events, []);
});
test('concurrent connection failures share recovery and keep their own credentials', async () => {
  const attempts = new Map<string, number>();
  const { transport, events } = network(async (input, init) => {
    const key = String(input), count = (attempts.get(key) ?? 0) + 1; attempts.set(key, count);
    if (count === 1) throw new Error('net::ERR_NETWORK_CHANGED');
    return Response.json({ identity: new Headers(init?.headers).get('Authorization') });
  });
  const results = await Promise.all(['one', 'two'].map(key => transport.fetch(`https://example.test/${key}`, { headers: { Authorization: key } }).then(value => value.json())));
  assert.deepEqual(results, [{ identity: 'one' }, { identity: 'two' }]); assert.deepEqual(events, ['proxy', 'close']);
});
test('a connection failure while reading a successful response body is also retried', async () => {
  let calls = 0;
  const { transport } = network(async () => ++calls === 1 ? new Response(new ReadableStream({
    start(controller) { controller.error(new Error('net::ERR_CONNECTION_CLOSED')); },
  })) : Response.json({ recovered: true }));
  assert.deepEqual(await (await transport.fetch('https://example.test/usage')).json(), { recovered: true });
  assert.equal(calls, 2);
});

test('connection recovery waits for another healthy in-flight read to finish', async () => {
  let finish!: (response: Response) => void;
  let failures = 0;
  const { transport, events } = network(async input => {
    if (String(input).endsWith('/healthy')) return new Promise(resolve => { finish = resolve; });
    if (++failures === 1) throw new Error('net::ERR_NETWORK_CHANGED');
    return Response.json({ recovered: true });
  });
  const healthy = transport.fetch('https://example.test/healthy');
  const failed = transport.fetch('https://example.test/failed');
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(events, []);
  finish(Response.json({ healthy: true }));
  assert.deepEqual(await (await healthy).json(), { healthy: true });
  assert.deepEqual(await (await failed).json(), { recovered: true });
  assert.deepEqual(events, ['proxy', 'close']);
});

test('a caller can abort while shared recovery waits for a different request', async () => {
  let finish!: (response: Response) => void;
  const { transport } = network(async input => {
    if (String(input).endsWith('/healthy')) return new Promise(resolve => { finish = resolve; });
    throw new Error('net::ERR_CONNECTION_CLOSED');
  });
  const healthy = transport.fetch('https://example.test/healthy');
  const controller = new AbortController();
  const failed = transport.fetch('https://example.test/failed', { signal: controller.signal });
  const rejected = assert.rejects(failed, { name: 'AbortError' });
  await Promise.resolve(); await Promise.resolve(); controller.abort();
  await rejected;
  finish(Response.json({ healthy: true })); await healthy;
});
