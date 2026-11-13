import type { SessionNavigationTarget } from './agent-activity.js';
import type { QuotaNavigationTarget } from './quota-navigation.js';
import type { QuotaServiceStatus } from './quota.js';

export const NOTIFICATION_CATEGORIES = ['quota', 'service'] as const;
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number];
export type NotificationMode = 'off' | 'background' | 'always';
export type NotificationSound = 'none' | 'soft' | 'bell';
export interface NotificationPreferences { modes: Record<NotificationCategory, NotificationMode>; sound: NotificationSound }
export interface NotificationPreferencePatch { modes?: Partial<NotificationPreferences['modes']>; sound?: NotificationSound }
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  modes: { quota: 'always', service: 'always' }, sound: 'soft',
};
export type NotificationTarget = { kind: 'session'; value: SessionNavigationTarget } | { kind: 'quota'; value?: QuotaNavigationTarget };
export interface DesktopNotice {
  id: string; category: NotificationCategory; title: string; body: string; target?: NotificationTarget;
  sessionKey?: string; requestId?: string; replaceKey?: string; occurredAt?: number;
  expiresAt?: number;
  snoozable?: boolean;
  /** Ordered native actions, assigned by the notification manager. */
  actions?: NotificationAction[];
  context?: { kind: 'quota'; alert: 'reset' | 'depleted' | `threshold-${number}`; resetsAt: number | null; epoch?: number }
    | { kind: 'service'; level: QuotaServiceStatus['level']; selection: string; label: string };
}
export type NotificationAction = 'view' | 'snooze' | 'dismiss-all';
export type NotificationDelivery = 'shown' | 'requested' | 'suppressed';
export interface NotificationSettingsState { preferences: NotificationPreferences; supported: boolean; pendingCount?: number; issue: 'load' | 'delivery' | 'sound' | 'integration' | null }
export const NOTIFICATIONS_GET = 'notifications:get';
export const NOTIFICATIONS_SET = 'notifications:set';
export const NOTIFICATIONS_CLEAR = 'notifications:clear';
export const NOTIFICATIONS_CHANGED = 'notifications:changed';
export const NOTIFICATIONS_TEST = 'notifications:test';
export const NOTIFICATIONS_PREVIEW_SOUND = 'notifications:preview-sound';
export const NOTIFICATION_NAVIGATION = 'notifications:navigation';
export const NOTIFICATION_NAVIGATION_GET = 'notifications:navigation-get';
export const NOTIFICATION_NAVIGATION_ACK = 'notifications:navigation-ack';
