import { mkdirSync } from 'node:fs';
import { isAbsolute } from 'node:path';

interface AppIdentity {
  getPath(name: 'userData'): string;
  setPath(name: 'userData' | 'sessionData', path: string): void;
  setName(name: string): void;
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
  app.setPath('userData', userData);
  app.setPath('sessionData', userData);
}
