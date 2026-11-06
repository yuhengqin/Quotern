import { app, BrowserWindow, globalShortcut, ipcMain, Notification, powerMonitor } from 'electron';
import path from 'node:path';
import { QUOTA_CHANGED, QUOTA_GET, QUOTA_REFRESH, QUOTA_SET, type QuotaPreferencePatch, type QuotaState } from '../shared/quota';
import { SUBSCRIPTION_CHANNELS } from '../shared/subscription-channels';
import type { SupportedLocale } from 'quotern-i18n';
import { localizeQuotaWindowLabel } from 'quotern-i18n/quota';
import { createQuotaRuntime, type QuotaManager } from 'quotern-core/quota/runtime';
import { resolveDataDir } from 'quotern-core';
import { quotaFetch, recoverQuotaNetwork } from './quota-fetch';
import { nativeText } from './native-messages';
import { createQuotaShortcut } from './quota-shortcut';
import { QUOTA_TEST_NOTIFICATION, QUOTA_SHORTCUT_GET } from '../shared/quota-desktop';
export { parseQuotaServiceStatus } from 'quotern-core/quota/runtime';
let activeManager: QuotaManager | null = null;
export function getQuotaRuntimeState(): QuotaState | null { return activeManager?.getState() ?? null; }

export async function initializeQuotaRuntime(options: { onChanged(state: QuotaState): void; showMainWindow(): void; showQuota(): void; getLocale(): SupportedLocale }) {
  const notifications = new Set<Notification>();
  const shortcut = createQuotaShortcut({ register: (key, action) => globalShortcut.register(key, action), unregister: key => globalShortcut.unregister(key), open: options.showQuota });
  const sendNotification = (title: string, body: string) => new Promise<'shown' | 'requested'>((resolve, reject) => {
    if (!Notification.isSupported()) { reject(new Error('notifications unavailable')); return; }
    const notification = new Notification({ title, body, silent: true });
    notifications.add(notification);
    const timeout = setTimeout(() => resolve('requested'), 5000);
    timeout.unref?.();
    notification.once('show', () => { clearTimeout(timeout); resolve('shown'); });
    notification.once('click', options.showQuota);
    notification.once('close', () => { clearTimeout(timeout); notifications.delete(notification); resolve('requested'); });
    notification.once('failed', () => {
      clearTimeout(timeout); notifications.delete(notification);
      manager.reportNotice(nativeText(options.getLocale(), 'native.quota.deliveryFailed'));
      reject(new Error('notification failed'));
    });
    if (notifications.size > 64) { const oldest = notifications.values().next().value!; oldest.close(); notifications.delete(oldest); }
    notification.show();
  });
  const manager = await createQuotaRuntime({ directory: path.join(app.getPath('userData'), 'quota'), fetch: quotaFetch,
    snapshot: { directory: resolveDataDir(), runtime: 'desktop' },
    onChanged: state => {
      shortcut.setEnabled(state.preferences.quotaShortcut === true);
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(QUOTA_CHANGED, state);
      options.onChanged(state);
    },
    notify: value => {
      if (!Notification.isSupported()) throw new Error('notifications unavailable');
      const locale = options.getLocale();
      const reset = value.resetsAt ? new Date(value.resetsAt * 1000).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
      const vars = { provider: value.label, window: localizeQuotaWindowLabel(locale, value.provider, {
        id: value.windowId, label: value.windowLabel, groupLabel: value.windowGroupLabel, periodSeconds: value.windowPeriodSeconds,
      }), percent: value.kind === 'reset'
        ? Math.round(100 - value.usedPercent) : value.kind === 'threshold-90' ? 90 : 70 };
      const title = nativeText(locale, value.kind === 'reset' ? 'native.quota.resetTitle' : 'native.quota.thresholdTitle', vars);
      const body = nativeText(locale, value.kind === 'reset' ? 'native.quota.resetBody' : 'native.quota.thresholdBody', vars)
        + (reset ? nativeText(locale, 'native.quota.resetsAt', { time: reset }) : '');
      void sendNotification(title, body).catch(() => manager.reportNotice(nativeText(options.getLocale(), 'native.quota.deliveryFailed')));
    },
    notifyService: value => {
      const locale = options.getLocale(), recovered = value.level === 'operational';
      void sendNotification(nativeText(locale, recovered ? 'native.quota.serviceRestored' : 'native.quota.serviceIssue', { provider: value.label }),
        nativeText(locale, 'native.quota.serviceBody')).catch(() => manager.reportNotice(nativeText(locale, 'native.quota.deliveryFailed')));
    },
  });
  activeManager = manager;
  shortcut.setEnabled(manager.getState().preferences.quotaShortcut === true);
  for (const channel of [QUOTA_GET, QUOTA_REFRESH, QUOTA_SET, QUOTA_TEST_NOTIFICATION, QUOTA_SHORTCUT_GET]) ipcMain.removeHandler(channel);
  ipcMain.handle(QUOTA_GET, () => { const state = manager.getState(); void manager.refresh('interaction'); return state; });
  ipcMain.handle(QUOTA_REFRESH, (_event, id: unknown) => {
    if (id !== undefined && !SUBSCRIPTION_CHANNELS.some(channel => channel.id === id) && !manager.getState().providers.some(provider => provider.id === id)) throw new Error(nativeText(options.getLocale(), 'native.quota.unknownProvider'));
    return manager.refresh('manual', id as string | undefined);
  });
  let settingsQueue = Promise.resolve();
  ipcMain.handle(QUOTA_SET, (_event, patch: QuotaPreferencePatch) => {
    const pending = settingsQueue.then(async () => {
      const wasEnabled = manager.getState().preferences.quotaShortcut === true;
      if (patch?.quotaShortcut === true && !shortcut.setEnabled(true)) throw new Error('QUOTA_SHORTCUT_UNAVAILABLE');
      try { return await manager.setPreferences(patch); }
      catch (error) { shortcut.setEnabled(wasEnabled); throw error; }
    });
    settingsQueue = pending.then(() => {}, () => {});
    return pending;
  });
  ipcMain.handle(QUOTA_SHORTCUT_GET, () => shortcut.isRegistered());
  ipcMain.handle(QUOTA_TEST_NOTIFICATION, () => sendNotification(nativeText(options.getLocale(), 'native.quota.testTitle'), nativeText(options.getLocale(), 'native.quota.testBody')));
  let locked = powerMonitor.getSystemIdleState(60) === 'locked';
  let constrained = powerMonitor.isOnBatteryPower();
  const signals = () => manager.setSignals(locked, constrained);
  const lock = () => { locked = true; signals(); };
  let disposed = false;
  const recoverNetwork = () => {
    void recoverQuotaNetwork().catch(() => {
      console.warn('[quotern] quota network recovery failed; the next read will retry');
    }).finally(() => { if (!disposed) manager.resumed(); });
  };
  const unlock = () => { locked = false; signals(); recoverNetwork(); };
  const battery = () => { constrained = true; signals(); };
  const ac = () => { constrained = false; signals(); };
  const resume = () => { locked = powerMonitor.getSystemIdleState(60) === 'locked'; signals(); recoverNetwork(); };
  const suspend = () => manager.setSignals(true, true);
  const listeners = [['lock-screen', lock], ['unlock-screen', unlock], ['on-battery', battery], ['on-ac', ac], ['resume', resume], ['suspend', suspend]] as const;
  for (const [event, listener] of listeners) (powerMonitor as NodeJS.EventEmitter).on(event, listener);
  signals();
  return {
    manager,
    start: () => { signals(); manager.start(); },
    pause: () => manager.pause(),
    dispose: () => {
      disposed = true;
      shortcut.dispose();
      manager.dispose(); if (activeManager === manager) activeManager = null;
      for (const [event, listener] of listeners) (powerMonitor as NodeJS.EventEmitter).removeListener(event, listener);
      for (const channel of [QUOTA_GET, QUOTA_REFRESH, QUOTA_SET, QUOTA_TEST_NOTIFICATION, QUOTA_SHORTCUT_GET]) ipcMain.removeHandler(channel);
      for (const notification of notifications) notification.close(); notifications.clear();
    },
  };
}
