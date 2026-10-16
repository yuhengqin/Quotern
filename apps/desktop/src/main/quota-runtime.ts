import { app, BrowserWindow, ipcMain, Notification, powerMonitor } from 'electron';
import path from 'node:path';
import { QUOTA_CHANGED, QUOTA_GET, QUOTA_REFRESH, QUOTA_SET, type QuotaPreferencePatch, type QuotaState } from '../shared/quota';
import { SUBSCRIPTION_CHANNELS } from '../shared/subscription-channels';
import { createQuotaRuntime, type QuotaManager } from 'quotern-core/quota/runtime';
import { quotaFetch } from './quota-fetch';
export { parseQuotaServiceStatus } from 'quotern-core/quota/runtime';
let activeManager: QuotaManager | null = null;
export function getQuotaRuntimeState(): QuotaState | null { return activeManager?.getState() ?? null; }

export async function initializeQuotaRuntime(options: { onChanged(state: QuotaState): void; showMainWindow(): void }) {
  const notifications = new Set<Notification>();
  const manager = await createQuotaRuntime({ directory: path.join(app.getPath('userData'), 'quota'), fetch: quotaFetch,
    onChanged: state => {
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(QUOTA_CHANGED, state);
      options.onChanged(state);
    },
    notify: value => {
      if (!Notification.isSupported()) throw new Error('notifications unavailable');
      const reset = value.resetsAt ? new Date(value.resetsAt * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
      const title = value.kind === 'reset' ? `${value.label} ${value.window} 额度已恢复` : `${value.label} ${value.window} 已用 ${value.kind === 'threshold-90' ? '90' : '70'}%`;
      const notification = new Notification({ title, body: `${value.kind === 'reset' ? `当前剩余 ${Math.round(100 - value.usedPercent)}%` : '留意后续使用量'}${reset ? `，${reset} 重置` : ''}`, silent: true });
      notifications.add(notification);
      notification.once('click', options.showMainWindow);
      notification.once('close', () => notifications.delete(notification));
      notification.once('failed', () => { notifications.delete(notification); manager.reportNotice('系统通知未能送达，请检查系统通知权限；额度卡片仍可查看。'); });
      if (notifications.size > 64) { const oldest = notifications.values().next().value as Notification; oldest.close(); notifications.delete(oldest); }
      notification.show();
    },
  });
  activeManager = manager;
  for (const channel of [QUOTA_GET, QUOTA_REFRESH, QUOTA_SET]) ipcMain.removeHandler(channel);
  ipcMain.handle(QUOTA_GET, () => { const state = manager.getState(); void manager.refresh('interaction'); return state; });
  ipcMain.handle(QUOTA_REFRESH, (_event, id: unknown) => {
    if (id !== undefined && !SUBSCRIPTION_CHANNELS.some(channel => channel.id === id) && !manager.getState().providers.some(provider => provider.id === id)) throw new Error('未知额度来源');
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
