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

async function fixture(t, pricing = initialPricing, upstreamCatalog = catalog, models = {}) {
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
  for (const name of ['models-dev.mjs', 'model-metadata.mjs']) {
    await copyFile(join(scriptsDir, '..', 'src', 'pricing', name), join(root, 'src', 'pricing', name));
  }
  const pricingPath = join(root, 'src', 'pricing', 'pricing.json');
  await writeFile(pricingPath, JSON.stringify(pricing));
  const port = await listen(createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ providers: upstreamCatalog, models }));
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

test('imports official Coding Plans as subscription metadata without zero API rates', async t => {
  const model = {
    id: 'kimi-for-coding', name: 'kimi-for-coding',
    canonical_model_id: 'moonshotai/kimi-k2.8-preview',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 1_048_576 }, cost: { input: 0, output: 0 },
  };
  const current = await fixture(t, initialPricing, {
    ...catalog,
    'kimi-code-plan-cn': { models: { 'kimi-for-coding': model } },
    'kimi-code-plan-global': { models: { 'kimi-for-coding': model } },
    'untrusted-coding-plan': { models: { 'kimi-for-coding': model } },
  }, {
    'moonshotai/kimi-k2.8-preview': { name: 'Kimi K2.8 Preview', release_date: '2026-09-11' },
  });
  const url = `http://127.0.0.1:${current.port}/catalog.json`;
  const result = await current.run(url, {}, ['--if-changed']);
  assert.deepEqual(result.exact, initialPricing.exact);
  assert.deepEqual(Object.keys(result.subscription_models).sort(), [
    'kimi-code-plan-cn/kimi-for-coding', 'kimi-code-plan-global/kimi-for-coding',
  ]);
  assert.deepEqual(result.subscription_models['kimi-code-plan-cn/kimi-for-coding'], {
    display_name: 'Kimi K2.8 Preview', canonical_model_id: 'moonshotai/kimi-k2.8-preview',
    release_date: '2026-09-11', release_date_source: 'models.dev',
    context_window: 1_048_576, context_window_source: 'models.dev',
  });
  const before = await current.readRaw();
  await current.run(url, {}, ['--if-changed']);
  assert.equal(await current.readRaw(), before);
});

test('refreshes subscription identity even when API rates do not change', async t => {
  const current = await fixture(t, {
    ...initialPricing,
    subscription_models: { 'kimi-code-plan-cn/kimi-for-coding': { display_name: 'Previous model' } },
  }, {
    ...catalog,
    'kimi-code-plan-cn': { models: { 'kimi-for-coding': {
      id: 'kimi-for-coding', canonical_model_id: 'moonshotai/kimi-k2.8-preview',
      modalities: { input: ['text'], output: ['text'] },
    } } },
  });
  const result = await current.run(`http://127.0.0.1:${current.port}/catalog.json`, {}, ['--if-changed']);
  assert.equal(result.subscription_models['kimi-code-plan-cn/kimi-for-coding'].canonical_model_id, 'moonshotai/kimi-k2.8-preview');
  assert.deepEqual(result.exact, initialPricing.exact);
});

test('classifies verified subscriptions independently of missing or nonzero upstream costs', async t => {
  const text = { modalities: { input: ['text'], output: ['text'] } };
  const current = await fixture(t, initialPricing, {
    ...catalog,
    'zhipuai-coding-plan': { models: { 'glm-4.6v': { ...text, name: 'GLM-4.6V', cost: { input: 0.3, output: 0.9 } } } },
    'stepfun-step-plan': { models: { 'step-5-preview': { ...text, name: 'Step 5 Preview' } } },
    'xiaomi-token-plan-sgp': { models: { 'mimo-v2.6-pro': { ...text, name: 'MiMo-V2.6-Pro', cost: { input: 0, output: 0 } } } },
  });
  const result = await current.run(`http://127.0.0.1:${current.port}/catalog.json`);
  assert.deepEqual(result.exact, initialPricing.exact);
  assert.deepEqual(Object.keys(result.subscription_models).sort(), [
    'stepfun-step-plan/step-5-preview', 'xiaomi-token-plan-sgp/mimo-v2.6-pro', 'zhipuai-coding-plan/glm-4.6v',
  ]);
});
