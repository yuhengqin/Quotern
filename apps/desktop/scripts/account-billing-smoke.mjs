// Real built HTTP/IPC interfaces with synthetic profiles and billing responses.
// Never starts a model, reads browser credentials, or attaches to an existing app.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import { createLocalApiApp, createHttpServer, listenServer, BucketStore } from '../../../packages/core/dist/index.js';
import { registerAccountLaunchApi } from '../../../packages/core/dist/server/account-launch-api.js';
import { registerBillingApi } from '../../../packages/core/dist/server/billing-api.js';
import { BillingService } from '../../../packages/core/dist/quota/billing-store.js';
import { normalizeQuotaSnapshot } from '../../../packages/core/dist/quota/shared/quota-analysis.js';
import { DEFAULT_QUOTA_PREFERENCES } from '../../../packages/core/dist/quota/shared/quota.js';
import { buildAchievementFacts } from '../../../packages/core/dist/achievements/facts.js';
import { evaluateAchievements } from '../../../packages/core/dist/achievements/evaluate.js';
import { connectPage, unusedPort, wait } from './desktop-cdp.mjs';
const { Hono } = createRequire(new URL('../../../packages/core/package.json', import.meta.url))('hono');
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), workspace = path.resolve(desktop, '../..');
const output = path.resolve(process.argv[2] ?? path.join(workspace, `.quotern-dev/account-billing-ui-${Date.now()}-${process.pid}`));
assert.ok(!existsSync(output), 'Use a fresh acceptance directory');
await mkdir(path.join(output, 'profile'), { recursive: true });
app.setPath('userData', path.join(output, 'profile')); app.commandLine.appendSwitch('lang', 'zh-CN'); app.on('window-all-closed', () => {});
const port = await unusedPort(); app.commandLine.appendSwitch('remote-debugging-port', String(port));
const windows = [], clients = [], servers = [], checks = [], launched = [];
const now = Date.now() / 1000, day = new Date().toISOString().slice(0, 8) + '01';
const ok = data => ({ success: true, message: 'ok', data });
async function fixture(mode) {
  const root = path.join(output, mode); await mkdir(root, { recursive: true });
  const profiles = ['工作账号', '备用账号'].map((label, i) => ({ id: `account-${i}`, provider: 'claude', label, directory: path.join(root, `claude-${i}`), enabled: true, alerts: true }));
  for (const profile of profiles) await mkdir(profile.directory);
  const providers = profiles.map((profile, index) => {
    const p = normalizeQuotaSnapshot('claude', profile.label, { status: 'ready', fetchedAt: now, windows: [{ id: 'five-hour', label: '5h', usedPercent: index ? 20 : 100, resetsAt: now + 3600 }, { id: 'weekly', label: '7d', usedPercent: 20, resetsAt: now + 86400 }] });
    p.id = `claude@${profile.id}`; p.providerId = 'claude'; p.profileLabel = profile.label; p.provenance = { source: 'native', observer: 'fixture', observedAt: now, identityVerified: true, accountRef: String(index + 1).repeat(64) }; return p;
  });
  const quota = { providers, preferences: { ...DEFAULT_QUOTA_PREFERENCES, profiles }, notice: null };
  let failSpend = false;
  const billing = new BillingService(root, { fetch: async (input, init) => {
    const url = new URL(input); assert.ok(['claude.ai', 'console.anthropic.com'].includes(url.hostname));
    if (new Headers(init.headers).get('Cookie').includes('synthetic-bad')) return new Response('', { status: 401 });
    if (url.pathname.endsWith('/organizations')) return Response.json([{ uuid: 'fixture-org', name: '工作组织 · Fixture organization' }]);
    if (url.pathname.endsWith('/overage_spend_limit')) return failSpend ? new Response('', { status: 401 }) : Response.json({ is_enabled: true, used_credits: 125, monthly_credit_limit: 1000, currency: 'USD' });
    if (url.pathname.endsWith('/overage_credit_grant')) return Response.json({ remaining_balance: 0, total_granted: 500, currency: 'USD' });
    if (url.pathname.endsWith('/current_spend')) return Response.json({ amount: 5025, resets_at: '2026-12-01T00:00:00Z' });
    if (url.pathname.endsWith('/prepaid/credits')) return Response.json({ amount: 1000, currency: 'USD' });
    if (url.pathname.endsWith('/api_keys')) return Response.json({ data: [{ id: 'fixture-key', name: 'Project API key' }] });
    if (url.pathname.endsWith('/usage_cost')) return Response.json({ costs: { [day]: [{ key_id: 'fixture-key', model_name: 'sonnet', total: 120 }, { key_id: 'missing-key', model_name: 'unknown-model', total: null }, { key_id: 'fixture-key', model_name: 'haiku', total: 0.4 }] } });
    throw Error('Unexpected fixture endpoint');
  } });
  const api = new Hono(); registerAccountLaunchApi(api, { dataDir: root, quotaDirectory: path.join(root, 'quota'), getState: () => quota, ipc: true, launch: async (provider, profile) => { launched.push({ mode, provider, directory: profile.directory }); } }); registerBillingApi(api, { service: billing, ipc: true });
  api.get('/functions/tud-quota', c => c.json(ok(quota)));
  api.post('/functions/tud-ensure-local-range', c => c.json(ok({ expanded: false, localCollectSince: '2026-01-01', statsSince: '2026-01-01', sync: null })));
  const referenceTime = new Date().toISOString(), facts = buildAchievementFacts([], [], [], new Date());
  const demo = { schemaVersion: 1, readOnly: true, referenceTime, exportedAt: referenceTime, collectSince: '2026-01-01T00:00:00Z', lastSyncAt: referenceTime, buckets: [], pricing: { builtin: { exact: {} }, overlay: null }, history: { messages: [], observations: [], timingEvents: [], evidence: [], titles: [], codexParents: [], missingSources: [] }, achievements: { ...evaluateAchievements(facts), earned: [], preferences: { showcaseIds: [], celebrationsEnabled: false }, unreadIds: [], coverage: { fromDate: '2026-01-01', asOfDate: referenceTime.slice(0, 10), timeZone: 'Asia/Shanghai', missingSessionSources: [], projectSources: [] } } };
  const base = createLocalApiApp({ dataDir: path.join(root, 'unused'), bucketStore: new BucketStore(), demo, getConfig: () => ({ deviceId: 'fixture', statsSince: demo.collectSince, localCollectSince: demo.collectSince }) });
  api.all('*', c => base.fetch(c.req.raw));
  return { root, api, quota, fail: () => { failSpend = true; } };
}
const until = async (predicate, label) => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await wait(75); } throw Error('Timed out: ' + label); };
async function connect(window) {
  await window.webContents.insertCSS('*,*::before,*::after{animation:none!important;transition:none!important}');
  let target; await until(async () => { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page' && x.url === window.webContents.getURL()); return !!target; }, 'debug target');
  const client = await connectPage(target, { waitForActionability: true }); clients.push(client); return client;
}
const button = name => `[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(name)})`;
const panel = source => `document.querySelector('section[aria-label="${source === 'extra' ? 'Claude.ai · 额外用量' : 'Console · API 账单'}"]')`;
const within = (source, name) => `[...(${panel(source)}).querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(name)})`;
async function shot(window, name) { await window.webContents.capturePage(); window.webContents.invalidate(); await wait(150); await writeFile(path.join(output, name + '.png'), (await window.webContents.capturePage()).toPNG()); }
async function exercise(window, client, mode, data) {
  await until(() => client.evaluate(`Boolean(${button('监控目录')})`), mode + ' quota controls');
  await client.click(button('监控目录'));
  await until(() => client.evaluate('document.querySelector("[role=dialog]")?.innerText.includes("终端账号")'), 'account dialog');
  const account = `[...document.querySelectorAll('[role=dialog] p')].find(el=>el.textContent==='Claude · 工作账号').parentElement.parentElement`;
  await client.click(`(${account}).querySelectorAll('button')[2]`);
  await until(() => client.evaluate('document.querySelector("[role=dialog]")?.innerText.includes("已请求打开 工作账号")'), 'launch feedback');
  assert.equal(launched.at(-1).directory, path.join(data.root, 'claude-0'));
  await client.click(`[...(${account}).querySelectorAll('button')].find(el=>el.textContent.startsWith('设为启动默认'))`);
  await until(() => client.evaluate(`(${account}).innerText.includes('默认启动账号')`), 'default badge');
  const toggle = `document.querySelector('[role=switch]')`;
  await client.evaluate(`(${toggle}).focus();true`); await client.key(' ');
  await until(() => client.evaluate(`(${toggle}).getAttribute('aria-checked')==='true' || (${toggle}).checked===true`), 'auto switch enabled');
  await shot(window, mode + '-accounts');
  await client.call('Emulation.setDeviceMetricsOverride', { width: 375, height: 850, deviceScaleFactor: 1, mobile: false });
  assert.equal(await client.evaluate(`(()=>{const d=document.querySelector('[role=dialog]');return d.scrollWidth<=d.clientWidth+1})()`), true, 'account controls fit narrow screen');
  await shot(window, mode + '-accounts-375'); await client.call('Emulation.clearDeviceMetricsOverride');
  await client.key('Escape'); await until(() => client.evaluate('!document.querySelector("[role=dialog]")'), 'account dialog closed');
  await client.click(button('实际消费'));
  await until(() => client.evaluate(`Boolean(${panel('extra')})`), 'billing dialog');
  await client.click(within('extra', '连接'));
  await client.fill(`(${panel('extra')}).querySelector('input')`, 'synthetic-bad');
  await client.click(within('extra', '读取组织'));
  await until(() => client.evaluate(`(${panel('extra')}).innerText.includes('登录已过期')`), 'credential error');
  assert.equal(await client.evaluate(`(${panel('extra')}).querySelector('input').value`), 'synthetic-bad', 'failed requests preserve the draft');
  await client.fill(`(${panel('extra')}).querySelector('input')`, 'synthetic-good');
  await client.click(within('extra', '读取组织'));
  await until(() => client.evaluate(`Boolean((${panel('extra')}).querySelector('[aria-haspopup=listbox]'))`), 'organization picker');
  await client.click(`(${panel('extra')}).querySelector('[aria-haspopup=listbox]')`); await client.key('Escape');
  await client.click(`(${panel('extra')}).querySelector('button[type=submit]')`);
  await until(() => client.evaluate(`(${panel('extra')}).innerText.includes('$1.25')`), 'extra actual spend');
  assert.equal(await client.evaluate(`(${panel('extra')}).innerText.includes('$0')`), true, 'known zero grant');
  data.fail(); await client.click(within('extra', '刷新'));
  await until(() => client.evaluate(`(${panel('extra')}).innerText.includes('保留上次读数')`), 'partial stale reading');
  assert.equal(await client.evaluate(`(${panel('extra')}).innerText.includes('$1.25')`), true);
  await client.click(within('console', '连接'));
  await client.fill(`(${panel('console')}).querySelector('input')`, 'synthetic-console'); await client.click(within('console', '读取组织'));
  await until(() => client.evaluate(`Boolean((${panel('console')}).querySelector('[aria-haspopup=listbox]'))`), 'console organization');
  await client.click(`(${panel('console')}).querySelector('button[type=submit]')`);
  await until(() => client.evaluate(`(${panel('console')}).innerText.includes('$50.25')`), 'console report');
  await client.click(`(${panel('console')}).querySelector('summary')`);
  assert.equal(await client.evaluate(`(${panel('console')}).innerText.includes('已知小计')`), true);
  await client.click(within('console', '按模型'));
  assert.equal(await client.evaluate(`(${panel('console')}).innerText.includes('<$0.01')`), true);
  await client.click(within('console', '按 API key'));
  assert.equal(await client.evaluate(`(${panel('console')}).innerText.includes('Project API key')`), true);
  await shot(window, mode + '-billing');
  for (const width of [375, 1280]) {
    await client.call('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: false }); await wait(150);
    const fits = await client.evaluate(`(()=>{const d=document.querySelector('[role=dialog]'),r=d.getBoundingClientRect();return r.left>=-1 && r.right<=innerWidth+1 && d.scrollWidth<=d.clientWidth+1})()`);
    assert.equal(fits, true, mode + ' dialog fits ' + width); await shot(window, mode + '-billing-' + width);
  }
  await client.call('Emulation.clearDeviceMetricsOverride');
  await client.click(within('console', '更新连接')); await client.click(within('console', '移除连接'));
  await until(() => client.evaluate(`(${panel('console')}).innerText.includes('连接与缓存读数已移除')`), 'disconnect');
  assert.equal(await client.evaluate(`(${panel('extra')}).innerText.includes('$1.25')`), true, 'other source is retained');
  await client.key('Escape'); await until(() => client.evaluate('!document.querySelector("[role=dialog]")'), 'billing closed');
  await until(() => client.evaluate(`document.activeElement===(${button('实际消费')})`), 'billing trigger focus restored');
  assert.equal(client.errors.length, 0, JSON.stringify(client.errors));
  checks.push(mode + ': launch/default/keyboard-auto, draft-preserving-error, organization-picker, zero/unknown/subcent, partial-stale, model/key-breakdown, 375px/1280px, disconnect-isolation, Escape/focus');
}
async function main() {
  const browserData = await fixture('browser'), server = createHttpServer({ honoApp: browserData.api, staticDir: path.join(workspace, 'packages/dashboard/dist'), host: '127.0.0.1', port: 0 }); servers.push(server);
  const { port: webPort } = await listenServer(server, '127.0.0.1', 0);
  const browser = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }); windows.push(browser);
  await browser.loadURL(`http://127.0.0.1:${webPort}/dashboard`); await exercise(browser, await connect(browser), 'browser', browserData); browser.destroy();
  const desktopData = await fixture('desktop');
  ipcMain.handle('locale:get', () => ({ preference: 'zh-CN', resolved: 'zh-CN', systemLocale: 'zh-CN' }));
  ipcMain.handle('theme:get', () => ({ mode: 'light', resolved: 'light' })); ipcMain.handle('auto-update:get-state', () => ({ status: 'unsupported', currentVersion: 'fixture' }));
  ipcMain.handle('autostart:get', () => false); ipcMain.handle('autostart:get-hidden', () => false); ipcMain.handle('dashboard-range:get', () => 'last-7-days'); ipcMain.handle('dashboard-range:set', (_e, v) => v);
  ipcMain.handle('dsh-pet:navigation-get', () => null); ipcMain.handle('dsh-pet:navigation-ack', () => {});
  ipcMain.handle('tud:api-request', async (_event, route, init) => { const response = await desktopData.api.request(new URL(route, 'http://tud.local').href, init); return { status: response.status, body: await response.json() }; });
  ipcMain.handle('quota:get', () => desktopData.quota); ipcMain.handle('share-backgrounds:request', () => []);
  const window = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { preload: path.join(desktop, 'out/preload/index.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false } }); windows.push(window);
  await window.loadFile(path.join(desktop, 'out/renderer/index.html'), { hash: '/dashboard' }); await exercise(window, await connect(window), 'desktop', desktopData);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, checks }, null, 2)); console.log(JSON.stringify({ ok: true, checks, output }));
}
const deadline = setTimeout(() => { console.error('Account/billing acceptance timed out'); app.exit(2); }, 150_000);
void app.whenReady().then(main).catch(async error => {
  console.error(error); await writeFile(path.join(output, 'failure.txt'), String(error.stack ?? error));
  for (let i = 0; i < clients.length; i++) try { await writeFile(path.join(output, `failure-${i}.txt`), await clients[i].evaluate('document.body.innerText')); if (!windows[i]?.isDestroyed()) await shot(windows[i], `failure-${i}`); } catch {}
  process.exitCode = 1;
}).finally(async () => { for (const c of clients) c.close(); for (const w of windows) if (!w.isDestroyed()) w.destroy(); for (const s of servers) await new Promise(resolve => s.close(resolve)); clearTimeout(deadline); app.exit(process.exitCode ?? 0); });
