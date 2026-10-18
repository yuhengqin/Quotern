import { app, BrowserWindow, ipcMain, Notification, powerMonitor } from 'electron';
import path from 'node:path';
import { QUOTA_CHANGED, QUOTA_GET, QUOTA_REFRESH, QUOTA_SET, type QuotaPreferencePatch, type QuotaState } from '../shared/quota';
import { SUBSCRIPTION_CHANNELS } from '../shared/subscription-channels';
import type { SupportedLocale } from 'quotern-i18n';
import { localizeQuotaWindowLabel } from 'quotern-i18n/quota';
import { createQuotaRuntime, type QuotaManager } from 'quotern-core/quota/runtime';
import { quotaFetch } from './quota-fetch';
import { nativeText } from './native-messages';
export { parseQuotaServiceStatus } from 'quotern-core/quota/runtime';
let activeManager: QuotaManager | null = null;
export function getQuotaRuntimeState(): QuotaState | null { return activeManager?.getState() ?? null; }

export async function initializeQuotaRuntime(options: { onChanged(state: QuotaState): void; showMainWindow(): void; getLocale(): SupportedLocale }) {
  const notifications = new Set<Notification>();
  const manager = await createQuotaRuntime({ directory: path.join(app.getPath('userData'), 'quota'), fetch: quotaFetch,
    onChanged: state => {
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
      const notification = new Notification({ title, body, silent: true });
      notifications.add(notification);
      notification.once('click', options.showMainWindow);
      notification.once('close', () => notifications.delete(notification));
      notification.once('failed', () => { notifications.delete(notification); manager.reportNotice(nativeText(options.getLocale(), 'native.quota.deliveryFailed')); });
      if (notifications.size > 64) { const oldest = notifications.values().next().value as Notification; oldest.close(); notifications.delete(oldest); }
      notification.show();
    },
  });
  activeManager = manager;
  for (const channel of [QUOTA_GET, QUOTA_REFRESH, QUOTA_SET]) ipcMain.removeHandler(channel);
  ipcMain.handle(QUOTA_GET, () => { const state = manager.getState(); void manager.refresh('interaction'); return state; });
  ipcMain.handle(QUOTA_REFRESH, (_event, id: unknown) => {
    if (id !== undefined && !SUBSCRIPTION_CHANNELS.some(channel => channel.id === id) && !manager.getState().providers.some(provider => provider.id === id)) throw new Error(nativeText(options.getLocale(), 'native.quota.unknownProvider'));
    return manager.refresh('manual', id as string | undefined);
  });
  ipcMain.handle(QUOTA_SET, (_event, patch: QuotaPreferencePatch) => manager.setPreferences(patch));
  let locked = powerMonitor.getSystemIdleState(60) === 'locked';
  let constrained = powerMonitor.isOnBatteryPower();
  const signals = () => manager.setSignals(locked, constrained);
  const lock = () => { locked = true; signals(); };
  const unlock = () => { locked = false; signals(); manager.resumed(); };
  const battery = () => { constrained = true; signals(); };
  const ac = () => { constrained = false; signals(); };
  const resume = () => { locked = powerMonitor.getSystemIdleState(60) === 'locked'; signals(); manager.resumed(); };
  const suspend = () => manager.setSignals(true, true);
  const listeners = [['lock-screen', lock], ['unlock-screen', unlock], ['on-battery', battery], ['on-ac', ac], ['resume', resume], ['suspend', suspend]] as const;
  for (const [event, listener] of listeners) (powerMonitor as NodeJS.EventEmitter).on(event, listener);
  signals();
  return {
    manager,
    start: () => { signals(); manager.start(); },
    pause: () => manager.pause(),
    dispose: () => {
      manager.dispose(); if (activeManager === manager) activeManager = null;
      for (const [event, listener] of listeners) (powerMonitor as NodeJS.EventEmitter).removeListener(event, listener);
      for (const channel of [QUOTA_GET, QUOTA_REFRESH, QUOTA_SET]) ipcMain.removeHandler(channel);
      for (const notification of notifications) notification.close(); notifications.clear();
    },
  };
}
