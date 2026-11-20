import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { SupportedLocale } from 'quotern-i18n';
import type { DesktopNotice, NotificationAction } from '../../shared/notifications.js';
import { notificationText } from '../../shared/notification-messages.js';
import { createNotificationActivation, NOTIFICATION_ACTIVATION_FLAG } from './activation.js';
import { buildWindowsToast } from './toast.js';

export function windowsNotificationIconPath(resourcesPath: string | null, applicationDirectory: string): string {
  return path.join(resourcesPath ?? applicationDirectory, 'resources', 'icon.png');
}

/** Complete the system attribution area; a body image is not an application identity. */
export function registerWindowsNotificationIdentity(appId: string, iconPath: string, temporary: boolean) {
  if (!/^dev\.quotern\.desktop(?:\.[a-zA-Z0-9.-]+)?$/.test(appId)) throw new Error('Invalid Quotern notification identity');
  if (!path.isAbsolute(iconPath) || !existsSync(iconPath)) throw new Error('Notification icon is unavailable');
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${appId}`;
  const run = (args: string[]) => execFileSync('reg.exe', args, { windowsHide: true, timeout: 5000, stdio: 'pipe' });
  run(['add', key, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', 'Quotern', '/f']);
  run(['add', key, '/v', 'IconUri', '/t', 'REG_SZ', '/d', iconPath, '/f']);
  return { dispose() { if (temporary) { try { run(['delete', key, '/f']); } catch { console.warn('[quotern] notification identity cleanup failed'); } } } };
}

export async function createWindowsNotifications(options: {
  appId: string; iconPath: string; temporary: boolean; hostExecutable: string;
  onAction(id: string, action: NotificationAction): boolean;
}) {
  const identity = registerWindowsNotificationIdentity(options.appId, options.iconPath, options.temporary);
  const scheme = options.appId === 'dev.quotern.desktop' ? 'quotern-notice' : `quotern-notice-${createHash('sha256').update(options.appId).digest('hex').slice(0, 16)}`;
  const bridge = await createNotificationActivation(scheme, options.onAction).catch(error => { identity.dispose(); throw error; });
  const key = 'HKCU\\Software\\Classes\\' + scheme;
  const commandKey = key + '\\shell\\open\\command';
  const command = `"${options.hostExecutable}" ${NOTIFICATION_ACTIVATION_FLAG} "${bridge.pipe}" "%1"`;
  const registry = (args: string[]) => execFileSync('reg.exe', args, { windowsHide:true, timeout:5000, encoding:'utf8', stdio:['ignore','pipe','pipe'] });
  try {
    registry(['add',key,'/ve','/d','URL:Quotern notification','/f']);
    registry(['add',key,'/v','URL Protocol','/d','','/f']);
    registry(['add',commandKey,'/ve','/d',command,'/f']);
  } catch (error) { bridge.dispose(); identity.dispose(); throw error; }
  return {
    scheme,
    toast(notice: DesktopNotice, text: { title: string; body: string }, locale: SupportedLocale) {
      return buildWindowsToast({ ...text, viewUrl: bridge.url(notice.id, 'view'), snoozeUrl: notice.actions?.includes('snooze') ? bridge.url(notice.id, 'snooze') : undefined, dismissAllUrl: notice.actions?.includes('dismiss-all') ? bridge.url(notice.id, 'dismiss-all') : undefined, viewLabel: notificationText(locale, 'view'), snoozeLabel: notificationText(locale, 'snooze'), dismissAllLabel: notificationText(locale, 'dismissAll') });
    },
    dispose() {
      bridge.dispose();
      try {
        if (registry(['query',commandKey,'/ve']).trimEnd().endsWith(command)) registry(['delete',key,'/f']);
      } catch { /* Another running version may already have released the protocol. */ }
      identity.dispose();
    },
  };
}
