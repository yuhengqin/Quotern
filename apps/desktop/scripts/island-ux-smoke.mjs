// Synthetic data only; independent HTTP, IPC and native tray windows owned by this process.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { app, BrowserWindow, clipboard, ipcMain, nativeImage } from 'electron';
import { connectPage, unusedPort, wait } from './desktop-cdp.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), workspace = path.resolve(desktop, '../..');
const outputArg = process.argv.slice(2).find(argument => !argument.startsWith('--'));
const output = path.resolve(outputArg ?? path.join(workspace, `.quotern-dev/island-ui-${Date.now()}`));
assert.ok(!existsSync(output), 'Use a fresh dedicated output directory');
await mkdir(path.join(output, 'profile'), { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
process.env.QUOTERN_DATA_DIR = path.join(output, 'data');
process.env.QUOTERN_CONFIG_HOME = path.join(output, 'config-home');
process.env.QUOTERN_DEV_ISOLATED = '1';
const debugPort = await unusedPort();
app.commandLine.appendSwitch('remote-debugging-port', String(debugPort));
app.on('window-all-closed', () => {});
const windows = [], clients = [], checks = [];
const windowEvents = [];
app.on('browser-window-created', (_event, window) => { for (const event of ['show', 'hide', 'focus', 'blur', 'ready-to-show']) window.on(event, () => windowEvents.push({ event, id: window.id, at: Date.now() })); });
let server, trayController, mainWindow, downloadPath, downloaded = 0, failPreference = false, failShareReport = false, locale = 'zh-CN';
const until = async (predicate, label) => { for (let n = 0; n < 150; n++) { if (await predicate()) return; await wait(100); } throw Error('Timed out: ' + label); };
const button = text => `[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(text)})`;
const select = label => `[...document.querySelectorAll('button[aria-haspopup="listbox"]')].find(el=>el.getAttribute('aria-label')===${JSON.stringify(label)} || el.parentElement?.textContent.includes(${JSON.stringify(label)}))`;
const option = text => `[...document.querySelectorAll('[role="option"]')].find(el=>el.textContent.trim()===${JSON.stringify(text)})`;
const body = client => client.evaluate('document.body.innerText');
const shot = (client, name) => client.screenshot(path.join(output, `${name}.png`));
async function connect(window) {
  let target;
  await until(async () => { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(page => page.type === 'page' && page.url === window.webContents.getURL()); return Boolean(target); }, 'debug target');
  const client = await connectPage(target, { waitForActionability: true }); client.window = window; clients.push(client);
  await window.webContents.insertCSS('*, *::before, *::after { animation-duration: 0s !important; transition: none !important; }');
  return client;
}
async function closeDetails(client) {
  await until(() => client.evaluate('!document.querySelector("[role=listbox]")'), 'selection menu closes');
  assert.ok(await client.evaluate('Boolean(document.activeElement?.closest("[role=dialog]"))'), 'focus stays in the active dialog');
  await client.key('Escape'); await until(() => client.evaluate('!document.querySelector("[role=dialog]")'), 'close details');
}

async function main() {
  const { createLocalApiApp, BucketStore, applyRemotePricingOverlay } = await import('../../../packages/core/dist/index.js');
  const { DEFAULT_QUOTA_PREFERENCES } = await import('../../../packages/core/dist/quota/shared/quota.js');
  const now = Math.floor(Date.now() / 1000), iso = at => new Date(at * 1000).toISOString();
  const dataDir = path.join(output, 'data'); await mkdir(path.join(dataDir, 'queue'), { recursive: true });
  const config = { deviceId: 'synthetic-island', statsSince: iso(now - 30 * 86400), localCollectSince: iso(now - 30 * 86400), lastSyncAt: iso(now) };
  await writeFile(path.join(dataDir, 'config.json'), JSON.stringify(config));
  await mkdir(path.join(dataDir, 'achievements'), { recursive: true });
  await writeFile(path.join(dataDir, 'achievements/state.json'), JSON.stringify({ version: 1, initializedAt: iso(now), earned: [], records: [], annual: [], preferences: { celebrationsEnabled: false, showcaseIds: [] } }));
  const rows = Array.from({ length: 7 }, (_, day) => ({ source: 'codex', model: `island-priced-${day % 3}`, project: 'Synthetic', hour_start: iso(now - day * 86400), input_tokens: 1000 + day * 100, output_tokens: 200, cached_input_tokens: 0, cache_creation_input_tokens: 0, total_tokens: 1200 + day * 100, conversation_count: 1 }));
  const store = new BucketStore(); store.apply(rows);
  applyRemotePricingOverlay({ exact: Object.fromEntries([0, 1, 2].map(n => [`island-priced-${n}`, { input: 1, output: 2 }])) });
  await writeFile(path.join(dataDir, `queue/${iso(now).slice(0, 7)}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n'));
  const components = Array.from({ length: 25 }, (_, n) => ({ id: `service-${n}`, name: `Service ${n + 1}`, level: 'operational' }));
  const provider = { id: 'codex@work', providerId: 'codex', label: 'Codex · 工作', profileLabel: '工作', status: 'ready', fetchedAt: now, queriedAt: now, stale: false, planLabel: 'Pro', message: null, resetCredits: 2, refreshing: false, nextRefreshAt: null, details: [], analyses: {},
    provenance: { source: 'native', observer: 'Codex', observedAt: now, identityVerified: true, accountRef: 'synthetic-account-a' },
    windows: [{ id: 'five-hour', label: '5h', durationSeconds: 18000, resetsAt: now + 7200, usedPercent: 20 }, { id: 'weekly', label: '7d', durationSeconds: 604800, resetsAt: now + 86400, usedPercent: 92 }],
    service: { level: 'operational', checkedAt: now, stale: false, url: 'https://status.openai.com', components, incidents: [] } };
  const quota = { providers: [provider], preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), notice: null };
  const publish = () => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('quota:changed', quota); };
  const runtime = { getState: () => quota, refresh: async () => quota, setPreferences: async patch => { if (failPreference) { failPreference = false; throw Error('Synthetic write failure'); } quota.preferences = { ...quota.preferences, ...patch, preferredWindows: { ...quota.preferences.preferredWindows, ...patch.preferredWindows } }; publish(); return quota; } };
  const api = createLocalApiApp({ dataDir, bucketStore: store, getConfig: () => config, sessionActionsIpc: true, quota: runtime });
  const request = async (route, init) => {
    if (failShareReport && route.startsWith('/functions/tud-usage-report?')) {
      return { status: 500, body: { success: false, message: 'Synthetic report failure', data: null } };
    }
    const response = await api.request(`http://localhost${route}`, init);
    return { status: response.status, body: await response.json() };
  };
  server = createServer(async (req, res) => {
    if (req.url.startsWith('/functions/')) { const chunks = []; for await (const chunk of req) chunks.push(chunk); const result = await request(req.url, { method: req.method, headers: req.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }); res.writeHead(result.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(result.body)); return; }
    const root = path.join(workspace, 'packages/dashboard/dist'), pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, ['/', '/dashboard'].includes(pathname) ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, ''));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try { res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] ?? 'application/octet-stream' }).end(await readFile(file)); } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  ipcMain.handle('tud:api-request', (_event, route, init) => request(route, init));
  ipcMain.handle('locale:get', () => ({ preference: locale, resolved: locale, systemLocale: 'en' }));
  ipcMain.handle('locale:set', (_event, value) => { locale = value; for (const window of BrowserWindow.getAllWindows()) window.webContents.send('locale:changed', { preference: locale, resolved: locale, systemLocale: 'en' }); });
  ipcMain.handle('theme:get', () => ({ mode: 'light', resolved: 'light' }));
  ipcMain.handle('auto-update:get-state', () => ({ status: 'unsupported', currentVersion: 'fixture' }));
  for (const key of ['autostart:get', 'autostart:get-hidden', 'tray-usage:get']) ipcMain.handle(key, () => false);
  ipcMain.handle('tray-usage-mode:get', () => 'both');
  ipcMain.handle('dashboard-range:get', () => 'last-7-days'); ipcMain.handle('dashboard-range:set', (_event, value) => value);
  ipcMain.on('window:show', () => { mainWindow?.show(); mainWindow?.focus(); });
  ipcMain.handle('dsh-pet:navigation-get', () => null);
  ipcMain.handle('quota:get', runtime.getState); ipcMain.handle('quota:refresh', runtime.refresh); ipcMain.handle('quota:set', (_event, patch) => runtime.setPreferences(patch));
  ipcMain.handle('share-backgrounds:request', (_event, value) => { assert.equal(value.operation, 'legacy'); return []; });
  ipcMain.handle('share-card:copy-image', (_event, data) => { clipboard.writeImage(nativeImage.createFromDataURL(data)); return true; });
  trayController = await import('../out/main/island-tray-test.mjs');
  const trayOptions = { getLocale: () => locale, showMainWindow: () => mainWindow?.show(), getMainWindow: () => mainWindow, openSettings: () => {}, triggerSync: () => {} };
  await writeFile(path.join(output, 'profile/tray-panel.json'), JSON.stringify({ pinned: true, x: -800.3, y: 25.4, mode: 'full' }));
  trayController.createTrayPopover(trayOptions);
  await wait(250);
  assert.equal(BrowserWindow.getAllWindows().length, 0, 'legacy pin settings do not automatically open a tray window');

  async function exercise(window, client, mode) {
    await client.evaluate('localStorage.setItem("tud.dashboardQuickView", "true"); true');
    await window.loadURL(window.webContents.getURL());
    await window.webContents.insertCSS('*, *::before, *::after { animation-duration: 0s !important; transition: none !important; }');
    await until(() => client.evaluate('Boolean(document.querySelector("[data-quota-card]"))'), mode + ' quota loaded');
    assert.equal(await client.evaluate(`Boolean(${button('快速查看')} || ${button('完整分析')})`), false, mode + ' dashboard has no display mode switch');
    await until(() => client.evaluate('Boolean(document.querySelector("section[aria-label=用量图表] .recharts-wrapper"))'), mode + ' complete charts ignore the legacy quick preference');
    assert.match(await body(client), /输入 Token/);
    assert.match(await body(client), /输出 Token/);
    assert.match(await body(client), /总消息数/);
    const cardButton = 'document.querySelector("[data-quota-card]")';
    const cardReset = 'document.querySelector("[data-quota-card] button[data-quota-reset-time]")';
    assert.ok(await client.evaluate(`Boolean(${cardReset})`), mode + ' time itself is the display-mode control');
    const countdown = await client.evaluate(`${cardReset}.textContent`);
    await client.click(cardReset);
    await until(() => quota.preferences.resetTimeMode === 'date', mode + ' card time saves date mode');
    await until(() => client.evaluate(`${cardReset}.textContent !== ${JSON.stringify(countdown)}`), mode + ' card displays date');
    assert.equal(await client.evaluate('Boolean(document.querySelector("[role=dialog]"))'), false, 'time click does not open details');
    await client.evaluate(`${cardReset}.focus()`); await client.key(' ');
    await until(() => quota.preferences.resetTimeMode === 'countdown', mode + ' Space restores countdown');
    await until(() => client.evaluate(`${cardReset}.textContent === ${JSON.stringify(countdown)}`), mode + ' countdown restored');
    failPreference = true;
    await client.click(cardReset);
    await until(async () => (await body(client)).includes('设置保存失败'), mode + ' time save failure is visible on card');
    assert.equal(quota.preferences.resetTimeMode, 'countdown');
    assert.equal(await client.evaluate(`${cardReset}.textContent`), countdown, 'failed save preserves time display');
    await client.click(cardReset);
    await until(() => quota.preferences.resetTimeMode === 'date', mode + ' time save retries');
    await shot(client, mode + '-quota-reset-date');
    await client.click(cardButton);
    await until(async () => (await body(client)).includes('查看 25 项正常服务'), mode + ' healthy collapsed');
    const detailReset = 'document.querySelector("[role=dialog] button[data-quota-reset-time]")';
    assert.equal(await client.evaluate(`Boolean(${button('显示重置日期')} || ${button('显示重置倒计时')})`), false, 'no separate display-mode button');
    await client.evaluate(`${detailReset}.focus()`); await client.key('Enter');
    await until(() => quota.preferences.resetTimeMode === 'countdown', mode + ' Enter switches time in details');
    assert.equal(await client.evaluate('document.activeElement?.hasAttribute("data-quota-reset-time")'), true, 'time keeps keyboard focus after saving');
    assert.equal(await client.evaluate('[...document.querySelectorAll("[data-quota-service-details] details")].some(el=>el.open)'), false);
    await client.click('document.querySelector("[data-quota-service-details] summary")');
    assert.ok((await body(client)).includes('Service 25'));
    await client.click('document.querySelector("[data-quota-service-details] summary")');
    failPreference = true;
    await client.click(select('重点关注窗口')); await client.click(option('5 小时限额'));
    await until(async () => (await body(client)).includes('设置保存失败'), mode + ' preference save failure');
    assert.equal(quota.preferences.preferredWindows?.[provider.id], undefined);
    await client.click(select('重点关注窗口')); await client.click(option('5 小时限额'));
    await until(() => quota.preferences.preferredWindows?.[provider.id] === 'five-hour', mode + ' focused window saved');
    await shot(client, mode + '-quota-focus'); await closeDetails(client);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-quota-card]").length'), 1);
    await shot(client, mode + '-full-analysis');
    failShareReport = true;
    await client.click('document.querySelector("button[aria-label=分享]")');
    await until(() => client.evaluate(`Boolean(${select('主指标')})`), mode + ' share editor');
    await until(() => client.evaluate(`Boolean(${button('重试')})`), mode + ' share report error offers retry');
    assert.match(await body(client), /无法读取报表/);
    failShareReport = false;
    await client.click(button('重试'));
    await client.click(select('主指标')); await client.click(option('Token 总量'));
    await client.fill('document.querySelector("[role=dialog] input[maxlength]")', '合成署名 · Test');
    const poster = 'document.querySelector("[role=dialog] article:not([aria-hidden=true])")';
    const assertPosterFits = async () => {
      const bounds = await client.evaluate(`(() => { const el = ${poster}, box = el.getBoundingClientRect(); return { height: el.clientHeight, scroll: el.scrollHeight, bottom: box.bottom, footer: el.querySelector('footer').getBoundingClientRect().bottom, children: [...el.children].map(c => ({ tag: c.tagName, top: c.offsetTop, height: c.offsetHeight, scroll: c.scrollHeight, margin: getComputedStyle(c).marginTop })) }; })()`);
      assert.ok(bounds.footer <= bounds.bottom + 1 && bounds.scroll <= bounds.height + 1, 'poster content fits its selected canvas: ' + JSON.stringify(bounds));
    };
    for (const aspect of ['2:3', '1:1', '4:5', '9:16']) {
      await client.click(select('画幅')); await client.click(option(aspect));
      await until(async () => (await body(client)).includes('累计 Token'), 'real cumulative tokens');
      await assertPosterFits();
      const previous = downloaded; downloadPath = path.join(output, `${mode}-${aspect.replace(':', '-')}.png`);
      await client.click(button('下载'));
      await until(() => downloaded > previous, 'PNG saved');
      const size = nativeImage.createFromPath(downloadPath).getSize(), [x, y] = aspect.split(':').map(Number);
      assert.equal(size.height, 2048); assert.ok(Math.abs(size.width / size.height - x / y) < 0.001);
      await until(() => client.evaluate(`Boolean(${button('下载')})`), 'download button resets');
      await shot(client, `${mode}-share-${aspect.replace(':', '-')}`);
    }
    const frozen = await client.evaluate(`${poster}.innerText`);
    store.apply([{ ...rows[0], input_tokens: 900000, total_tokens: 900200 }]);
    await client.evaluate('window.dispatchEvent(new Event("focus")); true'); await wait(250);
    assert.equal(await client.evaluate(`${poster}.innerText`), frozen, 'share freezes tokens and costs together across a background refresh');
    for (const label of ['详细卡片', '估算费用']) {
      await client.click(select('主指标')); await client.click(option(label));
      for (const aspect of ['2:3', '4:5', '9:16', '1:1']) {
        await client.click(select('画幅')); await client.click(option(aspect));
        await assertPosterFits();
      }
      await shot(client, mode + (label === '详细卡片' ? '-details-square' : '-cost-square'));
    }
    if (!process.argv.includes('--skip-system-clipboard')) {
      await client.click(button('复制配文')); await until(async () => (await body(client)).includes('已复制'), 'caption copied');
      assert.ok(clipboard.readText().includes('合成署名 · Test') && clipboard.readText().includes('Token'));
    }
    await client.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: false });
    await shot(client, mode + '-share-narrow');
    assert.equal(await client.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
    if (mode === 'desktop') {
      const longAuthor = '极长中文署名用于验证图片没有截断'.repeat(3).slice(0, 40);
      await client.fill('document.querySelector("[role=dialog] input[maxlength]")', longAuthor);
      await client.click(select('主指标')); await client.click(option('详细卡片'));
      for (const aspect of ['2:3', '4:5', '9:16', '1:1']) {
        await client.click(select('画幅')); await client.click(option(aspect));
        assert.ok(await client.evaluate(`(() => { const author = [...${poster}.querySelectorAll('span')].find(el => el.textContent === ${JSON.stringify(longAuthor)}); return author && author.scrollWidth <= author.clientWidth + 1; })()`), `poster shows the entire signature at ${aspect}`);
        await assertPosterFits();
        if (aspect === '9:16') await shot(client, 'desktop-share-long-author');
      }
      for (const [value, label] of [['en', 'Main metric'], ['ja', '主な指標'], ['ko', '주요 지표'], ['zh-CN', '主指标']]) {
        locale = value; window.webContents.send('locale:changed', { preference: locale, resolved: locale, systemLocale: 'en' });
        await until(async () => (await body(client)).includes(label), 'share locale ' + value);
        await assertPosterFits(); assert.equal(await client.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
        if (value === 'en') await shot(client, 'desktop-share-english-narrow');
      }
    }
    await client.call('Emulation.clearDeviceMetricsOverride'); await closeDetails(client);
    checks.push(mode + '-focus-save-failure-healthy-details-full-analysis-legacy-preference-and-four-PNG-formats');
  }
  const browser = new BrowserWindow({ width: 1120, height: 1000, show: true, webPreferences: { contextIsolation: true, backgroundThrottling: false } }); windows.push(browser);
  browser.webContents.session.on('will-download', (_event, item) => { item.setSavePath(downloadPath); item.once('done', (_event, state) => { if (state === 'completed') downloaded++; }); });
  await browser.loadURL(`http://127.0.0.1:${server.address().port}/dashboard`);
  if (!process.argv.includes('--tray-only')) await exercise(browser, await connect(browser), 'browser'); browser.destroy();
  quota.preferences.preferredWindows = {};
  mainWindow = new BrowserWindow({ width: 1120, height: 1000, show: true, webPreferences: { preload: path.join(desktop, 'out/preload/index.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false } }); windows.push(mainWindow);
  await mainWindow.loadFile(path.join(desktop, 'out/renderer/index.html'), { hash: '/dashboard' });
  if (!process.argv.includes('--tray-only')) await exercise(mainWindow, await connect(mainWindow), 'desktop');

  const target = { providerId: provider.id, providerType: 'codex', accountRef: provider.provenance.accountRef, windowId: 'weekly' };
  trayController.showQuotaPopover(target);
  let panel;
  await until(() => { panel = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=tray-popover')); return Boolean(panel); }, 'native tray');
  const client = await connect(panel);
  const nativeInputs = [];
  panel.webContents.on('before-input-event', (_event, input) => nativeInputs.push({ type: input.type, key: input.key }));
  await until(() => client.evaluate('Boolean(document.querySelector("[role=dialog]"))'), 'cold notification dialog');
  assert.equal(await client.evaluate(`Boolean(${button('固定额度面板')})`), false, 'tray popover has no pin control');
  panel.show(); panel.focus();
  await until(() => client.evaluate('document.activeElement?.dataset.quotaWindow === "weekly"'), 'cold notification focuses its exact window');
  await shot(client, 'tray-notification-detail');
  provider.provenance.accountRef = 'synthetic-account-b'; publish();
  await until(async () => (await body(client)).includes('账号已变更或无法确认') && !await client.evaluate('Boolean(document.querySelector("[role=dialog]"))'), 'identity stays checked after the notification is acknowledged');
  provider.provenance.accountRef = target.accountRef; publish(); trayController.showQuotaPopover(target);
  await until(() => client.evaluate('document.activeElement?.dataset.quotaWindow === "weekly"'), 'restored notification');
  panel.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await until(() => client.evaluate('!document.querySelector("[role=dialog]")'), 'first Escape closes only the detail');
  await wait(100);
  panel.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await until(() => nativeInputs.some(input => input.key === 'Escape' && input.type === 'keyUp'), 'native Escape event reaches controller');
  assert.equal(panel.isVisible(), true, 'Escape release preserves the tray');
  panel.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  panel.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await until(() => !panel.isVisible(), 'second Escape hides the panel');
  await wait(250);
  trayController.showQuotaPopover();
  const assertTraySummary = async () => {
    assert.equal(await client.evaluate(`Boolean(${button('摘要')} || ${button('完整')})`), false, 'tray has no mode switch');
    assert.equal(await client.evaluate('document.querySelectorAll(".tray-popover__body [role=progressbar]").length'), 1, 'tray displays one quota window');
    assert.equal(await client.evaluate('Boolean(document.querySelector(".tray-popover [role=tablist], .tray-popover__usage"))'), false, 'usage analytics are in the main window');
    assert.match(await body(client), /另有 1 个窗口/);
  };
  await assertTraySummary();
  const summaryHeight = panel.getBounds().height;
  trayController.showQuotaPopover(target);
  await until(() => client.evaluate('document.activeElement?.dataset.quotaWindow === "weekly"'), 'repeated notification');
  assert.ok(panel.getBounds().height >= summaryHeight, 'details have enough height'); await closeDetails(client);
  await client.evaluate('document.querySelector(".tray-popover__footer button").focus()');
  await client.key('Enter');
  await until(() => mainWindow.isFocused() && !panel.isVisible(), 'Open main window focuses the dashboard and hides the tray');
  await wait(250);
  trayController.showQuotaPopover();
  await until(() => panel.isVisible(), 'tray reopens after blur');
  await assertTraySummary();
  await shot(client, 'tray-summary-reopened');
  provider.provenance.accountRef = 'synthetic-account-b'; publish();
  trayController.showQuotaPopover(target);
  await until(async () => (await body(client)).includes('账号已变更或无法确认'), 'old account alert is not misrouted');
  assert.equal(await client.evaluate('Boolean(document.querySelector("[role=dialog]"))'), false);
  provider.provenance.accountRef = target.accountRef; provider.id = 'codex'; provider.profileLabel = undefined; publish();
  trayController.showQuotaPopover(target);
  await until(() => client.evaluate('document.activeElement?.dataset.quotaWindow === "weekly"'), 'deduplicated account is resolved');
  await closeDetails(client);
  quota.providers.push({ ...provider, id: target.providerId, profileLabel: '工作', fetchedAt: now + 1 });
  publish();
  await until(() => client.evaluate(`Boolean(document.querySelector('[data-quota-card="${target.providerId}"]'))`), 'refreshed reading wins account deduplication');
  await wait(150);
  assert.equal(await client.evaluate('Boolean(document.querySelector("[role=dialog]"))'), false, 'refresh does not reopen a dismissed notification');
  trayController.showQuotaPopover({ ...target, windowId: 'retired-window' });
  await until(async () => (await body(client)).includes('额度窗口已不可用'), 'missing window feedback');
  await closeDetails(client);
  checks.push('windows-native-tray-summary-only-legacy-preference-navigation-identity-deduplication-open-main-and-escape');
  for (const client of clients) assert.deepEqual(client.errors, []);
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ ok: true, checks, output }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, output }));
}
const deadline = setTimeout(() => { console.error('Island UI acceptance exceeded 240 seconds'); app.exit(2); }, 240_000);
void app.whenReady().then(main).catch(async error => {
  console.error(error); await writeFile(path.join(output, 'failure.txt'), String(error.stack ?? error));
  await writeFile(path.join(output, 'window-events.json'), JSON.stringify({ events: windowEvents, windows: BrowserWindow.getAllWindows().map(window => ({ id: window.id, visible: window.isVisible(), focused: window.isFocused(), url: window.webContents.getURL() })) }, null, 2));
  for (let n = 0; n < clients.length; n++) try { if (clients[n].window.isDestroyed()) continue; await writeFile(path.join(output, `failure-${n}.txt`), await body(clients[n])); await writeFile(path.join(output, `focus-${n}.json`), JSON.stringify(await clients[n].evaluate('({focused:document.hasFocus(), active:document.activeElement?.tagName, label:document.activeElement?.getAttribute("aria-label"), target:document.activeElement?.dataset.quotaWindow})'))); await shot(clients[n], `failure-${n}`); } catch {}
  process.exitCode = 1;
}).finally(async () => { for (const client of clients) client.close(); trayController?.disposeTrayPopover(); for (const window of windows) if (!window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } clearTimeout(deadline); app.exit(process.exitCode ?? 0); });
