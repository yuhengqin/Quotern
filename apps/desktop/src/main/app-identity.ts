import { mkdirSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

interface AppIdentity {
  getPath(name: 'userData'): string;
  setPath(name: 'userData' | 'sessionData', path: string): void;
  setName(name: string): void;
  setAppUserModelId(id: string): void;
}

/** Shared with the Tauri bundle identifier and the installed Start Menu shortcut. */
export const WINDOWS_APP_USER_MODEL_ID = 'dev.quotern.desktop';

export function windowsNotificationAppId(isolatedProfile?: string): string {
  return isolatedProfile ? `${WINDOWS_APP_USER_MODEL_ID}.dev.${createHash('sha256').update(isolatedProfile.toLowerCase()).digest('hex').slice(0, 16)}` : WINDOWS_APP_USER_MODEL_ID;
}

/** Configure before the single-instance lock and Chromium session are created. */
export function configureQuoternAppIdentity(app: AppIdentity): void {
  const isolated = process.env.QUOTERN_DEV_ISOLATED === '1';
  const override = process.env.QUOTERN_DESKTOP_USER_DATA?.trim();
  if (isolated && (!override || !isAbsolute(override) || override === app.getPath('userData'))) {
    throw new Error('隔离开发模式需要独立的绝对 QUOTERN_DESKTOP_USER_DATA；请使用 pnpm dev:desktop');
  }
  const userData = isolated ? override! : app.getPath('userData');
  mkdirSync(userData, { recursive: true });
  app.setName('Quotern');
  if (process.platform === 'win32') app.setAppUserModelId(windowsNotificationAppId(isolated ? userData : undefined));
  app.setPath('userData', userData);
  app.setPath('sessionData', userData);
}
