import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveDataDir } from 'quotern-core';
import type { SupportedLocale } from 'quotern-i18n';
import { notificationText } from '../../shared/notification-messages.js';
import { NOTIFICATIONS_GET, NOTIFICATIONS_SET, NOTIFICATIONS_CLEAR, NOTIFICATIONS_CHANGED, NOTIFICATIONS_TEST, NOTIFICATIONS_PREVIEW_SOUND, NOTIFICATION_NAVIGATION, NOTIFICATION_NAVIGATION_GET, NOTIFICATION_NAVIGATION_ACK, type DesktopNotice, type NotificationPreferencePatch, type NotificationSettingsState, type NotificationSound } from '../../shared/notifications.js';
import { DSH_PET_NAVIGATION, DSH_PET_NAVIGATION_GET, DSH_PET_NAVIGATION_ACK } from '../../shared/dsh-pet.js';
import type { ActivityEvent, ActivitySubscription } from '../../shared/agent-activity.js';
import type { QuotaNavigationTarget } from '../../shared/quota-navigation.js';
import { AgentActivityMonitor, type ActivityRoot } from '../agent-activity/monitor.js';
import { discoverAgentActivityRoots } from '../agent-activity/sources.js';
import { AgentHookEvents } from '../agent-activity/hook-events.js';
import { NotificationNavigation } from './navigation.js';
import { NotificationPreferencesStore } from './preferences.js';
import { NotificationManager } from './manager.js';
import { NotificationSoundPlayer } from './sound.js';
import { windowsNotificationAppId, WINDOWS_APP_USER_MODEL_ID } from '../app-identity.js';
import { createWindowsNotifications, windowsNotificationIconPath } from './windows.js';
import { isQuotaNoticeCurrent, resolveQuotaReminder } from './quota-notices.js';
import type { QuotaState } from '../../shared/quota.js';
import { summarizeNotices } from './summary.js';

export async function initializeNotifications(options: { getMainWindow(): BrowserWindow | null; showMainWindow(): void; showQuota(target?: QuotaNavigationTarget): void; getLocale(): SupportedLocale; activityRoots?: ActivityRoot[]; windowsAppId?: string; applicationDirectory?: string }) {
  const directory = path.join(app.getPath('userData'), 'notifications');
  const store = await NotificationPreferencesStore.open(path.join(directory, 'preferences.json'));
  const sound = new NotificationSoundPlayer(path.join(directory, 'sounds'));
  const navigation = new NotificationNavigation(), subscribers = new Set<(event: ActivityEvent) => void>();
  let issue: NotificationSettingsState['issue'] = null, paused = true, disposed = false, generation = 0, timer: ReturnType<typeof setInterval> | null = null;
  let integrationFailed = false;
  const state = (): NotificationSettingsState => ({ preferences: store.preferences, supported: Notification.isSupported(), pendingCount: manager?.count ?? 0, issue: store.issue ?? issue ?? (integrationFailed ? 'integration' : null) });
  const changed = () => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(NOTIFICATIONS_CHANGED, state()); };
  let manager: NotificationManager;
  let quotaState: QuotaState | null = null;
  const appId = options.windowsAppId ?? windowsNotificationAppId(process.env.QUOTERN_DEV_ISOLATED === '1' ? app.getPath('userData') : undefined);
  if (process.platform === 'win32') app.setAppUserModelId(appId);
  const applicationDirectory = options.applicationDirectory ?? app.getAppPath();
  const windows = process.platform === 'win32' ? await createWindowsNotifications({ app, appId, iconPath: windowsNotificationIconPath(app.isPackaged ? process.resourcesPath : null, applicationDirectory), temporary: appId !== WINDOWS_APP_USER_MODEL_ID, entry: process.defaultApp ? applicationDirectory : undefined, onAction: (id, action) => manager.activate(id, action) }).catch(error => { integrationFailed = true; console.warn('[quotern] notification integration unavailable:', error); return null; }) : null;
  manager = new NotificationManager({
    batch: { delayMs: 1000, summarize: notices => summarizeNotices(notices, options.getLocale()) },
    onChange: changed,
    retainAfterClose: process.platform === 'win32',
    preferences: () => store.preferences, isSupported: () => Notification.isSupported(), isFocused: () => !!BrowserWindow.getFocusedWindow(),
    create: (value, notice) => {
      const native = new Notification({ ...value, ...(windows ? { toastXml: windows.toast(notice, value, options.getLocale()) } : {}), ...(process.platform === 'darwin' ? { actions: notice.actions?.map(action => ({ type: 'button' as const, text: notificationText(options.getLocale(), action === 'dismiss-all' ? 'dismissAll' : action) })) } : {}) });
      return Object.assign(native, { handlesActivation: !!windows });
    }, sound: (value, current) => sound.play(value, current),
    onIssue: value => { issue = value; changed(); },
    resolveNotice: notice => quotaState ? resolveQuotaReminder(notice, quotaState, options.getLocale()) : notice,
    onClick: notice => {
      if (notice.target?.kind === 'quota') { options.showQuota(notice.target.value); return; }
      if (notice.target?.kind === 'session') navigation.open(notice.target.value);
      options.showMainWindow();
      const window = options.getMainWindow();
      if (window && !window.isDestroyed()) { window.webContents.send(NOTIFICATION_NAVIGATION); window.webContents.send(DSH_PET_NAVIGATION); }
      if (notice.sessionKey) manager.dismiss(value => value.sessionKey === notice.sessionKey);
    },
  });
  const send = (notice: DesktopNotice, test = false) => disposed || paused && !test ? Promise.resolve('suppressed' as const) : manager.send(notice, test);
  // Agent events remain available to pets, independently of native notifications.
  const receive = (event: ActivityEvent) => { if (paused || disposed) return; for (const listener of subscribers) { try { listener(event); } catch { /* One observer cannot stop delivery to others. */ } } };
  const monitor = new AgentActivityMonitor({ roots: options.activityRoots ?? discoverAgentActivityRoots, onEvent: receive });
  const hooks = new AgentHookEvents({ directory: path.join(resolveDataDir(), 'integrations/notification-events'), onEvent: receive });
  const activity: ActivitySubscription = { subscribe: listener => { subscribers.add(listener); return () => subscribers.delete(listener); }, capabilities: () => monitor.capabilities() };
  const trusted = (event: Electron.IpcMainInvokeEvent) => { const window = options.getMainWindow(); if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Notification sender rejected'); };
  const handlers = [NOTIFICATIONS_GET, NOTIFICATIONS_SET, NOTIFICATIONS_CLEAR, NOTIFICATIONS_TEST, NOTIFICATIONS_PREVIEW_SOUND, NOTIFICATION_NAVIGATION_GET, NOTIFICATION_NAVIGATION_ACK, DSH_PET_NAVIGATION_GET, DSH_PET_NAVIGATION_ACK];
  ipcMain.handle(NOTIFICATIONS_GET, event => { trusted(event); return state(); });
  ipcMain.handle(NOTIFICATIONS_CLEAR, event => { trusted(event); manager.clear(); return state(); });
  ipcMain.handle(NOTIFICATIONS_SET, async (event, patch: NotificationPreferencePatch) => { trusted(event); await store.set(patch); issue = null; manager.reconcile(); changed(); return state(); });
  ipcMain.handle(NOTIFICATIONS_TEST, event => {
    trusted(event); issue = null; changed();
    return send({ id: randomUUID(), category: 'quota', title: notificationText(options.getLocale(), 'testTitle'), body: notificationText(options.getLocale(), 'testBody') }, true);
  });
  ipcMain.handle(NOTIFICATIONS_PREVIEW_SOUND, async (event, value: NotificationSound) => {
    trusted(event); if (!['none', 'soft', 'bell'].includes(value)) throw new Error('Invalid notification sound');
    try { await sound.play(value, () => !disposed, true); if (issue === 'sound') { issue = null; changed(); } }
    catch (error) { issue = 'sound'; changed(); throw error; }
  });
  for (const channel of [NOTIFICATION_NAVIGATION_GET, DSH_PET_NAVIGATION_GET]) ipcMain.handle(channel, event => { trusted(event); return navigation.peek(); });
  for (const channel of [NOTIFICATION_NAVIGATION_ACK, DSH_PET_NAVIGATION_ACK]) ipcMain.handle(channel, (event, id: unknown) => { trusted(event); if (typeof id === 'string') navigation.acknowledge(id); });
  const focus = () => manager.reconcile(); app.on('browser-window-focus', focus);
  return {
    activity, send,
    reconcileQuota(state: QuotaState) { quotaState = state; manager.dismiss(notice => !isQuotaNoticeCurrent(notice, state)); },
    async start() {
      if (disposed || !paused) return;
      paused = false;
      const started = ++generation;
      await Promise.all([monitor.start(), hooks.start()]);
      if (started !== generation) return;
      if (disposed || paused) { monitor.dispose(); hooks.dispose(); return; }
      timer = setInterval(() => { void hooks.poll().catch(() => {}); }, 1000); timer.unref();
    },
    pause() { paused = true; generation++; if (timer) clearInterval(timer); timer = null; monitor.dispose(); hooks.dispose(); manager.dismiss(() => true); sound.stop(); },
    dispose() { this.pause(); disposed = true; manager.dispose(); windows?.dispose(); sound.dispose(); subscribers.clear(); app.removeListener('browser-window-focus', focus); for (const channel of handlers) ipcMain.removeHandler(channel); },
  };
}
