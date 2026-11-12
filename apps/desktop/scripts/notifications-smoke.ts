// Real Desktop preload, React routes and Notification click handlers, with private fixture data.
// OS toast delivery is intentionally excluded: show() captures the real Notification object.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import { createLocalApiApp } from '../../../packages/core/src/server/local-api';
import { BucketStore } from '../../../packages/core/src/server/state';
import { syncSessionSource } from '../../../packages/core/src/session-collector';
import type { TudConfig } from '../../../packages/core/src/types';
import { initializeNotifications } from '../src/main/notifications/runtime';
import { DEFAULT_QUOTA_PREFERENCES } from '../src/shared/quota';
import { NOTIFICATIONS_SET } from '../src/shared/notifications';
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
  await writeFile(path.join(root, 'profile/notifications/preferences.json'), JSON.stringify({ version: 1, sound: 'none' }));
  const activityFile = path.join(root, 'activity.jsonl');
  await writeFile(activityFile, JSON.stringify({ type: 'session_meta', payload: { id: 'codex-live' } }) + '\n');
  const input = path.join(root, 'fixture.jsonl');
  await writeFile(input, ['old-session', 'new-session'].map((sessionId, index) => JSON.stringify({ type: 'assistant', sessionId, requestId: 'request-' + index, timestamp: '2026-10-05T04:00:00Z', message: { id: 'message-' + index, role: 'assistant', model: 'fixture-model', content: [{ type: 'text', text: 'fixture' }], usage: { input_tokens: 10, output_tokens: 5 } } })).join('\n') + '\n');
  await syncSessionSource(root, 'claude', { complete: true, inputs: [{ path: input, kind: 'jsonl', sessionId: 'old-session' }] });
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
  ipcMain.handle('tud:api-request', async (_event, route: string, init?: { method?: string; body?: string }) => {
    const response = await api.request(route, init); return { status: response.status, body: await response.json() };
  });
  let mainWindow: BrowserWindow | null = null, notice: Notification | null = null, shown = 0, failSave = false;
  const originalShow = Notification.prototype.show;
  Notification.prototype.show = function () { notice = this; shown++; this.emit('show'); };
  const createWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed()) return;
    mainWindow = new BrowserWindow({ width: 1050, height: 750, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, preload: path.join(desktop!, 'out/preload/index.js') } });
    const created = mainWindow; created.once('ready-to-show', () => { if (!created.isDestroyed()) created.showInactive(); });
    void mainWindow.loadFile(path.join(desktop!, 'out/renderer/index.html'), { hash: '/dashboard' });
  };
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => originalHandle(channel, (event, ...args) => { if (channel === NOTIFICATIONS_SET && failSave) { failSave = false; throw Error('fixture save failure'); } return handler(event, ...args); });
  const initialized = await initializeNotifications({ getMainWindow: () => mainWindow && !mainWindow.isDestroyed() ? mainWindow : null, showQuota: () => {}, getLocale: () => 'zh-CN', activityRoots: [{ source: 'codex', path: activityFile }], showMainWindow: () => { setTimeout(createWindow, 100); } });
  ipcMain.handle = originalHandle;
  const clickNotice = async (id: string) => { await initialized.send({ id: randomUUID(), category: 'agentComplete', title: 'Fixture Agent', body: 'Navigation acceptance', target: { kind: 'session', value: { source: 'claude', sessionId: id } } }, true); assert.ok(notice); (notice as Notification).emit('click'); };
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
    await appendFile(activityFile, JSON.stringify({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'task_complete', turn_id: 'fixture-turn' } }) + '\n');
    await until(() => shown > 0, 'pet-independent live Agent completion');
    checks.push('live-codex-completion-with-no-pet-subsystem');
    await clickNotice('old-session');
    let client = await connect();
    await until(() => client.evaluate('location.hash.includes("old-session") && Boolean(document.querySelector("[data-session-heading]"))'), 'late-mounted exact session');
    assert.equal(await client.evaluate('document.querySelectorAll("[data-session-trigger]").length'), 1);
    checks.push('notification-click-before-renderer-mount-opens-old-collected-session');
    await client.key('Escape');
    await clickNotice('old-session');
    await until(() => client.evaluate('Boolean(document.querySelector("[data-session-heading]"))'), 'repeat notification reopens same row');
    checks.push('repeat-click-reopens-exact-detail');
    mainWindow!.destroy(); mainWindow = null;
    await clickNotice('old-session'); await clickNotice('new-session');
    client = await connect();
    await until(() => client.evaluate('location.hash.includes("new-session") && Boolean(document.querySelector("[data-session-heading]"))'), 'rebuilt renderer receives latest notification');
    await until(() => client.evaluate('window.tud.notifications.getNavigation().then(value=>value===null)'), 'matching navigation acknowledgement');
    checks.push('window-rebuild-and-consecutive-clicks-retain-latest-target');
    await clickNotice('not-collected');
    await until(() => client.evaluate('document.body.innerText.includes("当前采集数据中未找到该会话")'), 'missing record message');
    assert.equal(await client.evaluate('document.querySelectorAll("[data-session-trigger]").length'), 0);
    checks.push('missing-id-never-falls-back-to-a-similar-session');
    await client.screenshot(path.join(root, 'missing-session.png'));
    mainWindow!.webContents.send('app:open-settings', { tab: 'notifications' });
    await until(() => client.evaluate('document.querySelectorAll("[data-notification-settings] button[aria-haspopup=listbox]").length===6'), 'notification settings');
    const select = (index: number) => `document.querySelectorAll('[data-notification-settings] button[aria-haspopup=listbox]')[${index}]`;
    const closeMenu = async () => { if (await client.evaluate('Boolean(document.querySelector("[data-notification-settings] button[aria-haspopup=listbox][aria-expanded=true]"))')) await client.key('Escape'); };
    await client.click(select(0)); await client.key('End'); await client.key('Enter');
    await until(() => client.evaluate('window.tud.notifications.getState().then(s=>s.preferences.modes.agentComplete==="always")'), 'saved completion policy');
    await closeMenu();
    checks.push('keyboard-policy-selection-persists');
    failSave = true;
    await client.click(select(0));
    await client.click('Array.from(document.querySelectorAll("[role=option]")).find(el=>el.getBoundingClientRect().height>0&&el.innerText.trim()==="从不")');
    await until(() => client.evaluate('document.querySelector("[data-notification-settings]").innerText.includes("操作失败")'), 'nearby save failure');
    assert.equal(await client.evaluate('window.tud.notifications.getState().then(s=>s.preferences.modes.agentComplete)'), 'always');
    await closeMenu();
    checks.push('failed-write-preserves-effective-policy');
    await client.click(select(5));
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
    for (const client of clients) client.close();
    mainWindow?.destroy(); initialized.dispose(); ipcMain.removeHandler('tud:api-request');
  }
}
const deadline = setTimeout(() => app.exit(2), 110_000);
void app.whenReady().then(main).then(() => { clearTimeout(deadline); app.exit(0); }, error => { clearTimeout(deadline); console.error(error); app.exit(1); });
