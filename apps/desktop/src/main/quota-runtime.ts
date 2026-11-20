import { app, BrowserWindow, globalShortcut, ipcMain, powerMonitor } from 'electron';
import { randomUUID } from 'node:crypto';
import type { DesktopNotice, NotificationDelivery } from '../shared/notifications.js';
import path from 'node:path';
import { QUOTA_CHANGED, QUOTA_GET, QUOTA_REFRESH, QUOTA_SET, type QuotaPreferencePatch, type QuotaState } from '../shared/quota';
import { SUBSCRIPTION_CHANNELS } from '../shared/subscription-channels';
import type { SupportedLocale } from 'quotern-i18n';
import { createQuotaRuntime, type QuotaManager } from 'quotern-core/quota/runtime';
import { resolveDataDir } from 'quotern-core';
import { quotaFetch, recoverQuotaNetwork } from './quota-fetch';
import { nativeText } from './native-messages';
import { createQuotaShortcut } from './quota-shortcut';
import { QUOTA_TEST_NOTIFICATION, QUOTA_SHORTCUT_GET, QUOTA_SHORTCUT_ACCELERATOR, normalizeQuotaShortcut } from '../shared/quota-desktop';
import type { QuotaNavigationTarget } from '../shared/quota-navigation';
import { quotaNotice, serviceNotice } from './notifications/quota-notices';
export { parseQuotaServiceStatus } from 'quotern-core/quota/runtime';
let activeManager: QuotaManager | null = null;
export function getQuotaRuntimeState(): QuotaState | null { return activeManager?.getState() ?? null; }
export function getQuotaBackupDirectory() { return path.join(app.getPath('userData'), 'quota'); }

export async function initializeQuotaRuntime(options: { onChanged(state: QuotaState): void; showMainWindow(): void; showQuota(target?: QuotaNavigationTarget): void; getLocale(): SupportedLocale; sendNotification(notice: DesktopNotice, test?: boolean): Promise<NotificationDelivery> }) {
  const shortcut = createQuotaShortcut({ register: (key, action) => globalShortcut.register(key, action), unregister: key => globalShortcut.unregister(key), open: options.showQuota });
  const sendNotification = (title: string, body: string, target?: QuotaNavigationTarget, category: 'quota' | 'service' = 'quota', test = false) =>
    options.sendNotification({ id: randomUUID(), category, title, body, target: { kind: 'quota', value: target } }, test);
  const manager = await createQuotaRuntime({ directory: path.join(app.getPath('userData'), 'quota'), fetch: quotaFetch,
    snapshot: { directory: resolveDataDir(), runtime: 'desktop' },
    onChanged: state => {
      shortcut.setEnabled(state.preferences.quotaShortcut === true, state.preferences.quotaShortcutAccelerator);
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(QUOTA_CHANGED, state);
      options.onChanged(state);
    },
    notify: value => {
      void options.sendNotification(quotaNotice(value, options.getLocale())).catch(() => manager.reportNotice(nativeText(options.getLocale(), 'native.quota.deliveryFailed')));
    },
    notifyService: value => {
      const selected = manager.getState().preferences.serviceComponents?.[value.provider as keyof NonNullable<QuotaState['preferences']['serviceComponents']>];
      void options.sendNotification(serviceNotice(value, options.getLocale(), selected)).catch(() => manager.reportNotice(nativeText(options.getLocale(), 'native.quota.deliveryFailed')));
    },
  });
  activeManager = manager;
  shortcut.setEnabled(manager.getState().preferences.quotaShortcut === true, manager.getState().preferences.quotaShortcutAccelerator);
  for (const channel of [QUOTA_GET, QUOTA_REFRESH, QUOTA_SET, QUOTA_TEST_NOTIFICATION, QUOTA_SHORTCUT_GET]) ipcMain.removeHandler(channel);
  ipcMain.handle(QUOTA_GET, () => { const state = manager.getState(); void manager.refresh('interaction'); return state; });
  ipcMain.handle(QUOTA_REFRESH, (_event, id: unknown) => {
    if (id !== undefined && !SUBSCRIPTION_CHANNELS.some(channel => channel.id === id) && !manager.getState().providers.some(provider => provider.id === id)) throw new Error(nativeText(options.getLocale(), 'native.quota.unknownProvider'));
    return manager.refresh('manual', id as string | undefined);
  });
  let settingsQueue = Promise.resolve();
  ipcMain.handle(QUOTA_SET, (_event, patch: QuotaPreferencePatch) => {
    const pending = settingsQueue.then(async () => {
      if (patch?.quotaShortcut === undefined && patch?.quotaShortcutAccelerator === undefined) return manager.setPreferences(patch);
      const preferences = manager.getState().preferences;
      // Disabling an unavailable shortcut must remain possible without registering it first.
      if (patch.quotaShortcut === false && patch.quotaShortcutAccelerator === undefined) {
        const state = await manager.setPreferences(patch);
        shortcut.setEnabled(false);
        return state;
      }
      const accelerator = normalizeQuotaShortcut(patch.quotaShortcutAccelerator !== undefined
        ? patch.quotaShortcutAccelerator : preferences.quotaShortcutAccelerator ?? QUOTA_SHORTCUT_ACCELERATOR);
      if (!accelerator) throw new Error('QUOTA_SHORTCUT_INVALID');
      return shortcut.save(patch.quotaShortcut ?? (preferences.quotaShortcut === true), accelerator,
        () => manager.setPreferences({ ...patch, quotaShortcutAccelerator: accelerator }));
    });
    settingsQueue = pending.then(() => {}, () => {});
    return pending;
  });
  ipcMain.handle(QUOTA_SHORTCUT_GET, () => shortcut.isRegistered());
  // A production preview is unpackaged too; only the Vite dev renderer exposes this action.
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    ipcMain.handle(QUOTA_TEST_NOTIFICATION, () => sendNotification(nativeText(options.getLocale(), 'native.quota.testTitle'), nativeText(options.getLocale(), 'native.quota.testBody'), undefined, 'quota', true).then(value => value === 'shown' ? 'shown' : 'requested'));
  }
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
    },
  };
}
