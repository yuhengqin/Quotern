import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const runFile = promisify(execFile);
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const catalog = { openai: { models: {
  'gpt-fixture': { id: 'gpt-fixture', cost: { input: 1, output: 2 } },
} } };
const initialPricing = {
  _meta: { units: 'usd_per_million_tokens', generated_at: '2026-10-14T12:34:56.000Z', note: 'Previous sync' },
  exact: { 'openai/gpt-fixture': { input: 1, output: 2 } },
};

async function listen(server, t) {
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return server.address().port;
}

async function fixture(t, pricing = initialPricing, upstreamCatalog = catalog) {
  const root = await mkdtemp(join(scriptsDir, '.sync-pricing-test-'));
  t.after(async () => {
    assert.equal(dirname(root), scriptsDir);
    assert.ok(basename(root).startsWith('.sync-pricing-test-'));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'src', 'pricing'), { recursive: true });
  for (const name of ['sync-pricing.mjs', 'pricing-metadata.mjs']) {
    await copyFile(join(scriptsDir, name), join(root, 'scripts', name));
  }
  const pricingPath = join(root, 'src', 'pricing', 'pricing.json');
  await writeFile(pricingPath, JSON.stringify(pricing));
  const port = await listen(createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(upstreamCatalog));
  }), t);

  return {
    port,
    readRaw: () => readFile(pricingPath, 'utf8'),
    async run(url, overrides = {}, args = []) {
      // Keep the real fetch transport; only redirect the upstream to a local fixture.
      const preload = join(root, 'redirect-fetch.mjs');
      await writeFile(preload, `const fetchImpl = globalThis.fetch;\n` +
        `globalThis.fetch = (_url, options) => fetchImpl(${JSON.stringify(url)}, options);\n`);
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (/^(?:https?_proxy|all_proxy|no_proxy|node_use_env_proxy|node_options)$/i.test(key)) delete env[key];
      }
      await runFile(process.execPath, ['--import', pathToFileURL(preload).href, join(root, 'scripts', 'sync-pricing.mjs'), ...args], {
        env: { ...env, ...overrides }, timeout: 10_000,
      });
      return JSON.parse(await readFile(pricingPath, 'utf8'));
    },
  };
}

test('syncs without a proxy and records the actual generation time', async t => {
  const current = await fixture(t);
  const before = Date.now();
  const result = await current.run(`http://127.0.0.1:${current.port}/api.json`);
  const generatedAt = Date.parse(result._meta.generated_at);
  assert.ok(generatedAt >= before && generatedAt <= Date.now(),
    `generation time ${result._meta.generated_at} must be the actual sync time`);
  assert.deepEqual(result.exact['openai/gpt-fixture'], { input: 1, output: 2 });
});

test('uses the configured HTTP proxy without NODE_USE_ENV_PROXY', async t => {
  const current = await fixture(t);
  const targets = [];
  const proxy = createServer();
  proxy.on('connect', (req, client, head) => {
    targets.push(req.url);
    const upstream = connect(current.port, '127.0.0.1', () => {
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
  const result = await current.run(`http://pricing.invalid:${current.port}/api.json`, {
    HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
  });
  assert.deepEqual(result.exact['openai/gpt-fixture'], { input: 1, output: 2 });
  assert.deepEqual(targets, [`pricing.invalid:${current.port}`]);
});

test('honors NO_PROXY when an HTTP proxy is configured', async t => {
  const current = await fixture(t);
  let proxyConnections = 0;
  const proxy = createServer();
  proxy.on('connect', (_req, socket) => {
    proxyConnections++;
    socket.destroy();
  });
  const proxyPort = await listen(proxy, t);
  await current.run(`http://127.0.0.1:${current.port}/api.json`, {
    HTTP_PROXY: `http://127.0.0.1:${proxyPort}`, NO_PROXY: '127.0.0.1',
  });
  assert.equal(proxyConnections, 0);
});

test('--if-changed leaves an unchanged table byte-for-byte intact', async t => {
  const current = await fixture(t);
  const before = await current.readRaw();
  await current.run(`http://127.0.0.1:${current.port}/api.json`, {}, ['--if-changed']);
  assert.equal(await current.readRaw(), before);
});

test('--if-changed writes new rates once and preserves the published time on the next sync', async t => {
  const current = await fixture(t, {
    ...initialPricing, exact: { 'openai/gpt-fixture': { input: 3, output: 6 } },
  });
  const before = Date.now();
  const url = `http://127.0.0.1:${current.port}/api.json`;
  const result = await current.run(url, {}, ['--if-changed']);
  assert.deepEqual(result.exact['openai/gpt-fixture'], { input: 1, output: 2 });
  const generatedAt = Date.parse(result._meta.generated_at);
  assert.ok(generatedAt >= before && generatedAt <= Date.now());
  const published = await current.readRaw();
  await current.run(url, {}, ['--if-changed']);
  assert.equal(await current.readRaw(), published);
});

test('--if-changed includes model metadata updates even when rates stay unchanged', async t => {
  const current = await fixture(t, initialPricing, { openai: { models: {
    'gpt-fixture': { ...catalog.openai.models['gpt-fixture'], release_date: '2026-10-12' },
  } } });
  const result = await current.run(`http://127.0.0.1:${current.port}/api.json`, {}, ['--if-changed']);
  assert.equal(result.model_metadata['openai/gpt-fixture'].release_date, '2026-10-12');
  assert.deepEqual(result.exact, initialPricing.exact);
});
