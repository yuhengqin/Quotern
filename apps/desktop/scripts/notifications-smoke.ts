// Real Desktop preload, notification settings and pet activity stream, with private fixture data.
// OS toast delivery is intentionally excluded: show() captures the real Notification object.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron';
import { createLocalApiApp } from '../../../packages/core/src/server/local-api';
import { BucketStore } from '../../../packages/core/src/server/state';
import type { TudConfig } from '../../../packages/core/src/types';
import { initializeNotifications } from '../src/main/notifications/runtime';
import { DEFAULT_QUOTA_PREFERENCES } from '../src/shared/quota';
import { NOTIFICATIONS_SET } from '../src/shared/notifications';
import type { ActivityEvent } from '../src/shared/agent-activity';
// @ts-ignore opt-in JS acceptance driver
import { connectPage, wait } from './desktop-cdp.mjs';

const [desktop, output, portArg] = process.argv.slice(2);
assert.ok(desktop && output && portArg);
const port = Number(portArg); assert.ok(Number.isInteger(port) && port > 0);
const root = path.resolve(output!);
assert.equal(existsSync(root), false, 'use fresh navigation acceptance data');
mkdirSync(path.join(root, 'profile'), { recursive: true });
process.env.QUOTERN_DEV_ISOLATED = '1';
process.env.QUOTERN_DATA_DIR = path.join(root, 'data');
process.env.QUOTERN_CONFIG_HOME = path.join(root, 'config-home');
app.setPath('userData', path.join(root, 'profile'));
app.on('window-all-closed', () => {});
app.commandLine.appendSwitch('remote-debugging-port', String(port));

async function main() {
  await mkdir(root, { recursive: true });
  await mkdir(path.join(root, 'profile/notifications'), { recursive: true });
  await writeFile(path.join(root, 'profile/notifications/preferences.json'), JSON.stringify({ version: 1, modes: { agentComplete: 'always', agentConfirmation: 'always', agentError: 'always', quota: 'background', service: 'always' }, sound: 'none' }));
  const activityFile = path.join(root, 'activity.jsonl');
  await writeFile(activityFile, JSON.stringify({ type: 'session_meta', payload: { id: 'codex-live' } }) + '\n');
  const claudeActivityFile = path.join(root, 'claude-activity.jsonl');
  await writeFile(claudeActivityFile, JSON.stringify({ type: 'user', sessionId: 'claude-live' }) + '\n');
  const api = createLocalApiApp({ dataDir: root, bucketStore: new BucketStore(), getConfig: () => ({ statsSince: '2026-01-01T00:00:00Z', localCollectSince: '2026-01-01T00:00:00Z' } as TudConfig) });
  ipcMain.handle('locale:get', () => ({ preference: 'zh-CN', resolved: 'zh-CN', systemLocale: 'zh-CN' }));
  ipcMain.handle('theme:get', () => ({ mode: 'light', resolved: 'light' }));
  ipcMain.handle('auto-update:get-state', () => ({ status: 'unsupported', currentVersion: 'fixture' }));
  ipcMain.handle('dashboard-range:get', () => 'last-7-days');
  ipcMain.handle('dashboard-range:set', (_event, value) => value);
  ipcMain.handle('quota:get', () => ({ providers: [], preferences: DEFAULT_QUOTA_PREFERENCES, notice: null }));
  ipcMain.handle('quota:navigation:get', () => null);
  ipcMain.handle('quota:navigation:ack', () => {});
  ipcMain.handle('quota:dialog-state', () => {});
  const routes: string[] = [];
  ipcMain.handle('tud:api-request', async (_event, route: string, init?: { method?: string; body?: string }) => {
    routes.push(route);
    const response = await api.request(route, init); return { status: response.status, body: await response.json() };
  });
  let mainWindow: BrowserWindow | null = null, notice: Notification | null = null, shown = 0, closed = 0, failSave = false;
  const originalShow = Notification.prototype.show;
  const originalClose = Notification.prototype.close;
  Notification.prototype.show = function () { notice = this; shown++; this.emit('show'); };
  Notification.prototype.close = function () { closed++; return originalClose.call(this); };
  const createWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed()) return;
    mainWindow = new BrowserWindow({ width: 1050, height: 750, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, preload: path.join(desktop!, 'out/preload/index.js') } });
    const created = mainWindow; created.once('ready-to-show', () => { if (!created.isDestroyed()) created.showInactive(); });
    void mainWindow.loadFile(path.join(desktop!, 'out/renderer/index.html'), { hash: '/dashboard' });
  };
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => originalHandle(channel, (event, ...args) => { if (channel === NOTIFICATIONS_SET && failSave) { failSave = false; throw Error('fixture save failure'); } return handler(event, ...args); });
  const quotaTargets: unknown[] = [], activity: ActivityEvent[] = [];
  const initialized = await initializeNotifications({ getMainWindow: () => mainWindow && !mainWindow.isDestroyed() ? mainWindow : null, showQuota: target => { quotaTargets.push(target); }, getLocale: () => 'zh-CN', activityRoots: [{ source: 'codex', path: activityFile }, { source: 'claude', path: claudeActivityFile }], showMainWindow: createWindow, applicationDirectory: desktop });
  ipcMain.handle = originalHandle;
  const unsubscribe = initialized.activity.subscribe(event => { activity.push(event); });
  const clients: Array<{ close(): void; evaluate(expression: string): Promise<unknown>; screenshot(file: string): Promise<void> }> = [], checks: string[] = [];
  const until = async (predicate: () => boolean | Promise<boolean>, label: string) => {
    for (let i = 0; i < 200; i++) { if (await predicate()) return; await wait(100); } throw Error('Timed out: ' + label);
  };
  const connect = async () => {
    let target;
    await until(async () => { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((value: { type: string }) => value.type === 'page'); return Boolean(target); } catch { return false; } }, 'main renderer');
    const client = await connectPage(target, { waitForActionability: true }); clients.push(client); return client;
  };
  try {
    await initialized.start();
    const timestamp = new Date().toISOString();
    await appendFile(activityFile, [
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'fixture-turn' } },
      { type: 'response_item', payload: { type: 'function_call', name: 'functions.request_user_input', call_id: 'fixture-ask' } },
      { type: 'event_msg', payload: { type: 'error', message: 'fixture API failure' } },
    ].map(record => JSON.stringify({ ...record, timestamp })).join('\n') + '\n');
    await appendFile(claudeActivityFile, [
      { type: 'assistant', message: { stop_reason: 'end_turn', content: [] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'fixture-ask', name: 'AskUserQuestion' }] } },
      { type: 'assistant', isApiErrorMessage: true, message: { content: [] } },
    ].map(record => JSON.stringify({ ...record, timestamp, sessionId: 'claude-live' })).join('\n') + '\n');
    await until(() => activity.length === 6, 'Codex and Claude activity stays available to pets');
    for (const source of ['codex', 'claude']) assert.deepEqual(activity.filter(event => event.source === source).map(event => event.state), ['result', 'waiting', 'error']);
    assert.equal(shown, 0, 'Agent log activity must not send a system notification');
    const hookDirectory = path.join(process.env.QUOTERN_DATA_DIR!, 'integrations/notification-events');
    await mkdir(hookDirectory, { recursive: true });
    for (const [index, [kind, event]] of [['confirmation', 'PermissionRequest'], ['error', 'StopFailure'], ['complete', 'Stop']].entries()) {
      const id = `${Date.now() + index}-0123456789abcdef`;
      await writeFile(path.join(hookDirectory, `${id}.json`), JSON.stringify({ version: 1, id, source: 'claude', sessionId: 'hook-live', at: Date.now() / 1000, kind, event }));
    }
    await until(() => activity.length === 9, 'legacy Hook activity stays available to pets');
    assert.deepEqual(activity.filter(event => event.sessionId === 'hook-live').map(event => event.state), ['waiting', 'error', 'result']);
    assert.equal(shown, 0, 'Agent Hook activity must not send a system notification');
    checks.push('codex-claude-log-and-hook-states-remain-available-without-system-notices');
    for (const category of ['quota', 'service'] as const) {
      const target = { providerId: 'claude', providerType: 'claude' as const, ...(category === 'quota' ? { windowId: 'five-hour' } : {}) };
      await initialized.send({ id: randomUUID(), category, title: 'Fixture notification', body: 'Quota navigation acceptance', target: { kind: 'quota', value: target } }, true);
      assert.ok(notice);
      if (process.platform === 'win32') {
        const launch = /launch="([^"]+)"/.exec((notice as Notification).toastXml)?.[1]?.replaceAll('&amp;', '&');
        assert.ok(launch); const previous = quotaTargets.length;
        await shell.openExternal(launch); await until(() => quotaTargets.length > previous, 'real Windows notification protocol activation');
      } else (notice as Notification).emit('click');
      assert.deepEqual(quotaTargets.at(-1), target);
    }
    checks.push('quota-and-provider-service-notifications-deliver-and-keep-navigation');
    if (process.platform === 'win32') {
      const id = randomUUID(), before = closed, navigations = quotaTargets.length;
      await initialized.send({ id, category: 'quota', title: 'Deferred fixture', body: 'No visible window is opened', replaceKey: 'snooze-acceptance', target: { kind: 'quota', value: { providerId: 'claude', providerType: 'claude' } } }, true);
      const snooze = /arguments="([^"]+:\/\/snooze\/[^\"]+)"/.exec((notice as unknown as Notification).toastXml)?.[1]?.replaceAll('&amp;', '&');
      assert.ok(snooze); await shell.openExternal(snooze);
      await until(() => closed > before, 'real Windows snooze protocol retracts the notice');
      assert.equal(quotaTargets.length, navigations); assert.equal(mainWindow, null);
      checks.push('windows-snooze-activation-retracts-without-opening-a-window');
    }
    if (process.argv.includes('--actions-only')) {
      await writeFile(path.join(root, 'result.json'), JSON.stringify({ ok: true, checks, visibleWindows: 0, nativeDelivery: false }, null, 2));
      console.log(JSON.stringify({ ok: true, checks, visibleWindows: 0, nativeDelivery: false })); return;
    }
    createWindow();
    const client = await connect();
    await until(() => client.evaluate('Boolean(window.tud?.notifications)'), 'real notification preload');
    await until(async () => {
      mainWindow!.webContents.send('app:open-settings', { tab: 'notifications' });
      return client.evaluate('document.querySelectorAll("[data-notification-settings] button[aria-haspopup=listbox]").length===3');
    }, 'notification settings after the app shell subscribes');
    const settingsText = await client.evaluate('document.querySelector("[data-notification-settings]").innerText') as string;
    assert.match(settingsText, /额度提醒/); assert.match(settingsText, /Agent 服务状态变化/);
    assert.doesNotMatch(settingsText, /本轮完成|需要确认或回答|Agent 错误|Agent 连接|连接通知|更新连接/);
    assert.equal(routes.some(route => route.startsWith('/functions/tud-agent')), false, 'notification settings must not read or modify Agent connections');
    assert.deepEqual(await client.evaluate('window.tud.notifications.getState().then(s=>Object.keys(s.preferences.modes))'), ['quota', 'service']);
    checks.push('notification-settings-retain-only-quota-service-and-sound-without-agent-connections');
    const select = (index: number) => `document.querySelectorAll('[data-notification-settings] button[aria-haspopup=listbox]')[${index}]`;
    const closeMenu = async () => { if (await client.evaluate('Boolean(document.querySelector("[data-notification-settings] button[aria-haspopup=listbox][aria-expanded=true]"))')) await client.key('Escape'); };
    await client.click(select(0)); await client.key('End'); await client.key('Enter');
    await until(() => client.evaluate('window.tud.notifications.getState().then(s=>s.preferences.modes.quota==="always")'), 'saved quota policy');
    await closeMenu();
    checks.push('keyboard-policy-selection-persists');
    failSave = true;
    await client.click(select(0));
    await client.click('Array.from(document.querySelectorAll("[role=option]")).find(el=>el.getBoundingClientRect().height>0&&el.innerText.trim()==="从不")');
    await until(() => client.evaluate('document.querySelector("[data-notification-settings]").innerText.includes("操作失败")'), 'nearby save failure');
    assert.equal(await client.evaluate('window.tud.notifications.getState().then(s=>s.preferences.modes.quota)'), 'always');
    await closeMenu();
    checks.push('failed-write-preserves-effective-policy');
    await client.click(select(2));
    await client.click('Array.from(document.querySelectorAll("[role=option]")).find(el=>el.getBoundingClientRect().height>0&&el.innerText.trim()==="清脆")');
    await until(() => client.evaluate('window.tud.notifications.getState().then(s=>s.preferences.sound==="bell")'), 'saved sound');
    await closeMenu();
    // Run the production Windows audio path once; native toast display remains captured.
    await client.click(`Array.from(document.querySelectorAll('[data-notification-settings] button')).find(b=>b.textContent==='试听')`);
    await until(() => client.evaluate(`Array.from(document.querySelectorAll('[data-notification-settings] button')).some(b=>b.textContent==='试听'&&!b.disabled)`), 'audio preview completed');
    assert.equal(await client.evaluate('document.querySelector("[data-notification-settings]").innerText.includes("操作失败")'), false);
    checks.push('production-windows-sound-preview');
    await client.evaluate('window.tud.notifications.setPreferences({sound:"none"})');
    await client.click(`Array.from(document.querySelectorAll('[data-notification-settings] button')).find(b=>b.textContent==='测试通知')`);
    await until(() => client.evaluate('document.querySelector("[data-notification-settings]").innerText.includes("系统已确认显示测试通知")'), 'test feedback');
    checks.push('native-notification-object-and-honest-test-feedback');
    await client.screenshot(path.join(root, 'notifications-wide.png'));
    mainWindow!.setSize(650, 700);
    await wait(300);
    assert.equal(await client.evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
    await client.screenshot(path.join(root, 'notifications-narrow.png'));
    checks.push('narrow-settings-layout');
    assert.deepEqual(client.errors, []);
    console.log(JSON.stringify({ ok: true, checks }));
    await writeFile(path.join(root, 'result.json'), JSON.stringify({ ok: true, checks }, null, 2));
  } catch (error) {
    const client = clients.at(-1);
    if (client) {
      console.error(await client.evaluate('JSON.stringify({text:document.body.innerText.slice(-6000),choices:Array.from(document.querySelectorAll("[data-notification-settings] button[aria-haspopup=listbox]")).map(el=>({text:el.textContent,disabled:el.disabled,aria:el.getAttribute("aria-disabled")}))})').catch(() => 'renderer unavailable'));
      await client.screenshot(path.join(root, 'failure.png')).catch(() => {});
    }
    throw error;
  } finally {
    Notification.prototype.show = originalShow;
    Notification.prototype.close = originalClose;
    for (const client of clients) client.close();
    mainWindow?.destroy(); unsubscribe(); initialized.dispose(); ipcMain.removeHandler('tud:api-request');
  }
}
const deadline = setTimeout(() => app.exit(2), 110_000);
void app.whenReady().then(main).then(() => { clearTimeout(deadline); app.exit(0); }, error => { clearTimeout(deadline); console.error(error); app.exit(1); });
