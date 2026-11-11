// Built Desktop renderer + real Core API; only native preferences/quotas are fixtures.
// This creates its own window and profile. It never attaches to a running app.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import { connectPage, unusedPort, wait } from './desktop-cdp.mjs';

let createLocalApiApp, BucketStore, applyRemotePricingOverlay, createAggregateCache, verifyDataBackup, DEFAULT_QUOTA_PREFERENCES;

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(desktop, '../..');
const output = path.resolve(process.argv[2] ?? path.join(workspace, `.quotern-dev/keeper-insights-ui-${Date.now()}-${process.pid}`));
assert.ok(!existsSync(output), 'Use a fresh dedicated output directory');
app.setPath('userData', path.join(output, 'profile'));
app.commandLine.appendSwitch('lang', 'en-US');
app.on('window-all-closed', () => {});
await mkdir(path.join(output, 'profile'), { recursive: true });
const port = await unusedPort();
app.commandLine.appendSwitch('remote-debugging-port', String(port));
const checks = [], calls = [];
let window, client, downloaded, locale = 'zh-CN';
const until = async (predicate, label) => {
  for (let i = 0; i < 150; i++) { if (await predicate()) return; await wait(100); }
  throw Error(`Timed out: ${label}`);
};
const body = () => client.evaluate('document.body.innerText');
const button = text => `[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(text)})`;
const tab = text => `[...document.querySelectorAll('[role="tab"]')].find(el=>el.textContent.trim()===${JSON.stringify(text)})`;
const labelInput = label => `document.getElementById([...document.querySelectorAll('label')].find(el=>el.textContent.trim()===${JSON.stringify(label)})?.htmlFor)`;
const select = label => `[...document.querySelectorAll('button[aria-haspopup="listbox"]')].find(el=>el.getAttribute('aria-label')===${JSON.stringify(label)} || el.parentElement?.textContent.includes(${JSON.stringify(label)}))`;
const option = label => `[...document.querySelectorAll('[role="option"]')].find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
const dialog = 'document.querySelectorAll("[role=dialog]")';
const route = async hash => { await window.loadFile(path.join(desktop, 'out/renderer/index.html'), { hash }); };
const snapshot = async name => { await client.screenshot(path.join(output, `${name}.png`)); };
const fits = async () => assert.equal(await client.evaluate('document.documentElement.scrollWidth <= innerWidth+1'), true, 'page must fit the viewport');

async function seed() {
  const dataDir = path.join(output, 'data'), quotaDir = path.join(output, 'profile/quota');
  for (const dir of ['queue', 'sessions', 'achievements']) await mkdir(path.join(dataDir, dir), { recursive: true });
  await mkdir(quotaDir, { recursive: true });
  const now = Math.floor(Date.now() / 1000), iso = at => new Date(at * 1000).toISOString();
  const config = { deviceId: 'synthetic-keeper', hostname: 'Synthetic acceptance', statsSince: iso(now - 90 * 86400), localCollectSince: iso(now - 90 * 86400), lastSyncAt: iso(now) };
  await writeFile(path.join(dataDir, 'config.json'), JSON.stringify(config));
  await writeFile(path.join(dataDir, 'cursors.json'), '{}');
  await writeFile(path.join(dataDir, 'achievements/state.json'), JSON.stringify({ version: 1, initializedAt: iso(now), earned: [], records: [], annual: [], preferences: { celebrationsEnabled: false, showcaseIds: [] } }));
  applyRemotePricingOverlay({ exact: { 'openai/gpt-6.1-sol': { input: 2, output: 4, cache_read: 1, cache_write: 2 }, 'anthropic/claude-opus-4-8': { input: 3, output: 8, cache_read: 1, cache_write: 3 } } });
  const rows = [];
  for (const [source, model, project] of [['codex', 'openai/gpt-6.1-sol', '合成验收 Alpha'], ['claude', 'anthropic/claude-opus-4-8', '合成验收 Beta']]) {
    const files = {};
    for (let day = 0; day < 7; day++) {
      const sessionId = `synthetic-${source}-${day}`, timestamp = iso(now - day * 86400 - 1200);
      const base = { source, sessionId, timestamp, projectLabel: project };
      const tokenParts = { input_tokens: 10000, output_tokens: 2000, cached_input_tokens: 3000, cache_creation_input_tokens: 0, reasoning_output_tokens: 0 };
      const evidence = Object.fromEntries(Array.from({ length: 6 }, (_, n) => [`request-${n}`, { ...base, id: `request-${n}`, kind: 'request', model, timestamp: iso(now - day * 86400 - 1200 + n * 20), ttftMs: day === (source === 'codex' ? 0 : 1) ? 300 + day * 150 + n * 130 : undefined, outputTokens: 400 + n * 80, durationMs: 2000 + n * 300 + day * 200 }]));
      files[`${sessionId}.jsonl`] = { complete: true, size: 0, mtimeMs: 0, ino: 0, offset: 0, guard: '', context: { sessionId }, evidence,
        messages: { user: { ...base, id: 'user', role: 'user' }, assistant: { ...base, id: 'assistant', role: 'assistant' } },
        observations: { usage: { ...base, id: 'usage', model, tokens: 15000, usageKnown: true, tokenParts, costUsd: null, costKind: 'estimated', costBasis: 'request-facts', billing: { service: source === 'codex' ? 'openai' : 'anthropic', mode: 'subscription', accountRef: source === 'codex' ? 'synthetic-account' : null, evidence: 'recorded' } } },
        titles: { [sessionId]: { title: `${project} ${day + 1}`, priority: 2 } } };
      rows.push({ source, model, project, hour_start: iso(Math.floor((now - day * 86400 - 1200) / 1800) * 1800), ...tokenParts, total_tokens: 15000, conversation_count: 1 });
    }
    await writeFile(path.join(dataDir, `sessions/${source}.json`), JSON.stringify({ version: 11, source, complete: true, files }));
  }
  for (const month of new Set(rows.map(row => row.hour_start.slice(0, 7)))) await writeFile(path.join(dataDir, `queue/${month}.jsonl`), rows.filter(row => row.hour_start.startsWith(month)).map(row => JSON.stringify(row)).join('\n') + '\n');
  const samples = [-1, 0].flatMap(cycle => Array.from({ length: 8 }, (_, n) => ({ at: now - 1800 + cycle * 18000 + n * 200, usedPercent: 10 + n * 7, resetsAt: now + 16200 + cycle * 18000, durationSeconds: 18000, service: 'openai', accountRef: 'synthetic-account' })));
  const weeklySamples = [{ at: now - 7200, usedPercent: 10, resetsAt: now + 86400 }, { at: now - 3600, usedPercent: 15, resetsAt: now + 86400 }];
  await writeFile(path.join(quotaDir, 'history.json'), JSON.stringify({ 'codex:synthetic-private:account:18000': samples }));
  await writeFile(path.join(quotaDir, 'preferences.json'), JSON.stringify(DEFAULT_QUOTA_PREFERENCES));
  const provider = { id: 'codex', label: 'Codex', status: 'ready', planLabel: 'Pro', fetchedAt: now, queriedAt: now, stale: false, message: null, details: [], resetCredits: null, refreshing: false, nextRefreshAt: null, analyses: {}, service: null, windows: [{ id: 'account:18000', label: '5h', usedPercent: 59, resetsAt: now + 16200, durationSeconds: 18000 }] };
  const quota = { providers: [provider], preferences: DEFAULT_QUOTA_PREFERENCES, notice: null };
  const store = new BucketStore(); store.apply(rows);
  const aggregateCache = await createAggregateCache(dataDir, rows);
  let failNextPriceUpdate = false;
  const rebuild = aggregateCache.rebuildFromRows.bind(aggregateCache);
  aggregateCache.rebuildFromRows = async rows => { await wait(500); if (failNextPriceUpdate) { failNextPriceUpdate = false; throw new Error('Synthetic cache write failure'); } await rebuild(rows); };
  const api = createLocalApiApp({ dataDir, bucketStore: store, aggregateCache, getConfig: () => config, sessionActionsIpc: true, desktopQuotaDirectory: quotaDir, getQuotaState: () => quota,
    getQuotaHistory: () => ({ providerId: 'codex', label: 'Codex', revision: 1, windows: [{ id: 'account:18000', label: '5h', samples }, { id: '7d', label: '7d', samples: weeklySamples }] }) });
  return { dataDir, api, quota, failPriceUpdate: () => { failNextPriceUpdate = true; } };
}

async function main() {
  const { dataDir, api, quota, failPriceUpdate } = await seed();
  let missingPriceJob = false;
  ipcMain.handle('tud:api-request', async (_event, route, init) => {
    const response = await api.request(`http://tud.local${route}`, init);
    const result = await response.json();
    if (missingPriceJob && route.startsWith('/functions/tud-local-admin/pricing/recalculation?id=')) { missingPriceJob = false; result.data.job = null; }
    calls.push({ route, method: init?.method ?? 'GET', status: response.status, success: result.success, message: result.message });
    return { status: response.status, body: result };
  });
  const localeState = () => ({ preference: locale, resolved: locale === 'system' ? 'en' : locale, systemLocale: 'en' });
  ipcMain.handle('locale:get', localeState);
  ipcMain.handle('locale:set', (_event, value) => { locale = value; const state = localeState(); window.webContents.send('locale:changed', state); return state; });
  ipcMain.handle('theme:get', () => ({ mode: 'light', resolved: 'light' }));
  ipcMain.on('theme:set', (_event, mode) => window.webContents.send('theme:changed', { mode, resolved: mode === 'dark' ? 'dark' : 'light' }));
  ipcMain.handle('auto-update:get-state', () => ({ status: 'unsupported', currentVersion: 'fixture' }));
  ipcMain.handle('dashboard-range:get', () => 'last-7-days');
  ipcMain.handle('dashboard-range:set', (_event, value) => value);
  ipcMain.handle('dsh-pet:navigation-get', () => null);
  ipcMain.handle('quota:navigation:get', () => null);
  for (const channel of ['autostart:get', 'autostart:get-hidden', 'tray-usage:get']) ipcMain.handle(channel, () => false);
  ipcMain.handle('tray-usage-mode:get', () => 'both');
  ipcMain.handle('quota:get', () => quota);
  ipcMain.handle('quota:refresh', () => quota);
  window = new BrowserWindow({ width: 1100, height: 920, show: true, webPreferences: { preload: path.join(desktop, 'out/preload/index.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.webContents.session.on('will-download', (_event, item) => { const file = path.join(output, 'downloaded-backup.json'); item.setSavePath(file); item.once('done', (_event, state) => { if (state === 'completed') downloaded = file; }); });
  await route('/performance');
  let target;
  await until(async () => { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(page => page.type === 'page' && page.url === window.webContents.getURL()); return target; }, 'renderer debugger');
  client = await connectPage(target, { waitForActionability: true });
  await until(async () => (await body()).includes('84 个样本'), '84 raw samples');
  await fits(); await snapshot('desktop-performance');
  await client.click(select('Agent')); await client.click(option('Codex'));
  await until(async () => (await body()).includes('42 个样本'), 'source filters raw samples');
  await client.click(button('清除筛选')); await until(async () => (await body()).includes('84 个样本'), 'clear filters');
  await client.click(`[...document.querySelectorAll('[role="columnheader"]')].find(el=>el.textContent.includes('首字时间 P95'))`);
  await until(() => client.evaluate(`Boolean(document.querySelector('[aria-sort="ascending"]'))`), 'metric sorting');
  for (const model of ['openai/gpt-6.1-sol', 'anthropic/claude-opus-4-8']) await client.click(`document.querySelector('input[aria-label="比较 ${model}"]').closest('label')`);
  await until(async () => (await body()).includes('已选 2 个模型') && (await body()).includes('模型首字时间 P50'), 'two model trends');
  await until(() => client.evaluate(`[...document.querySelectorAll('h2')].find(el=>el.textContent.includes('模型首字时间 P50'))?.closest('section').querySelectorAll('.recharts-line-dot').length === 2`), 'isolated model samples on different dates remain visible');
  await client.evaluate(`[...document.querySelectorAll('h2')].find(el=>el.textContent.includes('模型首字时间 P50')).scrollIntoView({block:'start'}); true`);
  await snapshot('desktop-performance-comparison');
  await client.click(`document.querySelector('button[aria-label="查看 openai/gpt-6.1-sol 的样本"]')`);
  await until(async () => (await body()).includes('42 个样本'), 'model row filters samples');
  await client.evaluate(`document.querySelector('a[href*=sessionId]').scrollIntoView({block:'center'}); true`);
  const returnHash = await client.evaluate('location.hash');
  const returnTop = await client.evaluate('document.querySelector("[data-dashboard-scroll-container]")?.scrollTop ?? window.scrollY');
  await client.click("document.querySelector('a[href*=sessionId]')");
  await until(() => client.evaluate(`${dialog}.length > 0 && document.body.innerText.includes('本会话活动')`), 'sample opens exact session');
  await client.key('Escape');
  assert.ok((await body()).includes('性能样本关联会话'));
  await client.click(`[...document.querySelectorAll('a')].find(el=>el.textContent.includes('返回性能分析'))`);
  await until(() => client.evaluate(`location.hash === ${JSON.stringify(returnHash)} && Math.abs((document.querySelector('[data-dashboard-scroll-container]')?.scrollTop ?? window.scrollY) - ${returnTop}) < 3`), 'performance return restores URL and scroll');
  checks.push('desktop-real-ipc-performance-sort-compare-drilldown-and-return');

  await route('/pricing');
  await until(() => client.evaluate(`Boolean(${button('用户价格')})`), 'price manager');
  await client.click(button('用户价格'));
  await until(() => client.evaluate(`Boolean(${labelInput('完整模型 ID')})`), 'price form');
  await client.click(button('保存并更新估算'));
  await until(async () => (await body()).includes('请至少填写一项单价') && (await body()).includes('请填写有效的完整模型 ID'), 'empty form has field errors');
  assert.equal(await client.evaluate(`Boolean(${button('重试')})`), false, 'validation does not offer a network retry');
  await client.key('Escape');
  await client.fill('document.querySelector("input[type=search]")', 'gpt-6.1-sol');
  await until(() => client.evaluate(`Boolean(document.querySelector('button[aria-label="编辑 openai/gpt-6.1-sol 的用户价格"]'))`), 'model row edit');
  await client.click(`document.querySelector('button[aria-label="编辑 openai/gpt-6.1-sol 的用户价格"]')`);
  await until(() => client.evaluate(`${labelInput('完整模型 ID')}?.value === 'openai/gpt-6.1-sol'`), 'row prefills exact ID');
  await until(async () => (await body()).includes('当前生效') && (await body()).includes('修改后'), 'base rate preview');
  await client.fill(labelInput('输入'), '-1');
  await client.click(button('保存并更新估算'));
  await until(async () => (await body()).includes('0–1000000'), 'negative price rejected');
  await client.fill(labelInput('输入'), '0');
  failPriceUpdate();
  await client.click(button('保存并更新估算'));
  await until(async () => (await body()).includes('价格已保存 · 历史估算更新中'), 'save acknowledged before recalculation');
  await until(async () => (await body()).includes('历史估算更新未完成'), 'recalculation failure is actionable');
  const savedBeforeRetry = await readFile(path.join(dataDir, 'pricing-manual.json'), 'utf8');
  missingPriceJob = true;
  await client.click(button('重试更新估算'));
  await until(async () => (await body()).includes('暂时无法确认估算更新结果'), 'missing job has a recovery action');
  await client.click(button('重新读取并保留草稿'));
  await until(async () => (await body()).includes('已保存并更新估算'), 'price saved');
  assert.equal(await readFile(path.join(dataDir, 'pricing-manual.json'), 'utf8'), savedBeforeRetry, 'retry does not resubmit a draft');
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'pricing-manual.json'), 'utf8')).models['openai/gpt-6.1-sol'].input, 0);
  assert.equal(await client.evaluate('document.activeElement.textContent.trim()'), '保存并更新估算');
  await snapshot('desktop-manual-pricing');
  await client.click(button('恢复参考价'));
  await until(() => client.evaluate(`Boolean(${button('保存并更新估算')} && !${button('保存并更新估算')}.disabled && ${button('恢复参考价')}?.disabled)`), 'price override removed');
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'pricing-manual.json'), 'utf8')).models['openai/gpt-6.1-sol'], undefined);
  await client.key('Escape'); await until(() => client.evaluate(`${dialog}.length === 0`), 'Escape closes after save');
  checks.push('desktop-price-row-prefill-preview-validation-background-failure-retry-revert-and-focus');

  await route('/dashboard');
  await until(() => client.evaluate(`Boolean(document.querySelector('button[aria-label="查看 Codex 额度详情"]'))`), 'quota card');
  await client.click(`document.querySelector('button[aria-label="查看 Codex 额度详情"]').parentElement`);
  const historyCallsBefore = calls.filter(call => call.route.startsWith('/functions/tud-quota-history')).length;
  await client.evaluate(`${tab('当前额度')}.focus(); true`); await client.key('ArrowRight');
  assert.equal(calls.filter(call => call.route.startsWith('/functions/tud-quota-history')).length, historyCallsBefore, 'arrow focus does not fetch history');
  await client.key('Enter');
  await until(async () => (await body()).includes('同账号本机 Token'), 'account-linked history');
  assert.ok((await body()).includes('1.5万'));
  assert.equal(await client.evaluate(`${dialog}.length`), 1, 'history shares the details dialog');
  assert.ok((await body()).includes('当前周期'));
  const point = await client.evaluate(`(() => { const r = [...${dialog}].at(-1).querySelector('.recharts-wrapper').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await until(() => client.evaluate(`Boolean([...${dialog}].at(-1).querySelector('.recharts-tooltip-wrapper')?.textContent)`), 'quota chart tooltip');
  assert.ok(!(await body()).includes('Invalid Date'), 'quota tooltip must format the sample timestamp');
  await snapshot('desktop-quota-history');
  window.setSize(390, 780); await wait(150); await fits(); await snapshot('desktop-quota-history-narrow');
  await client.click(select('观察周期')); await client.key('End'); await client.key('Enter');
  await until(async () => (await body()).includes('暂无可可靠关联的本机用量'), 'old cycle without attributed use');
  assert.ok((await body()).includes('已结束'));
  await client.click(select('额度窗口')); await client.key('End'); await client.key('Enter');
  await until(async () => (await body()).includes('周限额') && (await body()).includes('起点未知'), 'localized weekly window keeps unknown cycle start');
  await client.key('Escape');
  await until(() => client.evaluate(`${dialog}.length === 0`), 'one Escape closes quota details');
  assert.equal(await client.evaluate('document.activeElement.getAttribute("aria-label")'), '查看 Codex 额度详情');
  checks.push('desktop-quota-cycle-selection-account-join-and-narrow-layout');

  window.setSize(1000, 920);
  // Use the production shell navigation event to select the data settings tab.
  await client.evaluate('window.dispatchEvent(new CustomEvent("tud:open-settings", { detail: { tab: "data" } })); true');
  await until(() => client.evaluate(`Boolean(${button('创建并下载备份')})`), 'backup settings');
  await client.click(button('创建并下载备份'));
  await until(() => downloaded, 'backup download completes');
  const backup = JSON.parse(await readFile(downloaded, 'utf8'));
  verifyDataBackup(backup);
  assert.ok(backup.files.some(file => file.path === 'desktop/quota/history.json'));
  assert.ok(!JSON.parse(backup.files.find(file => file.path === 'config.json').content).deviceId);
  const { root } = await client.call('DOM.getDocument');
  const { nodeId } = await client.call('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
  await client.call('DOM.setFileInputFiles', { nodeId, files: [downloaded] });
  await until(async () => (await body()).includes('校验通过'), 'file input verifies saved backup');
  await until(() => client.evaluate('Boolean(document.querySelector("[data-backup-preview]"))'), 'validated content preview');
  assert.ok((await body()).includes('用量记录时间（UTC）'));
  assert.ok((await body()).includes('包含来源：Claude · Codex'));
  assert.ok((await body()).includes('新目录只包含该备份的内容'));
  await client.fill(labelInput('恢复目录（必须尚不存在）'), dataDir);
  await client.click(button('恢复到新目录'));
  await until(async () => (await body()).includes('目标已存在'), 'existing directory rejected');
  await until(async () => (await body()).includes('保护备份已保存'), 'protection remains visible after restore conflict');
  const protectionFiles = (await import('node:fs/promises')).readdir;
  const protections = await protectionFiles(path.join(dataDir, 'backups'));
  assert.equal(protections.length, 1);
  verifyDataBackup(JSON.parse(await readFile(path.join(dataDir, 'backups', protections[0]), 'utf8')));
  const restored = path.join(output, 'restored');
  await client.fill(labelInput('恢复目录（必须尚不存在）'), restored);
  await client.click(button('恢复到新目录'));
  await until(async () => (await body()).includes('恢复完成，目录'), 'restore completes');
  assert.equal(await readFile(path.join(restored, 'sessions/codex.json'), 'utf8'), await readFile(path.join(dataDir, 'sessions/codex.json'), 'utf8'));
  await snapshot('desktop-backup-restored');
  const broken = path.join(output, 'corrupt-backup.json'); await writeFile(broken, '{"invalid":true}');
  const dom = await client.call('DOM.getDocument');
  const input = await client.call('DOM.querySelector', { nodeId: dom.root.nodeId, selector: 'input[type=file]' });
  await client.call('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [broken] });
  await until(async () => (await body()).includes('备份校验失败'), 'corrupt backup rejected');
  assert.equal(await client.evaluate(`Boolean(${button('恢复到新目录')})`), false);
  checks.push('desktop-backup-content-preview-protection-conflict-path-and-real-restore');

  await client.evaluate('window.dispatchEvent(new CustomEvent("tud:open-settings", { detail: { tab: "appearance" } })); true');
  await client.click(`document.querySelector('input[name="token-unit-mode"][value="international"]').closest('label')`);
  await until(() => client.evaluate(`document.querySelector('input[name="token-unit-mode"][value="international"]').checked`), 'international token units selected');
  await client.key('Escape');
  await client.click(`document.querySelector('button[aria-label="查看 Codex 额度详情"]').parentElement`);
  assert.equal(await client.evaluate(`${tab('当前额度')}.getAttribute('aria-selected')`), 'true', 'reopening starts at current quota');
  await client.click(tab('额度历史'));
  await until(async () => (await body()).includes('同账号本机 Token') && (await body()).includes('15K'), 'quota history respects saved token units');
  await client.key('Escape');
  for (const [value, heading] of [['en', 'Performance'], ['ja', 'パフォーマンス分析'], ['ko', '성능 분석']]) {
    await client.evaluate('window.dispatchEvent(new CustomEvent("tud:open-settings", { detail: { tab: "appearance" } })); true');
    await client.click(`document.querySelector('input[name="locale-preference"][value="${value}"]').closest('label')`);
    await until(() => localeState().resolved === value, `locale ${value}`);
    await client.key('Escape');
    await until(() => client.evaluate(`${dialog}.length === 0`), 'settings close before localized page');
    await route('/performance');
    await until(() => client.evaluate(`document.querySelector('h1')?.textContent === ${JSON.stringify(heading)}`), `localized performance ${value}`);
    assert.ok(!/\b(?:insights|history)\.[a-z]/.test(await body()));
    if (value === 'en') { window.setSize(390, 780); await wait(150); await fits(); await snapshot('desktop-performance-english-narrow'); window.setSize(1000, 920); }
  }
  checks.push('desktop-token-unit-preference-and-four-locales');

  assert.deepEqual(client.errors, []);
  assert.ok(calls.some(call => call.route.startsWith('/functions/tud-performance')));
  assert.ok(calls.some(call => call.route === '/functions/tud-local-admin/backup' && call.method === 'POST'));
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ ok: true, checks, calls, output }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, output }));
}
const deadline = setTimeout(() => app.exit(2), 120_000);
void app.whenReady().then(async () => {
  ({ createLocalApiApp, BucketStore, applyRemotePricingOverlay, createAggregateCache, verifyDataBackup } = await import('../../../packages/core/dist/index.js'));
  ({ DEFAULT_QUOTA_PREFERENCES } = await import('../../../packages/core/dist/quota/shared/quota.js'));
  await main();
}).catch(async error => {
  console.error(error);
  await writeFile(path.join(output, 'error.txt'), String(error.stack ?? error));
  await writeFile(path.join(output, 'calls.json'), JSON.stringify(calls, null, 2));
  if (client) { await writeFile(path.join(output, 'failure.txt'), await body()).catch(() => {}); await snapshot('failure').catch(() => {}); }
  process.exitCode = 1;
}).finally(() => { clearTimeout(deadline); client?.close(); window?.destroy(); app.exit(process.exitCode ?? 0); });
