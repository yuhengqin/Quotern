// Synthetic Core data and a real renderer in controlled browser windows; native windows have a separate smoke test.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rmdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureApp as app, FixtureWindow as BrowserWindow, fixtureIpc as ipcMain, fixtureTheme as nativeTheme } from './renderer-fixture.mjs';
import { FixtureMainWindow, registerAppearanceIpc } from './renderer-fixture-windows.mjs';
import { connectPage, unusedPort, wait } from './desktop-cdp.mjs';
import { checkAppearanceMotion } from './appearance-motion-checks.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(desktop, '../..');
const output = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? path.join(workspace, `.quotern-dev/appearance-ui-${Date.now()}`));
assert.ok(!existsSync(output), 'Use a fresh owned output directory');
await mkdir(path.join(output, 'profile'), { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
process.env.QUOTERN_DATA_DIR = path.join(output, 'data');
process.env.QUOTERN_CONFIG_HOME = path.join(output, 'config-home');
process.env.QUOTERN_DEV_ISOLATED = '1';
app.commandLine.appendSwitch('lang', 'zh-CN');
const port = await unusedPort(); app.commandLine.appendSwitch('remote-debugging-port', String(port));
app.on('window-all-closed', () => {});
const deadline = setTimeout(() => { console.error('Appearance acceptance exceeded 420 seconds'); app.exit(2); }, 420_000);
const windows = [], clients = [], checks = [], requests = [];
let server, tray, disposeAppearance, mainWindow, style = 'default', mode = 'light', resolved = 'light', locale = 'zh-CN';
const until = async (predicate, label) => { for (let n = 0; n < 120; n++) { if (await predicate()) return; await wait(100); } throw Error('Timed out: ' + label); };
async function connect(window) {
  let target;
  await until(async () => { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(page => page.type === 'page' && page.url === window.webContents.getURL()); return Boolean(target); }, 'CDP target');
  const client = await connectPage(target, { waitForActionability: true }); clients.push(client);
  client.window = window;
  return client;
}
const radio = (name, value) => `document.querySelector('input[name="${name}"][value="${value}"]').closest('label')`;
const snapshot = client => client.evaluate(`(() => { const root = document.documentElement, card = document.querySelector('[data-quota-card]'); if (!card) return {}; const s = getComputedStyle(root), c = getComputedStyle(card); return { style: root.dataset.appearance, palette: root.dataset.palette, mode: root.dataset.theme, background: s.getPropertyValue('--background').trim(), foreground: s.getPropertyValue('--foreground').trim(), accent: s.getPropertyValue('--accent').trim(), font: getComputedStyle(document.body).fontFamily, radius: c.borderRadius, cardBackground: c.backgroundColor, borderTopWidth: c.borderTopWidth, borderTopStyle: c.borderTopStyle, borderTopColor: c.borderTopColor, borderBottomColor: c.borderBottomColor, text: card.innerText }; })()`);
async function shot(client, name) {
  const wasVisible = client.window.isVisible();
  if (!wasVisible) client.window.showInactive();
  await client.evaluate('document.fonts.ready.then(() => true)');
  client.window.webContents.invalidate();
  await client.window.webContents.capturePage();
  await wait(80);
  try { await client.screenshot(path.join(output, `${name}.png`)); }
  catch (error) { throw Error(`Screenshot ${name}: ${error.message}`, { cause: error }); }
  finally { if (!wasVisible && !client.window.isDestroyed()) client.window.hide(); }
}
async function settings(client, native) {
  // CDP input does not foreground the native window as a real pointer would.
  // Occluded Chromium pages can defer modal exit animations indefinitely.
  client.window.show(); client.window.focus();
  await until(() => client.evaluate('document.visibilityState === "visible"'), 'settings window is visible');
  await client.evaluate(`window.dispatchEvent(new CustomEvent('tud:open-settings', {detail:${native ? "{tab:'appearance'}" : '{}'}})); true`);
  await until(() => client.evaluate('Boolean(document.querySelector("input[name=appearance-style]"))'), 'theme style selector');
}
async function select(client, name, value) {
  if (name === 'appearance-style' && !await client.evaluate(`Boolean(document.querySelector('input[name="${name}"][value="${value}"]'))`)) {
    await client.click('document.querySelector("[data-appearance-more]")');
  }
  await client.click(radio(name, value));
  await until(() => client.evaluate(`document.querySelector('input[name="${name}"][value="${value}"]').checked`), name + ' ' + value);
}
async function closeSettings(client) {
  client.window.show(); client.window.focus();
  await until(() => client.evaluate('document.visibilityState === "visible"'), 'closing window is visible');
  await client.key('Escape'); await until(() => client.evaluate('!document.querySelector("[role=dialog]")'), 'settings closes');
}
async function scrollTop(client) { await client.evaluate('(document.querySelector("[data-dashboard-scroll-container]") ?? document.scrollingElement).scrollTo({top:0, behavior:"instant"}); true'); }

async function checkAxisLabels(client, label) {
  await client.evaluate('document.querySelector("[data-slot=chart]").scrollIntoView({block:"center"}); true');
  await until(() => client.evaluate('document.querySelectorAll(".recharts-cartesian-axis-tick-label text").length > 0'), 'chart labels rendered');
  const axes = await client.evaluate(`(() => {
    const luminance = color => (color.match(/[\\d.]+/g) || []).slice(0,3).map(Number).map(c=>c/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[0.2126,0.7152,0.0722][i],0);
    return [...document.querySelectorAll('.recharts-cartesian-axis-tick-label text')].map(el => {
      const foreground=getComputedStyle(el).fill, background=getComputedStyle(el.closest('.card')).backgroundColor;
      const a=luminance(foreground), b=luminance(background);
      return {text:el.textContent,foreground,background,contrast:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)};
    });
  })()`);
  assert.ok(axes.length > 0, label + ' actual chart labels exist');
  for (const tick of axes) assert.ok(tick.contrast >= 4.5, label + ' axis label contrast: ' + JSON.stringify(tick));
}

async function checkHeaderIcons(client, label) {
  const icons = await client.evaluate(`(() => {
    const rgb = value => (value.match(/[\\d.]+/g) || []).slice(0,3).map(Number);
    const luminance = values => values.map(c => c/255).map(c => c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[0.2126,0.7152,0.0722][i],0);
    return [...document.querySelectorAll('.card__header button[aria-label]')].filter(el=>el.querySelector('svg') && !el.disabled).map(el=>{
      let parent=el.closest('.card__header'), background=getComputedStyle(parent).backgroundColor;
      while (parent.parentElement && (background==='transparent' || background==='rgba(0, 0, 0, 0)')) { parent=parent.parentElement; background=getComputedStyle(parent).backgroundColor; }
      const foreground=getComputedStyle(el).color, a=luminance(rgb(foreground)), b=luminance(rgb(background));
      return {label:el.getAttribute('aria-label'),foreground,background,contrast:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)};
    });
  })()`);
  assert.ok(icons.length > 0, 'real chart/help header actions exist');
  for (const icon of icons) assert.ok(icon.contrast >= 3, label + ' header action contrast: ' + JSON.stringify(icon));
  await client.evaluate(`(() => { const el=[...document.querySelectorAll('.card__header button[aria-label]')].find(el=>el.getBoundingClientRect().width>0 && el.getBoundingClientRect().height>0); el.scrollIntoView({block:'center'}); el.focus(); return true; })()`);
  await shot(client, label + '-header-actions-focus');
}

async function main() {
  const { APPEARANCE_STYLES } = await import('../out/main/appearance-shared-test.mjs');
  const sample = process.argv.find(value => value.startsWith('--styles='))?.slice(9).split(',');
  const styles = process.argv.includes('--motion-only') ? [] : APPEARANCE_STYLES.filter(value => value !== 'default' && (!sample || sample.includes(value)));
  const { createLocalApiApp, BucketStore } = await import('../../../packages/core/dist/index.js');
  const { DEFAULT_QUOTA_PREFERENCES } = await import('../../../packages/core/dist/quota/shared/quota.js');
  const dataDir = process.env.QUOTERN_DATA_DIR; await mkdir(path.join(dataDir, 'queue'), { recursive: true });
  const now = Math.floor(Date.now() / 1000), iso = new Date(now * 1000).toISOString();
  const since = new Date((now - 30 * 86400) * 1000).toISOString();
  const config = { deviceId: 'appearance-fixture', statsSince: since, localCollectSince: since, lastSyncAt: iso };
  await writeFile(path.join(dataDir, 'config.json'), JSON.stringify(config));
  const store = new BucketStore(); store.apply([{ source: 'codex', model: 'appearance-fixture', project: 'Synthetic theme project', hour_start: iso, input_tokens: 2500, output_tokens: 500, total_tokens: 3000, conversation_count: 1 }]);
  const quota = { providers: [{ id: 'codex@appearance', providerId: 'codex', label: 'Codex · 工作账号', profileLabel: '工作账号', planLabel: 'Pro', status: 'ready', fetchedAt: now, queriedAt: now, stale: false, message: null, resetCredits: 2, refreshing: false, nextRefreshAt: null, details: [], analyses: {}, provenance: { source: 'native', observer: 'Codex', observedAt: now, identityVerified: true, accountRef: 'appearance-fixture' }, windows: [{ id: 'five-hour', label: '5h', durationSeconds: 18000, resetsAt: now + 3600, usedPercent: 24 }, { id: 'weekly', label: '7d', durationSeconds: 604800, resetsAt: now + 86400, usedPercent: 93 }] }], preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), notice: null };
  // Compare stable information while the full catalogue runs across minute boundaries.
  quota.preferences.resetTimeMode = 'date';
  const runtime = { getState: () => quota, refresh: async () => quota, setPreferences: async patch => { Object.assign(quota.preferences, patch); return quota; } };
  const api = createLocalApiApp({ dataDir, bucketStore: store, getConfig: () => config, quota: runtime });
  const request = async (route, init) => { const record = { route, method: init?.method ?? 'GET', status: 'pending' }; requests.push(record); const response = await api.request(`http://localhost${route}`, init); record.status = response.status; return { status: response.status, body: await response.json() }; };
  server = createServer(async (req, res) => {
    if (req.url.startsWith('/functions/')) { const chunks = []; for await (const chunk of req) chunks.push(chunk); const result = await request(req.url, { method: req.method, headers: req.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }); res.writeHead(result.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(result.body)); return; }
    const root = path.join(workspace, 'packages/dashboard/dist'), pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, pathname.startsWith('/assets/') ? decodeURIComponent(pathname).slice(1) : 'index.html');
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try { res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] ?? 'application/octet-stream' }).end(await readFile(file)); } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  ipcMain.handle('tud:api-request', (_event, route, init) => request(route, init));
  ipcMain.handle('locale:get', () => ({ preference: locale, resolved: locale, systemLocale: 'en' }));
  ipcMain.handle('locale:set', (_event, value) => { locale = value; for (const window of BrowserWindow.getAllWindows()) window.webContents.send('locale:changed', { preference: locale, resolved: locale, systemLocale: 'en' }); });
  nativeTheme.themeSource = 'light';
  ipcMain.handle('theme:get', () => ({ mode, resolved }));
  ipcMain.on('theme:set', (_event, value) => {
    mode = value; nativeTheme.themeSource = value; resolved = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    mainWindow?.setThemeBackground(resolved, style);
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('theme:changed', { mode, resolved });
  });
  for (const channel of ['autostart:get', 'autostart:get-hidden', 'tray-usage:get']) ipcMain.handle(channel, () => false);
  ipcMain.handle('tray-usage-mode:get', () => 'both');
  ipcMain.handle('auto-update:get-state', () => ({ status: 'unsupported', currentVersion: 'fixture' }));
  ipcMain.handle('dashboard-range:get', () => 'last-7-days'); ipcMain.handle('dashboard-range:set', (_event, value) => value);
  ipcMain.handle('dsh-pet:navigation-get', () => null);
  ipcMain.handle('notifications:navigation-get', () => null);
  ipcMain.handle('notifications:navigation-ack', () => {});
  ipcMain.handle('quota:navigation:get', () => null);
  ipcMain.handle('quota:navigation:ack', () => {});
  ipcMain.handle('quota:dialog-state', () => {});
  ipcMain.handle('quota:get', runtime.getState); ipcMain.handle('quota:refresh', runtime.refresh); ipcMain.handle('quota:set', (_event, patch) => runtime.setPreferences(patch));
  const apply = value => { style = value.style; mainWindow?.setThemeBackground(resolved, style); };
  disposeAppearance = await registerAppearanceIpc(app.getPath('userData'), apply);
  const browser = new BrowserWindow({ width: 1120, height: 960, show: true }); windows.push(browser);
  const url = `http://127.0.0.1:${server.address().port}/dashboard`;
  await browser.loadURL(url); const web = await connect(browser);
  await until(() => web.evaluate('Boolean(document.querySelector("[data-quota-card]"))'), 'browser quota data');
  await settings(web, false); // RED before the new style selector exists.
  await closeSettings(web); const originalWeb = await snapshot(web);
  await settings(web, false);
  for (const theme of ['light', 'dark']) {
    await select(web, 'theme-preference', theme);
    for (const value of styles) {
      const origin = await web.evaluate('performance.timeOrigin');
      await select(web, 'appearance-style', value);
      await until(async () => (await snapshot(web)).style === value, 'browser style');
      const themed = await snapshot(web);
      if (value === 'win95') { assert.equal(themed.borderTopWidth, '2px', 'Win95 cards keep their bevel'); assert.notEqual(themed.borderTopColor, themed.borderBottomColor); }
      if (value === 'newspaper') { assert.equal(themed.borderTopStyle, 'double'); assert.equal(themed.borderTopWidth, '3px'); }
      assert.equal(await web.evaluate('performance.timeOrigin'), origin);
      if (value === 'world_cup') await shot(web, `browser-settings-gallery-${theme}`);
      await closeSettings(web);
      await checkAxisLabels(web, 'browser ' + value + ' ' + theme);
      if (value === 'win95' && theme === 'light') await checkHeaderIcons(web, 'browser-win95-light');
      await scrollTop(web); await shot(web, `browser-${value}-${theme}`); await settings(web, false);
    }
  }
  await select(web, 'theme-preference', 'light'); await select(web, 'appearance-style', 'default'); await closeSettings(web);
  const restoredWeb = await snapshot(web);
  for (const key of ['background', 'foreground', 'font', 'radius', 'cardBackground', 'text']) assert.equal(restoredWeb[key], originalWeb[key], 'browser default restores ' + key);
  checks.push(styles.length === 16 ? 'browser-all-styles-light-dark-no-reload-default-restoration' : 'browser-default-restoration');
  await web.evaluate('localStorage.removeItem("quotern-appearance"); localStorage.setItem("quotern-palette", "rose"); true');
  await browser.reload();
  await until(async () => (await snapshot(web)).palette === 'rose', 'browser migrates legacy accent');
  await settings(web, false); await select(web, 'appearance-style', 'catppuccin'); await closeSettings(web);
  const peerWindow = new BrowserWindow({ width: 900, height: 780, show: false }); windows.push(peerWindow);
  await peerWindow.loadURL(url); const peer = await connect(peerWindow);
  await until(async () => (await snapshot(peer)).style === 'catppuccin' && (await snapshot(peer)).palette === 'rose', 'new browser tab reads style and old accent');
  await settings(web, false); await select(web, 'appearance-style', 'newspaper'); await closeSettings(web);
  await until(async () => (await snapshot(peer)).style === 'newspaper', 'browser storage event reaches another tab');
  mainWindow = new FixtureMainWindow({ theme: 'light' }); windows.push(mainWindow.window);
  // Keep this acceptance renderer drawing while other test windows overlap it.
  // Native window lifecycle is tested separately through the native bridge.
  mainWindow.window.webContents.setBackgroundThrottling(false);
  await until(() => mainWindow.window.webContents.getURL().includes('index.html'), 'desktop navigation');
  const native = await connect(mainWindow.window);
  await until(() => native.evaluate('Boolean(document.querySelector("[data-quota-card]"))'), 'desktop quota data');
  tray = await import('./renderer-fixture-windows.mjs');
  tray.createTrayPopover({ getLocale: () => locale, showMainWindow: () => mainWindow.window.show(), getMainWindow: () => mainWindow.window, openSettings: () => {}, getAutostart: async () => false, setAutostart: async () => {} });
  tray.showQuotaPopover(); let panel;
  await until(() => { panel = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=tray-popover')); return Boolean(panel); }, 'tray window');
  panel.webContents.setBackgroundThrottling(false);
  const popup = await connect(panel);
  await until(() => popup.evaluate('Boolean(document.querySelector("[data-quota-card]"))'), 'tray quota data');
  const originalNative = await snapshot(native), originalTray = await snapshot(popup);
  for (const theme of ['light', 'dark']) {
    await settings(native, true); await select(native, 'theme-preference', theme);
    for (const value of styles) {
      await select(native, 'appearance-style', value);
      await until(async () => (await snapshot(popup)).style === value && (await snapshot(popup)).mode === theme, 'tray shares selected style and mode');
      const main = await snapshot(native), compact = await snapshot(popup);
      assert.equal(compact.background, main.background); assert.equal(compact.font, main.font);
      if (['win95', 'newspaper', 'matrix', 'heart_monitor', 'origami'].includes(value)) assert.equal(await popup.evaluate('getComputedStyle(document.querySelector(".tray-popover")).borderRadius'), '0px', 'square tray shell follows the selected geometry');
      assert.equal(mainWindow.window.getBackgroundColor().toLowerCase(), main.background.toLowerCase());
      if (value === 'world_cup') await shot(native, `desktop-settings-gallery-${theme}`);
      await closeSettings(native);
      await checkAxisLabels(native, 'desktop ' + value + ' ' + theme);
      if (value === 'win95' && theme === 'light') await checkHeaderIcons(native, 'desktop-win95-light');
      await scrollTop(native); await shot(native, `desktop-${value}-${theme}`); await shot(popup, `tray-${value}-${theme}`);
      await settings(native, true);
    }
    await closeSettings(native);
  }
  await settings(native, true); await select(native, 'accent-palette', 'rose'); await select(native, 'appearance-style', 'win95');
  await until(async () => (await snapshot(popup)).palette === 'rose' && (await snapshot(popup)).style === 'win95', 'saved custom accent reaches tray');
  await select(native, 'appearance-style', 'newspaper');
  assert.equal((await snapshot(native)).palette, 'rose');
  const file = path.join(output, 'profile/appearance.json');
  await until(async () => JSON.parse(await readFile(file, 'utf8')).style === 'newspaper', 'preference saved');
  await rename(file, file + '.saved'); await mkdir(file);
  await select(native, 'appearance-style', 'catppuccin');
  await until(() => native.evaluate('Boolean(document.querySelector("[data-appearance-save-error]"))'), 'real disk failure is visible');
  assert.equal((await snapshot(popup)).style, 'newspaper', 'failed save does not update another window');
  await rmdir(file); await rename(file + '.saved', file);
  await native.click('document.querySelector("[data-appearance-retry]")');
  await until(async () => (await snapshot(popup)).style === 'catppuccin', 'retry publishes the kept draft');
  await closeSettings(native);
  disposeAppearance(); disposeAppearance = await registerAppearanceIpc(app.getPath('userData'), apply);
  await mainWindow.window.reload();
  await until(async () => (await snapshot(native)).style === 'catppuccin' && (await snapshot(native)).palette === 'rose', 'restart reloads durable style and accent');
  await settings(native, true); await select(native, 'theme-preference', 'light'); await select(native, 'accent-palette', 'theme'); await select(native, 'appearance-style', 'default'); await closeSettings(native);
  await until(async () => (await snapshot(popup)).style === 'default', 'tray restores default');
  for (const [client, original] of [[native, originalNative], [popup, originalTray]]) {
    const restored = await snapshot(client);
    for (const key of ['background', 'foreground', 'font', 'radius', 'cardBackground', 'text']) assert.equal(restored[key], original[key], 'native default restores ' + key);
  }
  if (!process.argv.includes('--static-only')) {
    const openHidden = async () => {
      const window = new BrowserWindow({ show: false, width: 800, height: 700, desktop: true });
      windows.push(window); await window.loadFile(path.join(desktop, 'out/renderer/index.html')); return connect(window);
    };
    await checkAppearanceMotion({ web, peer, native, popup, mainWindow, panel, settings, select, closeSettings, until, shot, output, openHidden });
    checks.push('opt-in-decorations-all-effects-visibility-reduced-motion-pause-cleanup');
  }
  await native.click('document.querySelector("[data-quota-card]")');
  await until(() => native.evaluate('Boolean(document.querySelector("[role=dialog]"))'), 'quota details remain accessible'); await native.key('Escape');
  await settings(native, true); await select(native, 'appearance-style', 'newspaper');
  await native.call('Emulation.setDeviceMetricsOverride', { width: 480, height: 780, deviceScaleFactor: 1, mobile: false });
  await native.evaluate('document.querySelector("input[name=appearance-style][value=newspaper]").focus(); true'); await native.key('ArrowUp');
  await until(() => native.evaluate('document.querySelector("input[name=appearance-style][value=win95]").checked'), 'keyboard changes the theme');
  assert.equal(await native.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
  await shot(native, 'desktop-keyboard-narrow');
  if (await native.evaluate('document.querySelector("[data-appearance-more]").getAttribute("aria-expanded") === "true"')) await native.click('document.querySelector("[data-appearance-more]")');
  for (const language of ['en', 'ja', 'ko', 'zh-CN']) {
    await native.evaluate(`window.tud.setLocalePreference(${JSON.stringify(language)})`);
    await wait(150); await shot(native, `desktop-settings-${language}-narrow`);
    assert.equal(await native.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
    assert.ok((await native.evaluate('document.querySelector("[data-appearance-more]").textContent')).includes('17'), language + ' renders the catalogue count');
  }
  await native.click('document.querySelector("[data-appearance-more]")');
  assert.equal(await native.evaluate('document.querySelectorAll("input[name=appearance-style]").length'), 17);
  await select(native, 'appearance-style', 'world_cup');
  await native.click('document.querySelector("[data-appearance-more]")');
  assert.equal(await native.evaluate('document.querySelector("input[name=appearance-style][value=world_cup]").checked'), true, 'collapsed gallery keeps current selection');
  await native.click('document.querySelector("[data-appearance-more]")');
  await native.evaluate('document.querySelector("input[name=appearance-style][value=world_cup]").focus(); true'); await native.key('ArrowUp');
  await until(() => native.evaluate('document.querySelector("input[name=appearance-style][value=lepidoptera]").checked'), 'expanded gallery keyboard navigation');
  await shot(native, 'desktop-gallery-narrow');
  await native.call('Emulation.clearDeviceMetricsOverride'); await closeSettings(native);
  const openReference = async (owner, client) => {
    let child; owner.webContents.once('did-create-window', created => { child = created; });
    await client.evaluate(`(() => { const url=new URL(location.href); url.hash='/pricing'; const link=document.createElement('a'); link.href=url.href; link.target='_blank'; link.dataset.appearanceReference=''; link.textContent='Open reference fixture'; link.style.cssText='position:fixed;left:8px;bottom:8px;z-index:2147483647;background:white;color:black;padding:8px'; document.body.append(link); return true; })()`);
    await client.click('document.querySelector("[data-appearance-reference]")');
    await until(() => Boolean(child), 'trusted reference window opens'); windows.push(child);
    const page = await connect(child);
    await until(() => page.evaluate('Boolean(document.documentElement.dataset.appearance)'), 'reference renderer initializes');
    return { child, page };
  };
  const reference = await openReference(mainWindow.window, native);
  await settings(reference.page, true); await select(reference.page, 'appearance-style', 'newspaper'); await closeSettings(reference.page);
  await until(() => reference.child.getBackgroundColor().toLowerCase() === '#eee9df', 'reference native chrome updates');
  const nested = await openReference(reference.child, reference.page);
  assert.equal(nested.child.getBackgroundColor().toLowerCase(), '#eee9df', 'future reference windows inherit updated appearance');
  mainWindow.window.destroy(); mainWindow = null;
  await until(() => reference.child.isDestroyed() && nested.child.isDestroyed(), 'reference lifetime remains tied to its opener');
  checks.push('legacy-browser-accent-cross-tab-sync-and-reference-native-windows');
  checks.push(styles.length === 16 ? 'native-all-styles-modes-titlebars-tray-sync-custom-accent-save-failure-retry-restart-default-keyboard-languages-quota-details' : 'native-default-custom-accent-save-failure-retry-reload-keyboard-languages-quota-details');
  for (const client of clients) assert.equal(client.errors.length, 0, JSON.stringify(client.errors));
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ ok: true, staticStyles: styles, motion: !process.argv.includes('--static-only'), checks, output }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, output }));
}
app.whenReady().then(main).catch(async error => {
  console.error(error); process.exitCode = 1;
  await writeFile(path.join(output, 'failure.txt'), error.stack ?? String(error));
  await writeFile(path.join(output, 'requests.json'), JSON.stringify(requests, null, 2));
  await writeFile(path.join(output, 'windows.json'), JSON.stringify(BrowserWindow.getAllWindows().map(window => ({ id: window.id, url: window.webContents.getURL(), loading: window.webContents.isLoading(), visible: window.isVisible() })), null, 2));
  for (let index = 0; index < clients.length; index++) {
    const client = clients[index];
    if (client.window.isDestroyed()) continue;
    try {
      await writeFile(path.join(output, `failure-${index}.json`), JSON.stringify({ errors: client.errors, state: await client.evaluate('({url:location.href, hidden:document.hidden, reduced:matchMedia("(prefers-reduced-motion: reduce)").matches, decoration:document.querySelector("[data-appearance-decoration]")?.dataset.appearanceDecoration, text:document.body.innerText, html:document.body.innerHTML.slice(0,20000)})') }, null, 2));
      if (client.window.isVisible()) await shot(client, `failure-${index}`);
    } catch {}
  }
}).finally(async () => {
  clearTimeout(deadline);
  disposeAppearance?.(); tray?.destroyTrayPopover();
  for (const client of clients) client.close();
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  app.exit(process.exitCode ?? 0);
});
