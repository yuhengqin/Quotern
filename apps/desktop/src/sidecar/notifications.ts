import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { resolveDataDir } from 'quotern-core';
import type { SupportedLocale } from 'quotern-i18n';
import { AgentActivityMonitor, type ActivityRoot } from '../main/agent-activity/monitor.js';
import { discoverAgentActivityRoots } from '../main/agent-activity/sources.js';
import { AgentHookEvents } from '../main/agent-activity/hook-events.js';
import { NotificationManager } from '../main/notifications/manager.js';
import { NotificationNavigation } from '../main/notifications/navigation.js';
import { NotificationPreferencesStore } from '../main/notifications/preferences.js';
import { isQuotaNoticeCurrent, resolveQuotaReminder } from '../main/notifications/quota-notices.js';
import { NotificationSoundPlayer } from '../main/notifications/sound.js';
import { createWindowsNotifications } from '../main/notifications/windows.js';
import { windowsNotificationAppId } from '../main/app-identity.js';
import { summarizeNotices } from '../main/notifications/summary.js';
import type { ActivityEvent, ActivitySubscription } from '../shared/agent-activity.js';
import { DSH_PET_NAVIGATION, DSH_PET_NAVIGATION_GET, DSH_PET_NAVIGATION_ACK } from '../shared/dsh-pet.js';
import { notificationText } from '../shared/notification-messages.js';
import { NOTIFICATIONS_GET, NOTIFICATIONS_SET, NOTIFICATIONS_CLEAR, NOTIFICATIONS_CHANGED, NOTIFICATIONS_TEST, NOTIFICATIONS_PREVIEW_SOUND, NOTIFICATION_NAVIGATION, NOTIFICATION_NAVIGATION_GET, NOTIFICATION_NAVIGATION_ACK, type DesktopNotice, type NotificationAction, type NotificationPreferencePatch, type NotificationSettingsState, type NotificationSound } from '../shared/notifications.js';
import type { QuotaState } from '../shared/quota.js';

export async function desktopNotifications(profile: string, emit: (channel: string, ...args: unknown[]) => void, native: (channel: string, ...args: unknown[]) => Promise<unknown>, getLocale: () => SupportedLocale,
  options: {activityRoots?:()=>Promise<ActivityRoot[]>;iconPath?:string} = {}) {
  const directory = path.join(profile, 'notifications');
  const store = await NotificationPreferencesStore.open(path.join(directory, 'preferences.json'));
  const sound = new NotificationSoundPlayer(path.join(directory, 'sounds'));
  const navigation = new NotificationNavigation(), subscribers = new Set<(event: ActivityEvent) => void>();
  let issue: NotificationSettingsState['issue'] = null, paused = true, disposed = false, focused = false, generation = 0, timer: ReturnType<typeof setInterval> | null = null;
  let quotaState: QuotaState | null = null;
  const state = (): NotificationSettingsState => ({ preferences: store.preferences, supported: true, pendingCount: manager.count, issue: store.issue ?? issue });
  const changed = () => emit(NOTIFICATIONS_CHANGED, state());
  let windows: Promise<Awaited<ReturnType<typeof createWindowsNotifications>>> | undefined;
  const temporary = process.env.QUOTERN_DEV_ISOLATED === '1';
  const appId = windowsNotificationAppId(temporary ? profile : undefined);
  function openWindows() {
    const hostExecutable = process.env.QUOTERN_DESKTOP_EXECUTABLE;
    if (!hostExecutable || !path.isAbsolute(hostExecutable)) throw Error('Missing desktop host executable');
    return windows ??= createWindowsNotifications({appId, temporary, hostExecutable, iconPath:options.iconPath??path.join(__dirname, 'resources/icon.png'),
      onAction:(id, action) => manager.activate(id,action),
    }).catch(error => { windows = undefined; throw error; });
  }
  const manager = new NotificationManager({
    batch: { delayMs: 1000, summarize: notices => summarizeNotices(notices, getLocale()) },
    onChange: changed,
    retainAfterClose: process.platform === 'win32',
    preferences: () => store.preferences, isSupported: () => true, isFocused: () => focused,
    create: (value, notice) => {
      const events = new EventEmitter();
      let withdrawn = false, delivered = false;
      const remove = () => native('notifications:remove', notice.id, appId).catch(() => {});
      return Object.assign(events, {
        handlesActivation: true,
        show() {
          const delivery = async () => {
            const toast = process.platform === 'win32' ? (await openWindows()).toast(notice,value,getLocale()) : undefined;
            if (withdrawn) return;
            const locale = getLocale();
            return native('notifications:show', { ...notice, title: value.title, body: value.body, locale,
              actionLabels:{view:notificationText(locale,'view'),snooze:notificationText(locale,'snooze'),'dismiss-all':notificationText(locale,'dismissAll')},
            }, {appId,toast});
          };
          void delivery().then(result => {
            delivered = Boolean(result);
            if (withdrawn && result) void remove();
            else if (result === 'shown') events.emit('show');
          }, () => events.emit('failed'));
        },
        close() { withdrawn = true; if(delivered) void remove(); },
      });
    },
    sound: (value, current) => sound.play(value, current),
    onIssue: value => { issue = value; changed(); },
    resolveNotice: notice => quotaState ? resolveQuotaReminder(notice, quotaState, getLocale()) : notice,
    onClick: notice => {
      if (notice.target?.kind === 'quota') {
        void native('host:open-quota', notice.target.value).catch(() => { issue = 'delivery'; changed(); });
        return;
      }
      if (notice.target?.kind === 'session') navigation.open(notice.target.value);
      void native('host:open-main').then(() => {
        emit(NOTIFICATION_NAVIGATION); emit(DSH_PET_NAVIGATION);
      }, () => { issue = 'delivery'; changed(); });
      if (notice.sessionKey) manager.dismiss(value => value.sessionKey === notice.sessionKey);
    },
  });
  const send = (notice: DesktopNotice, test = false) => disposed || paused && !test ? Promise.resolve('suppressed' as const) : manager.send(notice, test);
  const receive = (event: ActivityEvent) => { if (paused || disposed) return; for (const listener of subscribers) { try { listener(event); } catch { /* One observer cannot stop delivery to others. */ } } };
  const monitor = new AgentActivityMonitor({ roots: options.activityRoots??discoverAgentActivityRoots, onEvent: receive });
  const hooks = new AgentHookEvents({ directory: path.join(resolveDataDir(), 'integrations/notification-events'), onEvent: receive });
  const activity: ActivitySubscription = { subscribe: listener => { subscribers.add(listener); return () => subscribers.delete(listener); }, capabilities: () => monitor.capabilities() };
  const handlers = new Map<string, (...args: unknown[]) => unknown>([
    [NOTIFICATIONS_GET, () => state()],
    [NOTIFICATIONS_CLEAR, () => { manager.clear(); return state(); }],
    [NOTIFICATIONS_SET, async patch => { await store.set(patch as NotificationPreferencePatch); issue = null; manager.reconcile(); changed(); return state(); }],
    [NOTIFICATIONS_TEST, () => {
      issue = null; changed();
      return send({ id: randomUUID(), category: 'quota', title: notificationText(getLocale(), 'testTitle'), body: notificationText(getLocale(), 'testBody') }, true);
    }],
    [NOTIFICATIONS_PREVIEW_SOUND, async value => {
      if (typeof value !== 'string' || !['none', 'soft', 'bell'].includes(value)) throw new Error('Invalid notification sound');
      try { await sound.play(value as NotificationSound, () => !disposed, true); if (issue === 'sound') { issue = null; changed(); } }
      catch (error) { issue = 'sound'; changed(); throw error; }
    }],
    ['notifications:activate', (id, action) => {
      if (typeof id !== 'string' || typeof action !== 'string' || !['view', 'snooze', 'dismiss-all'].includes(action)) return false;
      return manager.activate(id, action as NotificationAction);
    }],
  ]);
  for (const channel of [NOTIFICATION_NAVIGATION_GET, DSH_PET_NAVIGATION_GET]) handlers.set(channel, () => navigation.peek());
  for (const channel of [NOTIFICATION_NAVIGATION_ACK, DSH_PET_NAVIGATION_ACK]) handlers.set(channel, id => { if (typeof id === 'string') navigation.acknowledge(id); });
  return {
    async request(channel: string, args: unknown[]): Promise<unknown> {
      const handler = handlers.get(channel);
      if (!handler) throw new Error('Unsupported notification operation: ' + channel);
      return handler(...args);
    },
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
    async close() {
      paused = true; generation++; if (timer) clearInterval(timer); timer = null;
      monitor.dispose(); hooks.dispose(); manager.dismiss(() => true); sound.stop();
      disposed = true; manager.dispose(); sound.dispose(); subscribers.clear();
      await windows?.then(bridge => bridge.dispose(), () => {});
    },
    focus(value: boolean) { focused = value; manager.reconcile(); },
  };
}
