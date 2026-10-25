// Opt-in acceptance: built Desktop + browser renderer, synthetic API only.
// Run after both builds: pnpm --filter quotern-desktop exec electron scripts/session-detail-smoke.mjs <fresh-output>
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, clipboard } from 'electron';
import { connectPage, unusedPort, wait } from './desktop-cdp.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(desktop, '../..');
const output = path.resolve(process.argv[2] ?? '');
assert.ok(process.argv[2] && !existsSync(output), 'Provide a fresh dedicated output directory');
app.setPath('userData', path.join(output, 'profile'));
app.on('window-all-closed', () => {});
await mkdir(path.join(output, 'profile'), { recursive: true });
const debugPort = await unusedPort();
app.commandLine.appendSwitch('remote-debugging-port', String(debugPort));
const fixtureDirectory = 'D:\\Fixture\\Quotern\\a-long-project-directory-for-session-detail-acceptance';
const title = '评估用量统计的显示格式 · 多层子代理与分叉会话';
const price = { matchedModel: 'fixture-model', table: 'fixture', matchMethod: 'exact', rates: { input: 2, output: 10, cache_read: 0.2, cache_write: 2 }, unpricedTokens: 0, ruleReferences: [], assumptions: [] };
const model = (tokens, cost, name = 'gpt-fixture-model-with-a-long-name') => ({ model: name, tokens, costUsd: cost, knownCostUsd: cost ?? 0.5, costKind: cost == null ? 'mixed' : 'estimated', requests: 111, input_tokens: tokens * 0.01, cached_input_tokens: tokens * 0.98, cache_creation_input_tokens: 0, output_tokens: tokens * 0.007, reasoning_output_tokens: tokens * 0.003, serviceTiers: ['fast'], pricing: price });
const root = { source: 'codex', sessionId: 'fixture-root', sessionTitle: title, projectLabel: 'Quotern', model: 'gpt-fixture-model-with-a-long-name', lastActivityAt: '2026-10-25T05:38:22Z', tokens: 20_000_000, costUsd: 6, costKind: 'estimated', sharePercent: 20, models: [model(20_000_000, 6)], detailsComplete: true, billing: { service: 'openai', mode: 'subscription', accountRef: 'fixture-account', evidence: 'recorded' }, context: null, taskSeconds: 1140, taskTimingKind: 'recorded',
  insights: { parentId: null, relationKind: 'unknown', relationConflict: false, orphan: false, agentRole: null, agentNickname: null, firstActivityAt: '2026-10-25T05:18:13Z', messageCount: 23, ownTokens: 20_000_000, ownCostUsd: 6, subagentTokens: 800_000, subagentCostUsd: 3.4, combinedTokens: 21_100_000, combinedCostUsd: null, combinedKnownCostUsd: 9.9, descendantCount: 2, relatedUsage: [
    { source: 'codex', sessionId: 'fixture-child', sessionTitle: '子代理：核对费用来源', tokens: 800_000, costUsd: 3.4, knownCostUsd: 3.4, costKind: 'estimated', relationKind: 'subagent', agentRole: 'reviewer', agentNickname: 'Check', models: [model(800_000, 3.4)], detailsComplete: true },
    { source: 'codex', sessionId: 'fixture-fork', sessionTitle: '分叉：部分费用尚未确定', tokens: 300_000, costUsd: null, knownCostUsd: 0.5, costKind: 'mixed', relationKind: 'fork', agentRole: null, agentNickname: null, models: [model(300_000, null, 'unpriced-fixture-model')], detailsComplete: true },
  ], performance: { tokensPerSecond: 60.444, estimatedRequestCount: 3, estimatedDurationMs: 33403, ttftMs: 2790.5, ttftSampleCount: 4, kind: 'estimated' }, signals: { toolCalls: 0, editTurns: null, retryTurns: null, firstPass: null, errorCount: null, compactionCount: null, costPerEdit: null, tokensPerEdit: null, coverage: 'partial' }, resumeCommand: 'codex resume fixture-root' },
};
const empty = { ...root, sessionId: 'fixture-empty', sessionTitle: 'Missing metrics / unknown usage', tokens: null, costUsd: null, costKind: 'unknown', models: [], detailsComplete: false, insights: undefined };
let locale = 'zh-CN';
let directoryFailure = false;
let actionsUnavailable = false;
let resumeBlocked = false;
let actionFailure = false;
const actionCalls = [];
let navigation = null;
const api = async (route, init) => {
  const url = new URL(route, 'http://fixture.local');
  if (url.pathname === '/functions/tud-session-actions') {
    if (directoryFailure || actionsUnavailable) return { status: 503, body: { success: false, message: 'FIXTURE_ACTIONS_UNAVAILABLE', data: null } };
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body);
      assert.deepEqual(Object.keys(body).sort(), ['action', 'sessionId', 'source']);
      assert.equal(Object.entries(init.headers).find(([name]) => name.toLowerCase() === 'x-quotern-session-action')?.[1], 'fixture-action-token');
      actionCalls.push(body);
      await wait(350);
      return actionFailure ? { status: 500, body: { success: false, message: 'SESSION_CLI_UNAVAILABLE', data: null } } : { status: 200, body: { success: true, data: { action: body.action } } };
    }
    return { status: 200, body: { success: true, data: { directory: fixtureDirectory, token: 'fixture-action-token', canOpenDirectory: true, canResume: !resumeBlocked, resumeCommand: resumeBlocked ? null : `codex resume ${url.searchParams.get('sessionId')}`, reason: null, resumeReason: resumeBlocked ? 'SESSION_RESUME_PROFILE_REQUIRED' : null } } };
  }
  if (url.pathname === '/functions/tud-session-directory') return directoryFailure ? { status: 503, body: { success: false, message: 'FIXTURE_UNAVAILABLE', data: null } } : { status: 200, body: { success: true, data: { directory: fixtureDirectory } } };
  if (url.pathname === '/functions/tud-session-activity') {
    const id = url.searchParams.get('sessionId');
    const row = id === empty.sessionId ? empty : root;
    return { status: 200, body: { success: true, data: { sessions: [row], totalTokens: 21_100_000, attributedTokens: 21_100_000, otherTokens: 0, tokenTotalMismatch: false, missingSources: [], observedAt: '2026-10-25T05:40:00Z', billing: [], range: { fromDate: '2026-10-01', toDate: '2026-10-25', kind: id ? 'collected' : 'selected' } } } };
  }
  return { status: 503, body: { success: false, message: 'FIXTURE_NOT_PROVIDED', data: null } };
};
const until = async (predicate, label) => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await wait(100); } throw Error('Timed out: ' + label); };
const button = text => `[...document.querySelectorAll('[role="dialog"] button')].find(el=>el.textContent.trim()===${JSON.stringify(text)} && !el.closest('details:not([open])'))`;
const summary = text => `[...document.querySelectorAll('[role="dialog"] summary')].find(el=>el.textContent.includes(${JSON.stringify(text)}))`;
const dialog = 'document.querySelector("[role=dialog]")';
const text = client => client.evaluate(`${dialog}?.innerText ?? ''`);
const checks = [], windows = [], clients = [];
let server;

async function connect(window) {
  let target;
  await until(async () => { try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(page => page.type === 'page' && page.url === window.webContents.getURL()); return Boolean(target); } catch { return false; } }, 'renderer debugger');
  const client = await connectPage(target); clients.push(client); return client;
}
async function noOverflow(client, label) {
  assert.equal(await client.evaluate(`(() => { const d=${dialog}; return d && d.scrollWidth<=d.clientWidth+1 && [...d.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height}).every(e=>e.getBoundingClientRect().right<=d.getBoundingClientRect().right+2); })()`), true, label);
}
async function main() {
  await mkdir(output, { recursive: true });
  ipcMain.handle('locale:get', () => ({ preference: locale, resolved: locale, systemLocale: locale }));
  ipcMain.handle('theme:get', () => ({ mode: 'light', resolved: 'light' }));
  ipcMain.handle('auto-update:get-state', () => ({ status: 'unsupported', currentVersion: 'fixture' }));
  ipcMain.handle('dashboard-range:get', () => 'last-7-days');
  ipcMain.handle('dashboard-range:set', (_event, value) => value);
  ipcMain.handle('dsh-pet:navigation-get', () => navigation);
  ipcMain.handle('dsh-pet:navigation-ack', (_event, id) => { if (navigation?.navigationId === id) navigation = null; });
  ipcMain.handle('tud:api-request', (_event, route, init) => api(route, init));
  const window = new BrowserWindow({ width: 1080, height: 900, show: true, webPreferences: { preload: path.join(desktop, 'out/preload/index.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false } }); windows.push(window);
  await window.loadFile(path.join(desktop, 'out/renderer/index.html'), { hash: '/sessions?sessionSource=codex&sessionId=fixture-root&sessionFocus=initial' });
  const client = await connect(window);
  await until(async () => (await text(client)).includes(title), 'notification target detail');
  await wait(300);
  assert.ok((await text(client)).includes('≥ $9.9'));
  assert.ok((await text(client)).includes('2026-10-01'));
  checks.push('desktop-target-autoopens-and-thread-known-subtotal');
  await noOverflow(client, 'wide dialog overflow');
  await client.screenshot(path.join(output, 'desktop-light.png'));
  await until(() => client.evaluate(`!(${button('继续会话')}).disabled`), 'native actions ready');
  await client.click(button('继续会话'));
  assert.equal(await client.evaluate(`(${button('正在打开…')}).disabled && (${button('打开项目目录')}).disabled`), true);
  await client.click(button('正在打开…'));
  await until(async () => (await text(client)).includes('已打开终端'), 'resume feedback');
  assert.deepEqual(actionCalls, [{ source: 'codex', sessionId: 'fixture-root', action: 'resume' }]);
  await client.click(button('打开项目目录'));
  await until(async () => (await text(client)).includes('已打开项目目录'), 'directory feedback');
  assert.equal(actionCalls.length, 2);
  assert.equal(actionCalls[1].action, 'open-directory');
  actionFailure = true;
  await client.click(button('继续会话'));
  await until(async () => (await text(client)).includes('未找到此 Agent 的命令行程序'), 'native error feedback');
  assert.equal(await client.evaluate(`(${button('继续会话')}).disabled`), false);
  actionFailure = false;
  checks.push('desktop-native-actions-token-body-pending-deduplication-success-and-error');
  await client.click(button('本会话'));
  await until(async () => !(await text(client)).includes('≥ $9.9'), 'own scope');
  assert.ok((await text(client)).includes('$6'));
  await client.click(button('线程合计'));
  await until(async () => (await text(client)).includes('≥ $9.9'), 'thread scope');
  checks.push('scope-switch-updates-totals');
  await client.click(button('复制恢复命令'));
  await until(() => clipboard.readText() === 'codex resume fixture-root', 'resume clipboard');
  await client.click(button('更多'));
  await client.click(button('复制精确数据'));
  await until(() => clipboard.readText().startsWith('{'), 'exact clipboard');
  const copied = JSON.parse(clipboard.readText());
  assert.equal(copied.scope, 'thread'); assert.equal(copied.usage.tokens, 21_100_000); assert.equal(copied.usage.costUsd, null); assert.equal(copied.usage.knownCostUsd, 9.9);
  checks.push('resume-and-precise-json-copy');
  await client.click(summary('gpt-fixture'));
  await client.click(summary('价格依据'));
  assert.ok((await text(client)).includes('fixture'));
  await client.click(summary('已记录的活动'));
  assert.ok((await text(client)).includes('未记录'));
  await client.click(summary('会话信息'));
  assert.ok((await text(client)).includes(fixtureDirectory));
  await client.click(button('复制项目目录'));
  await until(() => clipboard.readText() === fixtureDirectory, 'directory clipboard');
  checks.push('models-pricing-zero-missing-and-directory-disclosures');
  await client.click(button('精确数值'));
  assert.ok((await text(client)).includes('60.444'));
  assert.ok((await text(client)).includes('2,790.5'));
  await client.screenshot(path.join(output, 'desktop-expanded.png'));
  await client.key('Escape');
  await until(() => client.evaluate(`!${dialog}`), 'escape close');
  assert.equal(await client.evaluate('document.activeElement?.getAttribute("aria-haspopup")'), 'dialog');
  await client.key('Enter');
  await until(() => client.evaluate(`Boolean(${dialog})`), 'keyboard reopen');
  for (let i = 0; i < 12; i++) { await client.key('Tab'); assert.equal(await client.evaluate(`${dialog}.contains(document.activeElement)`), true); }
  checks.push('escape-return-focus-enter-reopen-and-tab-trap');
  await client.evaluate('document.documentElement.classList.add("dark"); true');
  await client.screenshot(path.join(output, 'desktop-dark.png'));
  await client.call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  await wait(150);
  await noOverflow(client, '375px dialog overflow');
  await client.screenshot(path.join(output, 'desktop-narrow.png'));
  checks.push('desktop-dark-and-375px-no-horizontal-overflow');
  await client.call('Emulation.clearDeviceMetricsOverride');
  await client.key('Escape');
  navigation = { navigationId: 'fixture-notice-2', source: 'codex', sessionId: 'fixture-root' };
  window.webContents.send('dsh-pet:navigation');
  await until(() => client.evaluate(`Boolean(${dialog})`), 'repeated notification');
  checks.push('repeat-notification-reopens-dialog');
  window.destroy();

  const dashboard = path.join(workspace, 'packages/dashboard/dist');
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/functions/')) { const chunks = []; for await (const chunk of req) chunks.push(chunk); const result = await api(req.url, { method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() }); res.writeHead(result.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(result.body)); return; }
    const relative = url.pathname === '/sessions' || url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(dashboard, relative);
    if (!file.startsWith(dashboard + path.sep)) { res.writeHead(403).end(); return; }
    try { const data = await readFile(file); res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] ?? 'application/octet-stream' }).end(data); } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browserWindow = new BrowserWindow({ width: 1080, height: 900, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }); windows.push(browserWindow);
  await browserWindow.loadURL(`${origin}/sessions?sessionSource=codex&sessionId=fixture-root&sessionFocus=browser`);
  const browser = await connect(browserWindow);
  await until(() => browser.evaluate(`Boolean(${dialog})`), 'browser detail');
  await wait(250);
  await noOverflow(browser, 'browser wide overflow');
  await browser.screenshot(path.join(output, 'browser-light.png'));
  assert.equal(await browser.evaluate('typeof window.tud'), 'undefined');
  await browser.click(button('继续会话'));
  await until(async () => (await text(browser)).includes('已打开终端'), 'browser native action over HTTP');
  assert.equal(actionCalls.at(-1).source, 'codex');
  checks.push('browser-production-build-http-without-electron-bridge');
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 760, deviceScaleFactor: 1, mobile: false });
  await noOverflow(browser, '320px browser overflow');
  await browser.screenshot(path.join(output, 'browser-320.png'));
  checks.push('browser-320px-no-horizontal-overflow');
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 480, deviceScaleFactor: 1, mobile: false });
  await wait(100);
  await browser.screenshot(path.join(output, 'browser-short.png'));
  assert.equal(await browser.evaluate(`(() => { const d=${dialog}, header=d.querySelector('.modal__header'), body=d.querySelector('.modal__body'); return Boolean(header && body && body.clientHeight >= 60 && [...header.querySelectorAll('button')].every(el=>{const r=el.getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight;})); })()`), true, 'short viewport keeps actions visible and a usable body scroll area');
  checks.push('short-viewport-header-actions-and-body-remain-accessible');
  await browser.call('Emulation.clearDeviceMetricsOverride');
  await browser.evaluate('localStorage.setItem("quotern.locale.preference", "en"); true');
  directoryFailure = true;
  await browserWindow.loadURL(`${origin}/sessions?sessionSource=codex&sessionId=fixture-empty&sessionFocus=empty`);
  await until(async () => (await text(browser)).includes(empty.sessionTitle), 'unknown fixture');
  assert.ok((await text(browser)).includes('No valid samples'));
  await browser.click(summary('Session information'));
  await until(async () => (await text(browser)).includes('Could not read the project directory'), 'directory error');
  directoryFailure = false;
  await browser.click(button('Retry'));
  await until(async () => (await text(browser)).includes(fixtureDirectory), 'directory retry');
  await browser.click(button('Copy resume command'));
  await until(() => clipboard.readText() === 'codex resume fixture-empty', 'runtime command without insights');
  await browser.screenshot(path.join(output, 'browser-missing.png'));
  checks.push('english-no-insights-no-models-unknown-usage-and-directory-retry');
  resumeBlocked = true;
  await browserWindow.loadURL(`${origin}/sessions?sessionSource=codex&sessionId=fixture-root&sessionFocus=blocked`);
  await until(async () => (await text(browser)).includes('no compatible resume entry'), 'source-specific unavailable reason');
  assert.equal(await browser.evaluate(`Boolean(${button('Copy resume command')})`), false, 'explicit null must not use an old bulk command');
  assert.equal(await browser.evaluate(`(${button('Continue session')}).disabled && !(${button('Open project directory')}).disabled`), true);
  actionsUnavailable = true;
  await browserWindow.loadURL(`${origin}/sessions?sessionSource=codex&sessionId=fixture-root&sessionFocus=legacy`);
  await until(async () => (await text(browser)).includes('Could not open.'), 'legacy actions unavailable');
  assert.equal(await browser.evaluate(`(${button('Continue session')}).disabled && (${button('Open project directory')}).disabled`), true);
  await browser.click(button('Copy resume command'));
  await until(() => clipboard.readText() === 'codex resume fixture-root', 'legacy command fallback');
  await browser.click(button('More'));
  await browser.click(button('Copy project directory'));
  await until(() => clipboard.readText() === fixtureDirectory, 'legacy directory fallback');
  checks.push('runtime-null-command-and-legacy-command-directory-copy-fallback');
  assert.equal(client.errors.length, 0, JSON.stringify(client.errors));
  assert.equal(browser.errors.length, 0, JSON.stringify(browser.errors));
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, checks }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, output }));
}
const deadline = setTimeout(() => app.exit(2), 120_000);
void app.whenReady().then(main).catch(async error => { console.error(error); await mkdir(output, { recursive: true }); await writeFile(path.join(output, 'failure.txt'), String(error.stack ?? error)); for (let i = 0; i < clients.length; i++) { try { await clients[i].screenshot(path.join(output, `failure-${i}.png`)); await writeFile(path.join(output, `failure-${i}.txt`), await clients[i].evaluate('document.body.innerText')); } catch {} } process.exitCode = 1; }).finally(async () => { for (const client of clients) client.close(); for (const window of windows) if (!window.isDestroyed()) window.destroy(); if (server) await new Promise(resolve => server.close(resolve)); clearTimeout(deadline); app.exit(process.exitCode ?? 0); });
