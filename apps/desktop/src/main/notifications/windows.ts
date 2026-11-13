import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { App } from 'electron';
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
  app: Pick<App, 'setAsDefaultProtocolClient' | 'removeAsDefaultProtocolClient'>;
  appId: string; iconPath: string; temporary: boolean; entry?: string;
  onAction(id: string, action: NotificationAction): boolean;
}) {
  const identity = registerWindowsNotificationIdentity(options.appId, options.iconPath, options.temporary);
  const scheme = options.appId === 'dev.quotern.desktop' ? 'quotern-notice' : `quotern-notice-${createHash('sha256').update(options.appId).digest('hex').slice(0, 16)}`;
  const bridge = await createNotificationActivation(scheme, options.onAction).catch(error => { identity.dispose(); throw error; });
  // The portable launcher survives its temporary extraction directory.
  const executable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  // A trailing backslash would escape Electron's closing quote in the Windows command line.
  const args = [...(options.entry ? [path.resolve(options.entry)] : []), NOTIFICATION_ACTIVATION_FLAG, bridge.pipe];
  try {
    if (!options.app.setAsDefaultProtocolClient(scheme, executable, args)) throw new Error('Notification action protocol registration failed');
  } catch (error) { bridge.dispose(); identity.dispose(); throw error; }
  return {
    scheme,
    toast(notice: DesktopNotice, text: { title: string; body: string }, locale: SupportedLocale) {
      return buildWindowsToast({ ...text, viewUrl: bridge.url(notice.id, 'view'), snoozeUrl: notice.snoozable === false ? undefined : bridge.url(notice.id, 'snooze'), viewLabel: notificationText(locale, 'view'), snoozeLabel: notificationText(locale, 'snooze') });
    },
    dispose() {
      bridge.dispose();
      // Electron checks that this exact executable + arguments still owns the scheme.
      options.app.removeAsDefaultProtocolClient(scheme, executable, args);
      identity.dispose();
    },
  };
}
