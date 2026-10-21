// Real Desktop preload, React routes and Notification click handlers, with private fixture data.
// OS toast delivery is intentionally excluded: show() captures the real Notification object.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import { createLocalApiApp } from '../../../packages/core/src/server/local-api';
import { BucketStore } from '../../../packages/core/src/server/state';
import { syncSessionSource } from '../../../packages/core/src/session-collector';
import type { TudConfig } from '../../../packages/core/src/types';
import { initializeDshPet } from '../src/main/dsh-pet/index';
import type { SessionNavigationTarget } from '../src/shared/dsh-pet';
// @ts-ignore opt-in JS acceptance driver
import { connectPage, wait } from './desktop-cdp.mjs';

const [desktop, output, portArg] = process.argv.slice(2);
assert.ok(desktop && output && portArg);
const port = Number(portArg); assert.ok(Number.isInteger(port) && port > 0);
const root = path.resolve(output!);
assert.equal(existsSync(root), false, 'use fresh navigation acceptance data');
app.setPath('userData', path.join(root, 'profile'));
app.on('window-all-closed', () => {});
app.commandLine.appendSwitch('remote-debugging-port', String(port));

async function main() {
  await mkdir(root, { recursive: true });
  const input = path.join(root, 'fixture.jsonl');
  await writeFile(input, ['old-session', 'new-session'].map((sessionId, index) => JSON.stringify({ type: 'assistant', sessionId, requestId: 'request-' + index, timestamp: '2026-10-05T04:00:00Z', message: { id: 'message-' + index, role: 'assistant', model: 'fixture-model', content: [{ type: 'text', text: 'fixture' }], usage: { input_tokens: 10, output_tokens: 5 } } })).join('\n') + '\n');
  await syncSessionSource(root, 'claude', { complete: true, inputs: [{ path: input, kind: 'jsonl', sessionId: 'old-session' }] });
  const api = createLocalApiApp({ dataDir: root, bucketStore: new BucketStore(), getConfig: () => ({ statsSince: '2026-01-01T00:00:00Z', localCollectSince: '2026-01-01T00:00:00Z' } as TudConfig) });
  ipcMain.handle('locale:get', () => ({ preference: 'zh-CN', resolved: 'zh-CN', systemLocale: 'zh-CN' }));
  ipcMain.handle('theme:get', () => ({ mode: 'light', resolved: 'light' }));
  ipcMain.handle('auto-update:get-state', () => ({ status: 'unsupported', currentVersion: 'fixture' }));
  ipcMain.handle('dashboard-range:get', () => 'last-7-days');
  ipcMain.handle('dashboard-range:set', (_event, value) => value);
  ipcMain.handle('tud:api-request', async (_event, route: string, init?: { method?: string; body?: string }) => {
    const response = await api.request(route, init); return { status: response.status, body: await response.json() };
  });
  let mainWindow: BrowserWindow | null = null, notice: Notification | null = null;
  const originalShow = Notification.prototype.show;
  Notification.prototype.show = function () { notice = this; };
  const createWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed()) return;
    mainWindow = new BrowserWindow({ width: 1050, height: 750, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, preload: path.join(desktop!, 'out/preload/index.js') } });
    void mainWindow.loadFile(path.join(desktop!, 'out/renderer/index.html'), { hash: '/dashboard' });
  };
  const initialized = await initializeDshPet({ getMainWindow: () => mainWindow && !mainWindow.isDestroyed() ? mainWindow : null, getQuota: () => null, refreshQuota: async () => {}, showMainWindow: () => { setTimeout(createWindow, 100); } });
  // Invoke the production notification factory without starting collectors or model/background work.
  const notify = Reflect.get(initialized.controller, 'options').notify as (title: string, body: string, target?: SessionNavigationTarget) => void;
  const clickNotice = (id: string) => { notify('Fixture Agent', 'Navigation acceptance', { source: 'claude', sessionId: id }); assert.ok(notice); (notice as Notification).emit('click'); };
  const clients: Array<{ close(): void }> = [], checks: string[] = [];
  const until = async (predicate: () => boolean | Promise<boolean>, label: string) => {
    for (let i = 0; i < 200; i++) { if (await predicate()) return; await wait(100); } throw Error('Timed out: ' + label);
  };
  const connect = async () => {
    let target;
    await until(async () => { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((value: { type: string }) => value.type === 'page'); return Boolean(target); } catch { return false; } }, 'main renderer');
    const client = await connectPage(target); clients.push(client); return client;
  };
  try {
    clickNotice('old-session');
    let client = await connect();
    await until(() => client.evaluate('location.hash.includes("old-session") && Boolean(document.querySelector("details[open]"))'), 'late-mounted exact session');
    assert.equal(await client.evaluate('document.querySelector("details[open]").innerText.includes("old-session")'), true);
    assert.equal(await client.evaluate('document.querySelectorAll("details.group").length'), 1);
    checks.push('notification-click-before-renderer-mount-opens-old-collected-session');
    await client.evaluate('document.querySelector("details[open]").open=false; true');
    clickNotice('old-session');
    await until(() => client.evaluate('Boolean(document.querySelector("details[open]"))'), 'repeat notification reopens same row');
    checks.push('repeat-click-reopens-exact-detail');
    mainWindow!.destroy(); mainWindow = null;
    clickNotice('old-session'); clickNotice('new-session');
    client = await connect();
    await until(() => client.evaluate('location.hash.includes("new-session") && Boolean(document.querySelector("details[open]"))'), 'rebuilt renderer receives latest notification');
    assert.equal(await client.evaluate('document.querySelector("details[open]").innerText.includes("new-session")'), true);
    await until(() => client.evaluate('window.tud.dshPet.getNavigation().then(value=>value===null)'), 'matching navigation acknowledgement');
    checks.push('window-rebuild-and-consecutive-clicks-retain-latest-target');
    clickNotice('not-collected');
    await until(() => client.evaluate('document.body.innerText.includes("当前采集数据中未找到该会话")'), 'missing record message');
    assert.equal(await client.evaluate('document.querySelectorAll("details.group").length'), 0);
    checks.push('missing-id-never-falls-back-to-a-similar-session');
    await client.screenshot(path.join(root, 'missing-session.png'));
    console.log(JSON.stringify({ ok: true, checks }));
    await writeFile(path.join(root, 'result.json'), JSON.stringify({ ok: true, checks }, null, 2));
  } finally {
    Notification.prototype.show = originalShow;
    for (const client of clients) client.close();
    mainWindow?.destroy(); await initialized.dispose(); ipcMain.removeHandler('tud:api-request');
  }
}
const deadline = setTimeout(() => app.exit(2), 75_000);
void app.whenReady().then(main).then(() => { clearTimeout(deadline); app.exit(0); }, error => { clearTimeout(deadline); console.error(error); app.exit(1); });
