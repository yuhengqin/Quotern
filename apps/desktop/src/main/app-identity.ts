import { mkdirSync } from 'node:fs';

interface AppIdentity {
  getPath(name: 'userData'): string;
  setPath(name: 'userData' | 'sessionData', path: string): void;
  setName(name: string): void;
}

/** Configure before the single-instance lock and Chromium session are created. */
export function configureQuoternAppIdentity(app: AppIdentity): void {
  const userData = app.getPath('userData');
  mkdirSync(userData, { recursive: true });
  app.setName('Quotern');
  app.setPath('userData', userData);
  app.setPath('sessionData', userData);
}
