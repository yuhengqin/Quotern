// Real built HTTP/IPC renderers and Core billing routes, with no live credentials/network.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import { createLocalApiApp, BucketStore } from '../../../packages/core/dist/index.js';
import { connectPage, unusedPort, wait } from './desktop-cdp.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(desktop, '../..');
const output = path.resolve(process.argv[2] ?? path.join(workspace, `.quotern-dev/billing-ui-${Date.now()}-${process.pid}`));
assert.ok(!existsSync(output), 'Use a fresh acceptance directory');
await mkdir(path.join(output, 'profile'), { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.on('window-all-closed', () => {});
const debugPort = await unusedPort();
app.commandLine.appendSwitch('remote-debugging-port', String(debugPort));
process.env.OPENAI_ADMIN_KEY = 'billing-acceptance-fixture';
process.env.QUOTERN_OPENAI_COST_PROJECT_IDS = 'proj_fixture';

const windows = [], clients = [], checks = [];
let mode, scenario, apiApp, server, providerCalls = 0, refreshes = 0;
let balance = 0;
function createFixture() {
  scenario = 'ready'; providerCalls = 0; refreshes = 0; balance = 0;
  return createLocalApiApp({ dataDir: path.join(output, mode + '-data'), bucketStore: new BucketStore(), sessionActionsIpc: true,
    getConfig: () => ({ deviceId: 'fixture', statsSince: '2026-01-01T00:00:00Z', localCollectSince: '2026-01-01T00:00:00Z' }),
    getQuotaState: () => ({ providers: balance === null ? [] : [{ id: 'deepseek', providerId: 'deepseek', status: 'ready', fetchedAt: Date.now() / 1000, stale: false, windows: [{ balance: { remaining: balance } }] }] }),
    billingFetch: async url => {
      providerCalls++;
      const u = new URL(url), start = Number(u.searchParams.get('start_time'));
      if (scenario === 'denied') return new Response('fixture', { status: 403 });
      if (scenario === 'partial' && u.searchParams.has('page')) return new Response('fixture', { status: 429 });
      const row = (value, currency = 'usd') => ({ amount: { value, currency }, project_id: 'proj_fixture', line_item: 'gpt-6-astra, input_tokens' });
      const results = scenario === 'empty' ? [] : scenario === 'large' ? [row(999999999999.99)] : [row(1.4221), row(.005, 'eur')];
      return Response.json({ object: 'page', data: [{ start_time: start, end_time: start + 86400, results }], has_more: scenario === 'partial', next_page: scenario === 'partial' ? 'next' : null });
    } });
}
async function api(route, init = {}) {
  if (route.endsWith('/refresh')) refreshes++;
  if (route.startsWith('/functions/tud-achievements')) return { status: 200, body: { success: true, message: 'ok', data: { progress: [], records: [], annual: [], summary: {}, earned: [], preferences: { showcaseIds: [], celebrationsEnabled: false }, unreadIds: [], coverage: { fromDate: null, asOfDate: '2026-10-26', timeZone: 'Asia/Shanghai', missingSessionSources: [], projectSources: [] } } } };
  const response = await apiApp.request('http://localhost' + route, init);
  return { status: response.status, body: await response.json() };
}
async function until(predicate, label) {
  for (let i = 0; i < 120; i++) { if (await predicate()) return; await wait(75); }
  throw Error('Timed out: ' + label);
}
const body = c => c.evaluate('document.body.innerText');
const refreshButton = '[...document.querySelectorAll("button")].find(el => el.textContent.trim() === "刷新平台费用")';
async function refresh(c) {
  const previous = refreshes;
  await c.click(refreshButton);
  await until(async () => refreshes > previous && await c.evaluate('Boolean(document.querySelector("main[aria-busy=false]"))'), 'refresh completion');
}
async function screenshot(window, name) {
  await window.webContents.capturePage(); window.webContents.invalidate(); await wait(100);
  await writeFile(path.join(output, name), (await window.webContents.capturePage()).toPNG());
}
async function exercise(window, c) {
  window.show(); window.focus(); window.webContents.focus();
  await until(() => c.evaluate('Boolean(document.querySelector("main[aria-busy=false]"))'), 'initial billing');
  assert.equal(providerCalls, 0, 'opening billing must not request a provider');
  assert.match(await body(c), /尚未查询平台费用/); assert.match(await body(c), /¥0/);
  await refresh(c);
  assert.equal(providerCalls, 1); assert.match(await body(c), /\$1.42/); assert.match(await body(c), /<€0.01/);
  const select = 'document.querySelector("main .select__trigger")';
  await c.click(select); await c.key('End'); await c.key('Enter');
  await until(() => c.evaluate('document.querySelector("main .select__value")?.textContent.includes("90") && Boolean(document.querySelector("main[aria-busy=false]"))'), 'period selection');
  await wait(150);
  assert.equal(providerCalls, 1, 'changing periods stays read-only'); assert.match(await body(c), /尚未查询平台费用/);
  assert.equal(await c.evaluate(`document.activeElement === (${select})`), true);
  scenario = 'partial'; await refresh(c);
  assert.match(await body(c), /平台限流/); assert.match(await body(c), /已知小计/); assert.match(await body(c), /\$1.42/);
  await c.click('document.querySelector("summary")');
  assert.equal(await c.evaluate('document.querySelectorAll("thead th[scope=col]").length'), 4);
  assert.match(await body(c), /gpt-6-astra, input_tokens/, 'official line items reach the rendered details');
  const help = 'document.querySelector("main header button[aria-label]")';
  await c.click(help); await c.key('Escape'); await wait(100);
  assert.equal(await c.evaluate(`document.activeElement === (${help}) && !document.querySelector('[role=dialog]')`), true);
  scenario = 'denied'; await refresh(c);
  assert.match(await body(c), /管理密钥失效/); assert.doesNotMatch(await body(c), /\$1.42/);
  assert.equal(await c.evaluate('Boolean(document.querySelector("summary"))'), false);
  scenario = 'empty'; balance = null; await refresh(c);
  assert.equal(await c.evaluate('document.querySelectorAll(".card__content")[1].textContent.includes("$0") && document.querySelectorAll(".card__content")[2].textContent.includes("—")'), true);
  checks.push(mode + '-explicit-refresh-period-keyboard-errors-currencies-zero-unknown-details');
  scenario = 'large'; balance = 999999999999.99; await refresh(c);
  for (const width of mode === 'browser' ? [375, 390, 800, 1120] : [800, 1120]) {
    await c.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }); await wait(100);
    const geometry = await c.evaluate(`({ viewport: innerWidth, page: document.documentElement.scrollWidth,
      values: [...document.querySelectorAll('main section .card__content > p:first-child')].map(el => ({ text: el.textContent, width: el.clientWidth, scroll: el.scrollWidth, font: parseFloat(getComputedStyle(el).fontSize) })) })`);
    await screenshot(window, mode + '-' + width + '.png');
    assert.ok(geometry.page <= geometry.viewport + 1, mode + ' page overflow: ' + JSON.stringify(geometry));
    assert.equal(geometry.values.length, 3);
    for (const value of geometry.values) assert.ok(value.scroll <= value.width + 1 && value.font >= 16, mode + ' complete readable amount at ' + width + ': ' + JSON.stringify(value));
    checks.push(mode + '-complete-long-amounts-' + width);
  }
  await c.call('Emulation.clearDeviceMetricsOverride');
  assert.deepEqual(c.errors, []);
}
async function connect(window) {
  await window.webContents.insertCSS('*,*::before,*::after{animation:none!important;transition:none!important}');
  let target;
  await until(async () => { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t => t.url === window.webContents.getURL()); return Boolean(target); }, 'debug target');
  const client = await connectPage(target); clients.push(client); return client;
}
async function main() {
  mode = 'browser'; apiApp = createFixture();
  server = createServer(async (req, res) => {
    if (req.url.startsWith('/functions/')) {
      let body = ''; for await (const part of req) body += part;
      const result = await api(req.url, { method: req.method, headers: req.headers, ...(body ? { body } : {}) });
      res.writeHead(result.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(result.body)); return;
    }
    const root = path.join(workspace, 'packages/dashboard/dist'), pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, pathname === '/billing' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, ''));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try { const data = await readFile(file); res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] ?? 'application/octet-stream' }).end(data); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = new BrowserWindow({ width: 1120, height: 900, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }); windows.push(browser);
  await browser.loadURL(`http://127.0.0.1:${server.address().port}/billing`); await exercise(browser, await connect(browser)); browser.destroy();
  mode = 'desktop'; apiApp = createFixture();
  ipcMain.handle('locale:get', () => ({ preference: 'zh-CN', resolved: 'zh-CN', systemLocale: 'zh-CN' }));
  ipcMain.handle('theme:get', () => ({ mode: 'light', resolved: 'light' }));
  ipcMain.handle('auto-update:get-state', () => ({ status: 'unsupported', currentVersion: 'fixture' }));
  ipcMain.handle('dashboard-range:get', () => 'last-7-days');
  ipcMain.handle('dsh-pet:navigation-get', () => null); ipcMain.handle('dsh-pet:navigation-ack', () => {});
  ipcMain.handle('tud:api-request', (_event, route, init) => api(route, init));
  ipcMain.handle('quota:get', () => ({ providers: [], preferences: {}, notice: null }));
  const window = new BrowserWindow({ width: 1120, height: 900, show: false, webPreferences: { preload: path.join(desktop, 'out/preload/index.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false } }); windows.push(window);
  await window.loadFile(path.join(desktop, 'out/renderer/index.html'), { hash: '/billing' }); await exercise(window, await connect(window));
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, checks }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, output }));
}
const deadline = setTimeout(() => app.exit(2), 120000);
void app.whenReady().then(main).catch(async error => {
  console.error(error); await writeFile(path.join(output, 'failure.txt'), String(error.stack ?? error)); process.exitCode = 1;
}).finally(async () => {
  for (const client of clients) client.close(); for (const window of windows) if (!window.isDestroyed()) window.destroy();
  if (server) await new Promise(resolve => server.close(resolve)); clearTimeout(deadline); app.exit(process.exitCode ?? 0);
});
