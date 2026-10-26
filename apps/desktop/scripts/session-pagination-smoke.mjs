// Built HTTP and IPC renderer acceptance against real Core query routes and synthetic metadata.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import { createLocalApiApp, BucketStore } from '../../../packages/core/dist/index.js';
import { buildAchievementFacts } from '../../../packages/core/dist/achievements/facts.js';
import { evaluateAchievements } from '../../../packages/core/dist/achievements/evaluate.js';
import { connectPage, unusedPort, wait } from './desktop-cdp.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(desktop, '../..');
const output = path.resolve(process.argv[2] ?? path.join(workspace, `.quotern-dev/session-pagination-ui-${Date.now()}-${process.pid}`));
assert.ok(!existsSync(output), 'Use a fresh acceptance directory');
await mkdir(path.join(output, 'profile'), { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.on('window-all-closed', () => {});
const debugPort = await unusedPort();
app.commandLine.appendSwitch('remote-debugging-port', String(debugPort));
const referenceTime = '2026-10-25T12:00:00Z';
const longProject = 'https://ghuntley.com/allocations/a-very-long-project-name-with-a-recognizable-ending';
const messages = [], observations = [], evidence = [], titles = [];
for (let index = 0; index < 77; index++) {
  const child = index >= 75, sessionId = `fixture-${index}`, timestamp = new Date(Date.parse('2026-10-25T03:00:00Z') + index * 60_000).toISOString();
  const parentId = index === 75 ? 'fixture-0' : 'fixture-74';
  messages.push({ source: 'claude', sessionId, id: sessionId, role: 'assistant', timestamp, projectLabel: index === 74 ? longProject : index % 2 ? 'Alpha' : 'Beta' });
  observations.push({ source: 'claude', sessionId, id: sessionId, timestamp, model: index % 2 ? 'model-a' : 'model-b', tokens: 100 + index, usageKnown: true, costUsd: index / 100, costKind: 'recorded', tokenParts: { input_tokens: 80 + index, output_tokens: 20, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0 }, billing: { service: 'anthropic', mode: 'api', accountRef: null, evidence: 'recorded' } });
  evidence.push({ source: 'claude', sessionId, id: 'meta', timestamp, kind: 'metadata', ...(child ? { parentId, relationKind: 'subagent' } : {}) });
  if (index !== 73) titles.push([JSON.stringify(['claude', sessionId]), { title: child ? `Child ${index}` : `Fixture ${index}`, priority: 2 }]);
}
const bucketStore = new BucketStore();
const facts = buildAchievementFacts([], [], [], new Date(referenceTime));
const demo = { schemaVersion: 1, readOnly: true, referenceTime, exportedAt: referenceTime, collectSince: '2026-10-01T00:00:00Z', lastSyncAt: referenceTime, buckets: [], pricing: { builtin: { exact: {} }, overlay: null },
  history: { messages, observations, timingEvents: [], evidence, titles, codexParents: [], missingSources: [] },
  achievements: { ...evaluateAchievements(facts), earned: [], preferences: { showcaseIds: [], celebrationsEnabled: false }, unreadIds: [], coverage: { fromDate: '2026-10-01', asOfDate: '2026-10-25', timeZone: 'Asia/Shanghai', missingSessionSources: [], projectSources: [] } } };
const hono = createLocalApiApp({ dataDir: path.join(output, 'must-not-create'), bucketStore, demo, getConfig: () => ({ deviceId: 'fixture', statsSince: demo.collectSince, localCollectSince: demo.collectSince }) });
const calls = [], clients = [], windows = [], checks = [];
let failurePage = 0, server;
async function api(route, init = {}) {
  const url = new URL(route, 'http://localhost');
  calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
  if (url.pathname === '/functions/tud-session-list' && Number(url.searchParams.get('page')) === failurePage) return { status: 500, body: { success: false, message: 'FIXTURE_PAGE_FAILURE', data: null } };
  const response = await hono.request(route, init);
  return { status: response.status, body: await response.json() };
}
const until = async (predicate, label) => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await wait(75); } throw Error('Timed out: ' + label); };
async function connect(window) {
  let target;
  await until(async () => { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(item => item.type === 'page' && item.url === window.webContents.getURL()); return Boolean(target); }, 'debugger');
  const client = await connectPage(target); clients.push(client); return client;
}
const activePage = `document.querySelector('footer [aria-current="page"]')?.textContent.trim()`;
const pageButton = page => `document.querySelector('footer button[aria-label="转到第 ${page} 页"]')`;
async function exercise(window, client, mode) {
  await until(() => client.evaluate(`${activePage}==='4' && document.querySelector('section[aria-label="全部会话"]')?.getAttribute('aria-busy')==='false'`), mode + ' initial server page');
  assert.ok(calls.some(call => call.path.endsWith('session-list') && call.query.page === '4'));
  assert.equal(calls.some(call => call.path.endsWith('session-detail')), false, 'list loading must not fetch details');
  assert.equal(await client.evaluate('document.querySelectorAll("[data-session-trigger]").length'), 12);
  assert.equal(await client.evaluate('document.querySelector("[data-session-count]")?.textContent.trim()'), '75 条主会话 · 含关联共 77 条');
  await client.evaluate(`(${pageButton(7)}).focus(); true`);
  await client.key('Enter');
  await until(() => client.evaluate(`${activePage}==='7'`), mode + ' keyboard last page');
  assert.equal(await client.evaluate(`document.querySelector('footer button[aria-label="下一页"]').disabled`), true);
  await client.evaluate('history.back(); true');
  await until(() => client.evaluate(`${activePage}==='4'`), mode + ' history restores page');
  await client.fill(`document.querySelector('footer input')`, '2');
  await client.key('Enter');
  await until(() => client.evaluate(`${activePage}==='2'`), mode + ' jump page');
  await client.click(`document.querySelector('footer [aria-haspopup="listbox"]')`);
  await until(() => client.evaluate('Boolean(document.querySelector("[role=listbox]"))'), 'page size menu');
  await client.click(`[...document.querySelectorAll('[role="option"]')].find(el=>el.textContent.includes('24'))`);
  await until(() => client.evaluate(`${activePage}==='1' && (location.search+location.hash).includes('pageSize=24')`), mode + ' capacity resets page');
  assert.equal(await client.evaluate('document.querySelectorAll("[data-session-trigger]").length'), 24);
  const search = `document.querySelector('input[placeholder="名称、项目、模型或会话 ID"]')`;
  await client.fill(search, 'Fixture 74');
  await until(() => client.evaluate('document.querySelectorAll("[data-session-trigger]").length===1 && document.querySelector("[data-session-count]")?.textContent.trim()==="1 条主会话"'), mode + ' search before paging');
  assert.equal(await client.evaluate(`document.activeElement===${search}`), true, 'search retains focus during asynchronous queries');
  const before = calls.filter(call => call.path.endsWith('session-detail')).length;
  await client.click('document.querySelector("[data-session-trigger]")');
  await until(() => client.evaluate('Boolean(document.querySelector("[role=dialog] table"))'), mode + ' on-demand detail');
  assert.equal(calls.filter(call => call.path.endsWith('session-detail')).length, before + 1);
  assert.equal(calls.at(-1).path.includes('session-activity'), false);
  await client.click(`document.querySelector('button[aria-label="关闭会话详情"]')`);
  await until(() => client.evaluate('!document.querySelector("[role=dialog]")'), 'close detail');
  await client.fill(search, ' ');
  await until(() => client.evaluate('document.querySelectorAll("[data-session-trigger]").length===24'), 'restore full result');
  failurePage = 2;
  await client.click(pageButton(2));
  await until(() => client.evaluate('document.body.innerText.includes("会话读数暂未更新")'), mode + ' failed page feedback');
  assert.equal(await client.evaluate(`(${pageButton(1)}).disabled`), false, 'a failed page must leave navigation enabled');
  assert.equal(await client.evaluate(`(location.search+location.hash).includes('page=2')`), true, 'old page must not normalize the failed URL');
  failurePage = 0;
  await client.click(`[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='重试')`);
  await until(() => client.evaluate(`${activePage}==='2' && !document.body.innerText.includes('会话读数暂未更新')`), mode + ' retry failed query directly');
  await client.click(pageButton(1));
  await until(() => client.evaluate(`${activePage}==='1' && !document.body.innerText.includes('FIXTURE_PAGE_FAILURE')`), mode + ' return after failure');
  failurePage = 0;
  await client.click('document.querySelector(".search-field__clear-button")');
  assert.equal(await client.evaluate(`(${search}).value`), '', 'the search clear action restores its placeholder');
  await until(() => client.evaluate('document.querySelector("section[aria-label=全部会话]")?.getAttribute("aria-busy")==="false"'), mode + ' stable first page');
  const row74 = `[...document.querySelectorAll('[data-session-row]')].find(el=>el.querySelector('[data-session-trigger]')?.textContent.includes('Fixture 74'))`;
  const disclosure = `(${row74}).querySelector('[data-session-disclosure]')`;
  assert.equal(await client.evaluate(`Boolean(document.querySelector('button button'))`), false, 'disclosure and detail triggers must not be nested');
  assert.equal(await client.evaluate('document.querySelector("[data-session-sort]").getClientRects().length'), 0, 'wide sorting uses the column headers');
  assert.ok(await client.evaluate('Boolean(document.querySelector("[data-session-trigger]") && [...document.querySelectorAll("[data-session-trigger]")].some(el=>el.textContent.includes("未命名会话 · xture-73")))'), 'unnamed sessions retain a short identity');
  assert.equal(await client.evaluate(`(${row74}).querySelector('[data-session-trigger] span[title]')?.getAttribute('title')`), longProject, 'full project identity remains available');
  assert.equal(await client.evaluate(`[...(${row74}).querySelectorAll('[data-session-trigger] span[title] > [aria-hidden]')].map(el=>el.textContent).join('').includes('…')`), true, 'long project display preserves both ends');
  assert.equal(await client.evaluate('document.querySelector("[data-session-tokens] > span").getBoundingClientRect().width<=1'), true, 'wide rows do not repeat the Token suffix');
  const heights = await client.evaluate('[...document.querySelectorAll("[data-session-row]")].map(el=>el.firstElementChild.getBoundingClientRect().height)');
  assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, 'collapsed related and standalone rows have equal heights');
  const detailsBeforeDisclosure = calls.filter(call => call.path.endsWith('session-detail')).length;
  await client.evaluate(`(${disclosure}).focus(); true`);
  await client.key('Enter');
  await until(() => client.evaluate(`(${disclosure}).getAttribute('aria-expanded')==='true' && document.querySelectorAll('[data-session-trigger]').length===25`), mode + ' inline keyboard disclosure');
  assert.equal(await client.evaluate('Boolean(document.querySelector("[role=dialog]"))'), false, 'disclosure must not open details');
  assert.equal(calls.filter(call => call.path.endsWith('session-detail')).length, detailsBeforeDisclosure, 'disclosure uses the summary rows');
  const children = `document.getElementById((${disclosure}).getAttribute('aria-controls'))`;
  await client.click(`(${children}).querySelector('[aria-haspopup=listbox]')`);
  await until(() => client.evaluate('Boolean(document.querySelector("[role=listbox]"))'), 'related model filter');
  await client.click(`[...document.querySelectorAll('[role=option]')].find(el=>el.textContent.trim()==='model-b')`);
  await client.click(disclosure);
  await client.click(disclosure);
  assert.equal(await client.evaluate(`(${children}).querySelector('[aria-haspopup=listbox]').textContent.includes('model-b')`), true, 'collapsing preserves the child model filter');
  await writeFile(path.join(output, mode + '-related.png'), (await window.webContents.capturePage()).toPNG());
  await client.click(disclosure);
  await client.click(`document.querySelector('button[aria-label="Token · 降序"]')`);
  await until(() => client.evaluate('(location.search+location.hash).includes("sort=tokens") && document.querySelector("section[aria-label=全部会话]")?.getAttribute("aria-busy")==="false"'), mode + ' column sorting');
  await client.click(`document.querySelector('button[aria-label="Token · 升序"]')`);
  await until(() => client.evaluate('(location.search+location.hash).includes("direction=ascending") && document.querySelector("section[aria-label=全部会话]")?.getAttribute("aria-busy")==="false"'), mode + ' column direction');
  await client.click(`document.querySelector('button[aria-label="任务时长 · 降序"]')`);
  await until(() => client.evaluate('(location.search+location.hash).includes("sort=duration") && document.querySelector("section[aria-label=全部会话]")?.getAttribute("aria-busy")==="false"'), mode + ' wide duration sort');
  await client.click(`document.querySelector('button[aria-label="最近活动 · 降序"]')`);
  await until(() => client.evaluate('!document.querySelector("section[aria-label=全部会话]")?.getAttribute("aria-busy")?.includes("true") && document.querySelector("[data-session-count]")?.textContent.includes("75")'), mode + ' restore recent sorting');
  await client.evaluate('document.querySelector("h1").scrollIntoView({block:"start"}); true');
  await wait(150);
  await writeFile(path.join(output, mode + '-pagination.png'), (await window.webContents.capturePage()).toPNG());
  await client.call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  await client.evaluate('document.querySelector("h1").scrollIntoView({block:"start"}); true');
  await wait(150);
  assert.equal(await client.evaluate('document.querySelector("[data-session-tokens] > span").getBoundingClientRect().width>1'), true, 'stacked rows retain the Token unit');
  await client.click('document.querySelector("[data-session-sort]")');
  await until(() => client.evaluate('Boolean(document.querySelector("[role=listbox]"))'), mode + ' narrow combined sorting');
  assert.equal(await client.evaluate('document.querySelectorAll("[role=option]").length'), 8, 'all four sort fields retain both directions');
  await client.click(`[...document.querySelectorAll('[role=option]')].find(el=>el.textContent.trim()==='任务时长 · 升序')`);
  await until(() => client.evaluate('(location.search+location.hash).includes("sort=duration") && (location.search+location.hash).includes("direction=ascending") && document.querySelector("section[aria-label=全部会话]")?.getAttribute("aria-busy")==="false"'), mode + ' narrow duration direction');
  await client.click('document.querySelector("[data-session-sort]")');
  await until(() => client.evaluate('Boolean(document.querySelector("[role=listbox]"))'), mode + ' narrow recent menu');
  await client.click(`[...document.querySelectorAll('[role=option]')].find(el=>el.textContent.trim()==='最近活动 · 降序')`);
  await until(() => client.evaluate('document.querySelector("section[aria-label=全部会话]")?.getAttribute("aria-busy")==="false" && !document.querySelector("[role=listbox]")'), mode + ' restore narrow recent sorting');
  await client.evaluate('document.querySelector("h1").scrollIntoView({block:"start"}); true');
  await wait(150);
  await writeFile(path.join(output, mode + '-pagination-narrow.png'), (await window.webContents.capturePage()).toPNG());
  await client.evaluate('document.querySelector("footer").scrollIntoView({block:"end"}); true');
  await wait(150);
  await writeFile(path.join(output, mode + '-pagination-footer-narrow.png'), (await window.webContents.capturePage()).toPNG());
  const overflow = await client.evaluate(`({ viewport: innerWidth, width: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('body *')].filter(el=>{const rect=el.getBoundingClientRect();return rect.width>0&&rect.right>innerWidth+1}).slice(0,12).map(el=>({tag:el.tagName,classes:el.className,text:el.textContent?.slice(0,80),right:el.getBoundingClientRect().right})) })`);
  assert.ok(overflow.width <= overflow.viewport + 1, mode + ' narrow overflow: ' + JSON.stringify(overflow));
  await client.call('Emulation.clearDeviceMetricsOverride');
  assert.equal(client.errors.length, 0, JSON.stringify(client.errors));
  checks.push(mode + '-server-paging-keyboard-history-jump-capacity-search-detail-error-narrow', mode + '-counts-inline-relations-labels-units-responsive-sorting');
}

async function main() {
  await mkdir(output, { recursive: true });
  server = createServer(async (req, res) => {
    if (req.url.startsWith('/functions/')) { const result = await api(req.url); res.writeHead(result.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(result.body)); return; }
    const root = path.join(workspace, 'packages/dashboard/dist');
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, pathname === '/sessions' || pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, ''));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] ?? 'application/octet-stream' }).end(body); } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = new BrowserWindow({ width: 1120, height: 900, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }); windows.push(browser);
  await browser.loadURL(`http://127.0.0.1:${server.address().port}/sessions?page=4`);
  await exercise(browser, await connect(browser), 'browser'); browser.destroy();
  calls.length = 0;
  ipcMain.handle('locale:get', () => ({ preference: 'zh-CN', resolved: 'zh-CN', systemLocale: 'zh-CN' }));
  ipcMain.handle('theme:get', () => ({ mode: 'light', resolved: 'light' }));
  ipcMain.handle('auto-update:get-state', () => ({ status: 'unsupported', currentVersion: 'fixture' }));
  ipcMain.handle('dashboard-range:get', () => 'last-7-days');
  ipcMain.handle('dashboard-range:set', (_event, value) => value);
  ipcMain.handle('dsh-pet:navigation-get', () => null);
  ipcMain.handle('dsh-pet:navigation-ack', () => {});
  ipcMain.handle('tud:api-request', (_event, route, init) => api(route, init));
  const window = new BrowserWindow({ width: 1120, height: 900, show: false, webPreferences: { preload: path.join(desktop, 'out/preload/index.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false } }); windows.push(window);
  await window.loadFile(path.join(desktop, 'out/renderer/index.html'), { hash: '/sessions?page=4' });
  await exercise(window, await connect(window), 'desktop');
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, checks }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, output }));
}
const deadline = setTimeout(() => app.exit(2), 100_000);
void app.whenReady().then(main).catch(async error => {
  console.error(error); await mkdir(output, { recursive: true }); await writeFile(path.join(output, 'failure.txt'), String(error.stack ?? error));
  for (let index = 0; index < clients.length; index++) try { await writeFile(path.join(output, `failure-${index}.txt`), await clients[index].evaluate('document.body.innerText')); } catch {}
  process.exitCode = 1;
}).finally(async () => { for (const client of clients) client.close(); for (const window of windows) if (!window.isDestroyed()) window.destroy(); if (server) await new Promise(resolve => server.close(resolve)); clearTimeout(deadline); app.exit(process.exitCode ?? 0); });
