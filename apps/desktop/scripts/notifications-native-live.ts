// Opt-in Windows acceptance harness. Uses real OS notifications; never synthesizes
// show/click/close events. Provider runs use its private Agent config directories.
import assert from 'node:assert/strict';
import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import { mkdir, readFile, readdir, writeFile, appendFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { createLocalApiApp } from '../../../packages/core/src/server/local-api';
import { BucketStore } from '../../../packages/core/src/server/state';
import { syncSessionSource } from '../../../packages/core/src/session-collector';
import { patchAgentPreferences } from '../../../packages/core/src/agent/preferences';
import { setIntegrationInstalled } from '../../../packages/core/src/agent/install';
import { initializeNotifications } from '../src/main/notifications/runtime';
import { configureQuoternAppIdentity } from '../src/main/app-identity';
import { NotificationSoundPlayer } from '../src/main/notifications/sound';
import { DEFAULT_NOTIFICATION_PREFERENCES, type DesktopNotice } from '../src/shared/notifications';
import { DEFAULT_QUOTA_PREFERENCES } from '../src/shared/quota';
import type { ActivityRoot } from '../src/main/agent-activity/monitor';
import type { TudConfig } from '../../../packages/core/src/types';
import { serviceNotice, quotaNotice } from '../src/main/notifications/quota-notices';
import { NotificationManager } from '../src/main/notifications/manager';

const [desktop, output, debugPort] = process.argv.slice(2);
assert.ok(desktop && output && debugPort);
const root = path.resolve(output!), data = path.join(root, 'data');
assert.equal(existsSync(root), false, 'Use a fresh native acceptance directory');
mkdirSync(path.join(root, 'profile'), { recursive: true });
const codexHome = path.join(data, 'agents/codex'), claudeHome = path.join(data, 'agents/claude');
process.env.QUOTERN_DEV_ISOLATED = '1';
process.env.QUOTERN_DATA_DIR = data;
process.env.QUOTERN_CONFIG_HOME = path.join(root, 'config-home');
configureQuoternAppIdentity(app);
if (process.env.QUOTERN_NATIVE_APP_ID) app.setAppUserModelId(process.env.QUOTERN_NATIVE_APP_ID);
app.commandLine.appendSwitch('remote-debugging-port', debugPort!);
app.on('window-all-closed', () => {});

const records: unknown[] = [];
let writes = Promise.resolve();
function record(event: string, detail: Record<string, unknown> = {}) {
  const row = { at: new Date().toISOString(), event, ...detail }; records.push(row);
  writes = writes.then(() => appendFile(path.join(root, 'events.jsonl'), JSON.stringify(row) + '\n')).catch(() => {});
}
async function json(file: string, value: unknown) { const temporary = file + '.tmp'; await writeFile(temporary, JSON.stringify(value, null, 2)); await rename(temporary, file); }
async function files(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(file)); else if (entry.isFile() && file.endsWith('.jsonl')) result.push(file);
  }
  return result;
}
async function sources(): Promise<ActivityRoot[]> {
  return [...(await files(path.join(codexHome, 'sessions'))).map(file => ({ source: 'codex', path: file })), ...(await files(path.join(claudeHome, 'projects'))).map(file => ({ source: 'claude', path: file }))];
}

async function main() {
  await mkdir(path.join(root, 'profile/notifications'), { recursive: true });
  await mkdir(path.join(root, 'project'), { recursive: true });
  await mkdir(codexHome, { recursive: true }); await mkdir(claudeHome, { recursive: true });
  await writeFile(path.join(root, 'profile/notifications/preferences.json'), JSON.stringify({ version: 1, ...DEFAULT_NOTIFICATION_PREFERENCES, sound: 'none', modes: Object.fromEntries(Object.keys(DEFAULT_NOTIFICATION_PREFERENCES.modes).map(key => [key, 'always'])) }));
  await patchAgentPreferences(data, { desktopNotifications: true });
  await setIntegrationInstalled(data, 'codex', true, { directory: codexHome });
  await setIntegrationInstalled(data, 'claude', true, { directory: claudeHome });
  const fixture = path.join(root, 'fixture.jsonl');
  await writeFile(fixture, JSON.stringify({ type: 'assistant', sessionId: 'native-navigation-fixture', timestamp: new Date().toISOString(), requestId: 'fixture-request', message: { id: 'fixture-message', role: 'assistant', model: 'acceptance-fixture', content: [{ type: 'text', text: 'Native notification navigation acceptance.' }], usage: { input_tokens: 1, output_tokens: 1 } } }) + '\n');
  await syncSessionSource(data, 'claude', { complete: true, inputs: [{ path: fixture, kind: 'jsonl' }] });
  const api = createLocalApiApp({ dataDir: data, bucketStore: new BucketStore(), getConfig: () => ({ statsSince: '2026-01-01T00:00:00Z', localCollectSince: '2026-01-01T00:00:00Z' } as TudConfig) });
  for (const [channel, value] of Object.entries({ 'locale:get': { preference: 'zh-CN', resolved: 'zh-CN', systemLocale: 'zh-CN' }, 'theme:get': { mode: 'light', resolved: 'light' }, 'auto-update:get-state': { status: 'unsupported', currentVersion: 'native-acceptance' }, 'dashboard-range:get': 'last-7-days', 'quota:get': { providers: [], preferences: DEFAULT_QUOTA_PREFERENCES, notice: null }, 'quota:navigation:get': null })) ipcMain.handle(channel, () => value);
  for (const channel of ['dashboard-range:set', 'quota:navigation:ack', 'quota:dialog-state']) ipcMain.handle(channel, () => {});
  ipcMain.handle('tud:api-request', async (_event, route: string, init?: { method?: string; body?: string }) => { const response = await api.request(route, init); return { status: response.status, body: await response.json() }; });
  let mainWindow: BrowserWindow | null = null;
  const showMainWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = new BrowserWindow({ width: 1050, height: 760, show: false, title: 'Quotern 通知实测', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, preload: path.join(desktop!, 'out/preload/index.js') } });
      mainWindow.on('page-title-updated', event => event.preventDefault());
      mainWindow.once('ready-to-show', () => { mainWindow?.show(); mainWindow?.focus(); });
      mainWindow.webContents.on('did-navigate-in-page', (_event, url) => record('navigation', { hash: new URL(url).hash }));
      void mainWindow.loadFile(path.join(desktop!, 'out/renderer/index.html'), { hash: '/dashboard' });
    } else { mainWindow.show(); mainWindow.focus(); }
    record('main-window-opened');
  };
  let collecting: Promise<unknown> | null = null, collectAgain = false;
  const collect = (): Promise<unknown> => {
    if (collecting) { collectAgain = true; return collecting; }
    collecting = (async () => {
      let roots: ActivityRoot[] = [];
      do {
        collectAgain = false; roots = await sources();
        for (const source of ['codex', 'claude'] as const) await syncSessionSource(data, source, { complete: true, inputs: [...roots.filter(value => value.source === source).map(value => ({ path: value.path, kind: 'jsonl' as const })), ...(source === 'claude' ? [{ path: fixture, kind: 'jsonl' as const }] : [])] });
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tud:data-synced');
      } while (collectAgain);
      return roots.map(value => ({ source: value.source, path: path.relative(root, value.path) }));
    })().finally(() => { collecting = null; });
    return collecting;
  };
  const nativeShow = Notification.prototype.show, nativeClose = Notification.prototype.close;
  const activate = NotificationManager.prototype.activate;
  NotificationManager.prototype.activate = function (id, action) { const handled = activate.call(this, id, action); record('notice-action', { id, action, handled }); return handled; };
  let sequence = 0;
  const ids = new WeakMap<Notification, number>();
  Notification.prototype.show = function () {
    const id = ++sequence; ids.set(this, id);
    record('native-send', { id, title: this.title, body: this.body, silent: this.silent, toastXml: this.toastXml });
    for (const event of ['show', 'click', 'close', 'failed'] as const) this.on(event as any, (...args: unknown[]) => record(`native-${event}`, { id, ...(event === 'failed' ? { error: String(args.at(-1)) } : {}) }));
    return nativeShow.call(this);
  };
  Notification.prototype.close = function () { record('native-retract-request', { id: ids.get(this) }); return nativeClose.call(this); };
  const play = NotificationSoundPlayer.prototype.play;
  NotificationSoundPlayer.prototype.play = async function (...args) {
    record('sound-start', { sound: args[0] });
    try { await play.apply(this, args); record('sound-complete', { sound: args[0] }); }
    catch (error) { record('sound-failed', { error: String(error) }); throw error; }
  };
  const runtime = await initializeNotifications({ getMainWindow: () => mainWindow, showMainWindow, showQuota: target => { record('quota-opened', { target }); showMainWindow(); }, getLocale: () => 'zh-CN', activityRoots: sources, windowsAppId: process.env.QUOTERN_NATIVE_APP_ID, applicationDirectory: desktop });
  runtime.activity.subscribe(event => {
    record('activity', { source: event.source, sessionId: event.sessionId, notice: event.notice, evidence: event.evidence, requestId: event.requestId, resolvedRequestId: event.resolvedRequestId });
    void collect().catch(error => record('collection-failed', { error: String(error) }));
  });
  await runtime.start();
  const collector = setInterval(() => { void collect().catch(error => record('collection-failed', { error: String(error) })); }, 2000);
  let processing = false, lastCommand = '';
  const poll = setInterval(() => { if (processing) return; processing = true; void (async () => {
    let command: Record<string, any>;
    try { command = JSON.parse(await readFile(path.join(root, 'command.json'), 'utf8')); } catch { return; }
    if (!command.id || command.id === lastCommand) return; lastCommand = command.id;
    try {
      let result: unknown = null;
      if (command.action === 'send') {
        const category = command.category ?? 'service';
        if (!['quota', 'service'].includes(category)) throw new Error('Unsupported acceptance notification category');
        const value: DesktopNotice = category === 'quota' ? quotaNotice({ provider: 'codex', providerId: 'codex', accountRef: 'a'.repeat(64), label: 'Codex · 通知验收', window: '5h', windowId: 'five-hour', windowLabel: '5h', windowPeriodSeconds: 18000, kind: command.kind ?? 'threshold-90', resetsAt: Math.floor(Date.now() / 1000) + 7200, usedPercent: command.usedPercent ?? 95 }, 'zh-CN') : serviceNotice({ provider: 'claude', label: 'Claude', level: command.level ?? 'major', url: 'https://status.claude.com/', components: [{ id: 'api', name: 'Claude API', level: 'major' }], incidents: [{ id: 'acceptance', name: 'API 请求失败率上升（验收数据）', phase: 'identified', level: 'major', componentIds: ['api'], body: '服务正在修复中。', updatedAt: Date.now() / 1000, url: 'https://status.claude.com/' }] }, 'zh-CN');
        if (command.title) value.title = command.title;
        if (command.expiresInMs) value.expiresAt = Date.now() + command.expiresInMs;
        result = await runtime.send(value, true);
      } else if (command.action === 'show') showMainWindow();
      else if (command.action === 'reconcile') runtime.reconcileQuota(command.state);
      else if (command.action === 'hide') mainWindow?.hide();
      else if (command.action === 'destroy') { mainWindow?.destroy(); mainWindow = null; }
      else if (command.action === 'pause') runtime.pause();
      else if (command.action === 'resume') await runtime.start();
      else if (command.action === 'sync') {
        result = await collect();
      } else if (command.action === 'quit') { await json(path.join(root, 'reply.json'), { id: command.id, ok: true }); app.quit(); return; }
      else if (command.action !== 'ping') throw Error('Unknown acceptance command');
      await json(path.join(root, 'reply.json'), { id: command.id, ok: true, result });
    } catch (error) { await json(path.join(root, 'reply.json'), { id: command.id, ok: false, error: String(error) }); }
  })().finally(() => { processing = false; }); }, 200);
  app.once('before-quit', () => { clearInterval(poll); clearInterval(collector); runtime.dispose(); Notification.prototype.show = nativeShow; Notification.prototype.close = nativeClose; NotificationManager.prototype.activate = activate; NotificationSoundPlayer.prototype.play = play; });
  await json(path.join(root, 'ready.json'), { pid: process.pid, root, data, codexHome, claudeHome, project: path.join(root, 'project'), supported: Notification.isSupported(), debugPort, appId: process.env.QUOTERN_NATIVE_APP_ID, retractionTest: process.env.QUOTERN_NATIVE_RETRACTION_TEST === '1' });
  record('ready', { supported: Notification.isSupported() });
}
const deadline = setTimeout(() => app.quit(), 45 * 60_000); deadline.unref();
void app.whenReady().then(main).catch(error => { console.error(error); app.exit(1); });
