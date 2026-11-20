// Dedicated Electron process/profile and synthetic history. Never attaches to
// the user's app, reads personal sessions, or manages another dev service.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixtureApp as app, FixtureWindow as BrowserWindow, fixtureIpc as ipcMain } from './renderer-fixture.mjs';
import { connectPage, unusedPort, wait } from './desktop-cdp.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktop, '../..');
const output = path.resolve(process.argv[2] ?? path.join(root, `.quotern-dev/pricing-sources-ui-${Date.now()}-${process.pid}`));
assert.ok(!existsSync(output), 'Use a fresh acceptance output directory');
app.setPath('userData', path.join(output, 'profile'));
app.commandLine.appendSwitch('lang', 'zh-CN');
const debugPort = await unusedPort();
app.commandLine.appendSwitch('remote-debugging-port', String(debugPort));
app.on('window-all-closed', () => {});
await mkdir(path.join(output, 'profile'), { recursive: true });
const checks = [], windows = [], clients = [], calls = [];
let server, refreshHandle, rebuildPromise = Promise.resolve(), rebuilds = 0;
let locale = 'zh-CN';
const until = async (predicate, label) => {
  for (let i = 0; i < 150; i++) { if (await predicate()) return; await wait(100); }
  throw new Error(`Timed out: ${label}`);
};
const button = text => `[...document.querySelectorAll('button')].find(el => el.textContent.includes(${JSON.stringify(text)}))`;
const body = client => client.evaluate('document.body.innerText');
async function connect(window) {
  let target;
  await until(async () => {
    target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(page => page.type === 'page' && page.url === window.webContents.getURL());
    return target;
  }, 'dedicated renderer target');
  const client = await connectPage(target, { waitForActionability: true }); clients.push(client); return client;
}

app.whenReady().then(async () => {
const core = await import(pathToFileURL(path.join(root, 'packages/core/dist/index.js')).href);
const dataDir = path.join(output, 'data');
await mkdir(dataDir, { recursive: true });
const modelId = 'openai/gpt-pricing-fixture';
const fixture = input => ({ exact: { [modelId]: { input, output: 2, cache_read: 0.1, cache_write: 1.25 } },
  model_metadata: { [modelId]: { display_name: 'GPT Pricing Fixture', context_window: 272000 } },
  price_metadata: { [modelId]: { source: 'litellm', status: 'carried', last_verified_at: '2026-11-13T01:00:00Z' } },
  _meta: { generated_at: '2026-11-14T01:00:00Z', checked_at: '2026-11-14T02:00:00Z', sources: ['models.dev', 'litellm'],
    sync_report: { added: 2, changed: 1, carried: 1, conflicts: 1, large_changes: 0, failed_sources: [] } },
});

try {
  core.applyRemotePricingOverlay(fixture(1));
  const rows = [];
  for (let day = 1; day <= 100; day++) for (let bucket = 0; bucket < 300; bucket++) {
    const timestamp = new Date(Date.now() - day * 86400000); timestamp.setUTCHours(4, 0, 0, 0);
    rows.push({ source: 'codex', model: modelId, project: `Synthetic ${bucket}`, hour_start: timestamp.toISOString(),
      input_tokens: 10000, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 10000, conversation_count: 1 });
  }
  const store = new core.BucketStore(); store.apply(rows);
  const cache = await core.createAggregateCache(dataDir, rows);
  const config = { deviceId: 'synthetic-pricing', hostname: 'Synthetic pricing acceptance', statsSince: '2025-01-01T00:00:00Z', localCollectSince: '2025-01-01T00:00:00Z' };
  const quota = { providers: [], preferences: core.DEFAULT_QUOTA_PREFERENCES, notice: null };
  const api = core.createLocalApiApp({ dataDir, bucketStore: store, aggregateCache: cache, getConfig: () => config, getQuotaState: () => quota, sessionActionsIpc: true });
  let fetches = 0, futureRate = 2;
  refreshHandle = core.startPricingRefresh({ url: 'https://pricing-fixture.invalid/prices', dataDir, ttlMs: 10, periodic: false, firstFetchTimeoutMs: 1000,
    fetchImpl: async () => Response.json(fixture(++fetches === 1 ? 1 : futureRate)),
    onUpdate: (_status, change) => {
      if (!change.ratesChanged) return;
      rebuilds++;
      rebuildPromise = cache.rebuildFromRows(store.getRows()).then(() => {
        for (const window of windows) if (!window.isDestroyed()) window.webContents.send('tud:data-synced');
      });
    },
  });
  await refreshHandle.ready;
  ipcMain.handle('tud:api-request', async (_event, route, init) => {
    const response = await api.request(`http://tud.local${route}`, init);
    calls.push({ transport: 'ipc', route, status: response.status });
    return { status: response.status, body: await response.json() };
  });
  const localeState = () => ({ preference: locale, resolved: locale, systemLocale: 'zh-CN' });
  ipcMain.handle('locale:get', localeState);
  ipcMain.handle('locale:set', (_event, value) => { locale = value; for (const window of windows) window.webContents.send('locale:changed', localeState()); return localeState(); });
  ipcMain.handle('theme:get', () => ({ mode: 'light', resolved: 'light' }));
  ipcMain.handle('appearance:get', () => ({ style: 'default', palette: 'theme' }));
  ipcMain.on('theme:set', (_event, mode) => { for (const window of windows) window.webContents.send('theme:changed', { mode, resolved: mode }); });
  ipcMain.handle('auto-update:get-state', () => ({ status: 'unsupported', currentVersion: 'fixture' }));
  ipcMain.handle('dashboard-range:get', () => 'last-7-days');
  ipcMain.handle('dashboard-range:set', (_event, value) => value);
  ipcMain.handle('quota:get', () => quota); ipcMain.handle('quota:refresh', () => quota);
  for (const channel of ['dsh-pet:navigation-get', 'quota:navigation:get', 'notifications:navigation-get']) ipcMain.handle(channel, () => null);
  for (const channel of ['autostart:get', 'autostart:get-hidden', 'tray-usage:get']) ipcMain.handle(channel, () => false);
  ipcMain.handle('tray-usage-mode:get', () => 'both');

  const staticRoot = path.join(root, 'packages/dashboard/dist');
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname.startsWith('/functions/') || pathname === '/health') {
        const result = await api.request(`http://127.0.0.1${request.url}`);
        calls.push({ transport: 'http', route: request.url, status: result.status });
        response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer())); return;
      }
      const asset = pathname.startsWith('/assets/') ? path.join(staticRoot, pathname.slice(1)) : path.join(staticRoot, 'index.html');
      assert.ok(asset.startsWith(`${staticRoot}${path.sep}`));
      const type = asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : asset.endsWith('.svg') ? 'image/svg+xml' : asset.endsWith('.woff2') ? 'font/woff2' : 'text/html';
      response.writeHead(200, { 'content-type': type }); response.end(await readFile(asset));
    } catch { response.writeHead(500); response.end('Synthetic acceptance request failed'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const httpOrigin = `http://127.0.0.1:${server.address().port}`;
  const languages = [
    ['zh-CN', '渠道详情', '最近核实', '价格数据说明', '来源差异'],
    ['en', 'Channel details', 'Last verified', 'About pricing data', 'source differences'],
    ['ja', 'チャネル詳細', '最終確認', '料金データについて', '出典差異'],
    ['ko', '채널 상세 정보', '마지막 확인', '가격 데이터 안내', '출처 차이'],
  ];
  for (const transport of ['ipc', 'http']) {
    const window = new BrowserWindow({ width: 1120, height: 900, show: true, desktop: transport === 'ipc', webPreferences: {
      contextIsolation: true, sandbox: true, backgroundThrottling: false,
    } });
    windows.push(window);
    if (transport === 'ipc') await window.loadFile(path.join(desktop, 'out/renderer/index.html'), { hash: '/pricing?q=gpt-pricing-fixture' });
    else await window.loadURL(`${httpOrigin}/pricing?q=gpt-pricing-fixture`);
    const client = await connect(window);
    for (const [language, details, verified, about, differences] of languages) {
      if (transport === 'ipc') await client.evaluate(`window.tud.setLocalePreference(${JSON.stringify(language)}); true`);
      else await client.evaluate(`localStorage.setItem('quotern.locale.preference', ${JSON.stringify(language)}); dispatchEvent(new StorageEvent('storage', {key:'quotern.locale.preference'})); true`);
      await until(async () => (await body(client)).includes(details), `${transport} ${language} price row`);
      // Initialize the grid's roving row focus before focusing a nested control.
      await client.evaluate(`${button(details)}.closest('[data-pricing-selectable]').focus(); true`);
      await wait(100);
      await client.evaluate(`${button(details)}.focus(); true`);
      await client.key('Enter');
      await until(async () => (await body(client)).includes(verified) && (await body(client)).includes('LiteLLM'), 'per-model provenance');
      await wait(250);
      await client.screenshot(path.join(output, `${transport}-${language}-channel.png`));
      await client.key('Escape');
      await until(() => client.evaluate(`document.querySelectorAll('[role=dialog]').length === 0`), 'channel closes with Escape');
      await until(() => client.evaluate(`document.activeElement?.textContent.includes(${JSON.stringify(details)})`), 'channel focus restored');
      await client.click(`document.querySelector('button[aria-label="${about}"]')`);
      await until(async () => (await body(client)).includes(differences) && (await body(client)).includes('LiteLLM'), 'sync summary');
      await client.key('Escape');
      checks.push(`${transport}-${language}-source-freshness-carried-summary-keyboard`);
    }
    window.setSize(375, 850);
    await wait(300);
    await client.click(button(languages.at(-1)[1]));
    await wait(250);
    assert.ok(await client.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'narrow page fits');
    assert.ok(await client.evaluate(`[...document.querySelectorAll('[role=dialog]')].every(el => {const r=el.getBoundingClientRect();return r.left >= -1 && r.right <= innerWidth+1;})`), 'narrow details fit');
    await client.screenshot(path.join(output, `${transport}-narrow.png`));
    await client.key('Escape'); window.setSize(1120, 900);
    checks.push(`${transport}-375px-provenance-fit`);
    if (transport === 'ipc') {
      const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
      let lastTick = performance.now(), maxGap = 0;
      const heartbeat = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - lastTick); lastTick = now; }, 5);
      const before = performance.now();
      const refresh = refreshHandle.refreshIfStale();
      await until(() => rebuilds > 0, 'changed-price history rebuild begins');
      await client.click(`document.querySelector('button[aria-label="${languages.at(-1)[3]}"]')`);
      await refresh; await rebuildPromise;
      await client.key('Escape'); clearInterval(heartbeat); lag.disable();
      assert.equal(cache.getUsageSummary(rows, config.statsSince).totalCostUsd, 600);
      assert.ok(maxGap < 500, `main event loop heartbeat gap ${maxGap}ms`);
      const measurements = { rows: rows.length, days: 100, rebuilds, durationMs: performance.now() - before, maxHeartbeatGapMs: maxGap, eventLoopMaxMs: lag.max / 1e6 };
      await writeFile(path.join(output, 'responsiveness.json'), JSON.stringify(measurements, null, 2));
      checks.push('desktop-30000-rows-100-days-changed-prices-recomputed-during-real-popover-interaction');
    } else {
      futureRate = 3;
      await refreshHandle.refreshIfStale(); await rebuildPromise;
      const before = calls.filter(call => call.transport === 'http' && call.route.startsWith('/functions/tud-pricing')).length;
      const sourceCalls = fetches;
      await client.evaluate(`dispatchEvent(new Event('focus')); true`);
      await until(() => calls.filter(call => call.transport === 'http' && call.route.startsWith('/functions/tud-pricing')).length > before, 'a focused price page re-reads the runtime after a background update');
      assert.equal(fetches, sourceCalls, 'page focus must never download public pricing sources');
      checks.push('http-focus-revalidates-local-prices-without-remote-fetch');
    }
    assert.equal(client.errors.length, 0, 'no uncaught renderer errors');
  }
  assert.ok(calls.some(call => call.transport === 'ipc' && call.route.startsWith('/functions/tud-pricing')));
  assert.ok(calls.some(call => call.transport === 'http' && call.route.startsWith('/functions/tud-pricing')));
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, calls }, null, 2));
  console.log(JSON.stringify({ output, checks: checks.length, transports: ['http', 'ipc'], rows: rows.length }));
} catch (error) {
  for (let i = 0; i < clients.length; i++) { try { await clients[i].screenshot(path.join(output, `failure-${i}.png`)); } catch {} }
  console.error(error); await writeFile(path.join(output, 'failure.txt'), String(error.stack ?? error));
  process.exitCode = 1;
} finally {
  refreshHandle?.(); await rebuildPromise.catch(() => {});
  for (const client of clients) client.close();
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  app.exit(process.exitCode ?? 0);
}
});
