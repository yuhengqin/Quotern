// Desktop preload, notification settings and pet activity stream, with private fixture data.
// Native delivery is captured; Windows protocol activation still uses the real host.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
// @ts-ignore shared JS renderer fixture
import { fixtureApp as app, FixtureWindow as BrowserWindow, fixtureIpc as ipcMain } from './renderer-fixture.mjs';
import { createLocalApiApp } from '../../../packages/core/src/server/local-api';
import { BucketStore } from '../../../packages/core/src/server/state';
import type { TudConfig } from '../../../packages/core/src/types';
import { desktopNotifications } from '../src/sidecar/notifications';
import { DEFAULT_QUOTA_PREFERENCES } from '../src/shared/quota';
import { NOTIFICATIONS_GET, NOTIFICATIONS_SET, NOTIFICATIONS_CLEAR, NOTIFICATIONS_TEST, NOTIFICATIONS_PREVIEW_SOUND, NOTIFICATION_NAVIGATION_GET, NOTIFICATION_NAVIGATION_ACK, type DesktopNotice } from '../src/shared/notifications';
import { DSH_PET_NAVIGATION_GET, DSH_PET_NAVIGATION_ACK } from '../src/shared/dsh-pet';
import type { ActivityEvent } from '../src/shared/agent-activity';
// @ts-ignore opt-in JS acceptance driver
import { connectPage, wait } from './desktop-cdp.mjs';
// @ts-ignore shared JS fixture for opt-in UI acceptance
import { registerAppearanceFixture } from './appearance-fixture.mjs';

const [desktop, output, portArg] = process.argv.slice(2);
assert.ok(desktop && output && portArg);
const port = Number(portArg); assert.ok(Number.isInteger(port) && port > 0);
const openProtocol = promisify(execFile);
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
  registerAppearanceFixture();
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
  let mainWindow: InstanceType<typeof BrowserWindow> | null = null, notice: { title: string; toastXml?: string; id: string } | null = null, shown = 0, closed = 0, failSave = false, failClear = false;
  const createWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed()) return;
    mainWindow = new BrowserWindow({ width: 1050, height: 750, show: false, desktop: true });
    void mainWindow.loadFile(path.join(desktop!, 'out/renderer/index.html'), { hash: '/dashboard' });
  };
  const quotaTargets: unknown[] = [], activity: ActivityEvent[] = [];
  const initialized = await desktopNotifications(path.join(root, 'profile'), (channel, ...args) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, ...args);
  }, async (channel, ...args) => {
    if (channel === 'notifications:show') {
      const value = args[0] as DesktopNotice, options = args[1] as { toast?: string };
      notice = { title: value.title, toastXml: options.toast, id: value.id }; shown++; return 'shown';
    }
    if (channel === 'notifications:remove') { closed++; return; }
    if (channel === 'host:open-main') { createWindow(); return; }
    if (channel === 'host:open-quota') { quotaTargets.push(args[0]); return; }
    throw Error('Unexpected native operation: ' + channel);
  }, () => 'zh-CN', { activityRoots: async () => [{ source: 'codex', path: activityFile }, { source: 'claude', path: claudeActivityFile }], iconPath: path.join(desktop!, 'resources/icon.png') });
  const channels = [NOTIFICATIONS_GET, NOTIFICATIONS_SET, NOTIFICATIONS_CLEAR, NOTIFICATIONS_TEST, NOTIFICATIONS_PREVIEW_SOUND, NOTIFICATION_NAVIGATION_GET, NOTIFICATION_NAVIGATION_ACK, DSH_PET_NAVIGATION_GET, DSH_PET_NAVIGATION_ACK, 'notifications:activate'];
  for (const channel of channels) ipcMain.handle(channel, (_event, ...args) => {
    if (channel === NOTIFICATIONS_SET && failSave) { failSave = false; throw Error('fixture save failure'); }
    if (channel === NOTIFICATIONS_CLEAR && failClear) { failClear = false; throw Error('fixture clear failure'); }
    return initialized.request(channel, args);
  });
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
        const launch = /launch="([^"]+)"/.exec(notice.toastXml ?? '')?.[1]?.replaceAll('&amp;', '&');
        assert.ok(launch); const previous = quotaTargets.length;
        await openProtocol('rundll32.exe', ['url.dll,FileProtocolHandler', launch]); await until(() => quotaTargets.length > previous, 'real Windows notification protocol activation');
      } else await initialized.request('notifications:activate', [notice.id, 'view']);
      assert.deepEqual(quotaTargets.at(-1), target);
    }
    checks.push('quota-and-provider-service-notifications-deliver-and-keep-navigation');
    if (process.platform === 'win32') {
      const id = randomUUID(), before = closed, navigations = quotaTargets.length;
      await initialized.send({ id, category: 'quota', title: 'Deferred fixture', body: 'No visible window is opened', replaceKey: 'snooze-acceptance', target: { kind: 'quota', value: { providerId: 'claude', providerType: 'claude' } } }, true);
      const snooze = /arguments="([^"]+:\/\/snooze\/[^\"]+)"/.exec(notice!.toastXml ?? '')?.[1]?.replaceAll('&amp;', '&');
      assert.ok(snooze); await openProtocol('rundll32.exe', ['url.dll,FileProtocolHandler', snooze]);
      await until(() => closed > before, 'real Windows snooze protocol retracts the notice');
      assert.equal(quotaTargets.length, navigations); assert.equal(mainWindow, null);
      checks.push('windows-snooze-activation-retracts-without-opening-a-window');
    }
    const ordinary = (id: string): DesktopNotice => ({ id, category: 'quota', title: `Codex · ${id} 额度偏低`, body: '5h 已使用 90%', replaceKey: id, target: { kind: 'quota', value: { providerId: id, providerType: 'codex', windowId: 'five-hour' } }, context: { kind: 'quota', alert: 'threshold-90', resetsAt: null } });
    const beforeBurst = shown;
    const burst = ['work', 'personal', 'weekly'].map(id => initialized.send(ordinary(id)));
    assert.equal(shown, beforeBurst, 'ordinary notices wait for the fixed batching window');
    assert.deepEqual(await Promise.all(burst), ['shown', 'shown', 'shown']);
    assert.equal(shown, beforeBurst + 1);
    assert.equal(notice!.title, '3 项额度提醒');
    checks.push('ordinary-real-runtime-burst-is-one-localized-native-summary');
    if (process.platform === 'win32') {
      const dismissAll = /arguments="([^"]+:\/\/dismiss-all\/[^\"]+)"/.exec(notice!.toastXml ?? '')?.[1]?.replaceAll('&amp;', '&');
      assert.ok(dismissAll);
      const beforeClear = closed, navigations = quotaTargets.length;
      await openProtocol('rundll32.exe', ['url.dll,FileProtocolHandler', dismissAll]);
      await until(() => closed > beforeClear, 'real Windows clear-all protocol');
      assert.equal(quotaTargets.length, navigations); assert.equal(mainWindow, null);
      checks.push('windows-clear-all-protocol-does-not-navigate');
    }
    const urgent = ordinary('immediate'); urgent.context = { kind: 'quota', alert: 'depleted', resetsAt: null };
    const beforeUrgent = shown, urgentStarted = performance.now(); const urgentSend = initialized.send(urgent);
    assert.equal(await urgentSend, 'shown');
    assert.equal(shown, beforeUrgent + 1, 'depletion bypasses the aggregation delay');
    assert.ok(performance.now() - urgentStarted < 1000, 'depletion completes before the batching window');
    checks.push('new-critical-event-delivers-immediately-after-clearing');
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
    await until(() => client.evaluate('window.tud.getAppearance().then(value => value?.style === "default" && value?.palette === "theme")'), 'appearance bridge initializes alongside notifications');
    checks.push('appearance-bridge-initializes-alongside-notifications');
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
    const clearButton = `Array.from(document.querySelectorAll('[data-notification-settings] button')).find(b=>b.textContent==='关闭全部提醒')`;
    failClear = true;
    await client.click(clearButton);
    await until(() => client.evaluate('document.querySelector("[data-notification-settings]").innerText.includes("关闭提醒失败")'), 'nearby clear failure');
    assert.equal(await client.evaluate('window.tud.notifications.getState().then(s=>s.pendingCount>0)'), true);
    await client.evaluate(`${clearButton}.focus()`); await client.key('Enter');
    await until(() => client.evaluate('window.tud.notifications.getState().then(s=>s.pendingCount===0)'), 'keyboard clear-all');
    await until(() => client.evaluate('document.querySelector("[data-notification-settings]").innerText.includes("当前提醒已关闭")'), 'clear success feedback');
    assert.equal(await client.evaluate('window.tud.notifications.getState().then(s=>s.preferences.modes.quota)'), 'always');
    checks.push('settings-clear-all-keyboard-failure-retry-keeps-future-policy');
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
    for (const client of clients) client.close();
    mainWindow?.destroy(); unsubscribe(); await initialized.close(); ipcMain.removeHandler('tud:api-request');
    for (const channel of channels) ipcMain.removeHandler(channel);
  }
}
const deadline = setTimeout(() => app.exit(2), 110_000);
void app.whenReady().then(main).then(() => { clearTimeout(deadline); app.exit(0); }, error => { clearTimeout(deadline); console.error(error); app.exit(1); });
