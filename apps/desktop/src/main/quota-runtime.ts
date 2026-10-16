import { app, BrowserWindow, ipcMain, net, Notification, powerMonitor } from 'electron';
import path from 'node:path';
import { QUOTA_CHANGED, QUOTA_GET, QUOTA_REFRESH, QUOTA_SET, type QuotaPreferencePatch, type QuotaServiceStatus, type QuotaState } from '../shared/quota';
import { SUBSCRIPTION_CHANNELS } from '../shared/subscription-channels';
import { QuotaManager, type QuotaReader } from './quota-manager';
import { openQuotaStore } from './quota-store';
import { captureQuotaRead } from './quota-fetch-state';
import { readCodexSubscription } from './codex-subscription';
import { readClaudeSubscription } from './claude-subscription';
import { readCursorSubscription } from './cursor-subscription';
import { readCopilotSubscription } from './copilot-subscription';
import { readGrokSubscription } from './grok-subscription';
import { readKimiSubscriptions } from './kimi-subscription';
import { readZcodeSubscription } from './zcode-subscription';
import { readAntigravitySubscription } from './antigravity-subscription';
import { readQoderSubscription } from './qoder-subscription';
import { readMiniMaxSubscription } from './minimax-subscription';
import { readDeepSeekSubscription } from './deepseek-subscription';
import { readOpenCodeSubscription } from './opencode-subscription';
import { selectKimiSubscription } from '../shared/kimi-selection';

const STATUS_URLS: Record<string, string> = { codex: 'https://status.openai.com/', claude: 'https://status.claude.com/', cursor: 'https://status.cursor.com/', copilot: 'https://www.githubstatus.com/' };
export function parseQuotaServiceStatus(value: unknown): QuotaServiceStatus['level'] {
  const indicator = (value as { status?: { indicator?: unknown } } | null)?.status?.indicator;
  const levels: Record<string, QuotaServiceStatus['level']> = { none: 'operational', minor: 'minor', major: 'major', critical: 'critical', maintenance: 'maintenance' };
  if (typeof indicator !== 'string' || !Object.hasOwn(levels, indicator)) throw new Error('未知服务状态');
  return levels[indicator];
}
let activeManager: QuotaManager | null = null;
export function getQuotaRuntimeState(): QuotaState | null { return activeManager?.getState() ?? null; }

export async function initializeQuotaRuntime(options: { onChanged(state: QuotaState): void; showMainWindow(): void }) {
  const force = { forceRefresh: true };
  const reads: Record<string, () => Promise<unknown>> = {
    codex: () => readCodexSubscription(force), claude: () => readClaudeSubscription(force),
    cursor: () => readCursorSubscription(force), copilot: () => readCopilotSubscription(force),
    grok: () => readGrokSubscription(force), zcode: () => readZcodeSubscription(force),
    kimi: async () => selectKimiSubscription(await readKimiSubscriptions(force)),
    antigravity: () => readAntigravitySubscription(force), qoder: () => readQoderSubscription(force),
    minimax: () => readMiniMaxSubscription(force), deepseek: () => readDeepSeekSubscription(force),
    opencode: () => readOpenCodeSubscription(force),
  };
  const readers: QuotaReader[] = SUBSCRIPTION_CHANNELS.map(channel => ({ ...channel,
    interval: channel.id === 'codex' ? 180 : channel.id === 'copilot' ? 900 : channel.id === 'antigravity' ? 600 : 300,
    read: () => captureQuotaRead(reads[channel.id]), statusUrl: STATUS_URLS[channel.id] }));
  const store = await openQuotaStore(path.join(app.getPath('userData'), 'quota'));
  const notifications = new Set<Notification>();
  const manager = new QuotaManager({ readers, store,
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
    fetchStatus: async url => {
      if (!Object.values(STATUS_URLS).includes(url)) throw new Error('unsupported status source');
      const response = await net.fetch(new URL('api/v2/status.json', url).toString(), { signal: AbortSignal.timeout(15000), credentials: 'omit', redirect: 'error', cache: 'no-store' });
      if (!response.ok) throw new Error('status unavailable');
      const body = await response.text();
      if (body.length > 256 * 1024) throw new Error('status response too large');
      return parseQuotaServiceStatus(JSON.parse(body));
    },
  });
  activeManager = manager;
  for (const channel of [QUOTA_GET, QUOTA_REFRESH, QUOTA_SET]) ipcMain.removeHandler(channel);
  ipcMain.handle(QUOTA_GET, () => { const state = manager.getState(); void manager.refresh('interaction'); return state; });
  ipcMain.handle(QUOTA_REFRESH, (_event, id: unknown) => {
    if (id !== undefined && !SUBSCRIPTION_CHANNELS.some(channel => channel.id === id)) throw new Error('未知额度来源');
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
