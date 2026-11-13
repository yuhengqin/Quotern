import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createWindowsNotifications, registerWindowsNotificationIdentity, windowsNotificationIconPath } from './windows.js';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

test('packaged shell icon resolves to a real file outside the ASAR archive', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'quotern-shell-icon-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'resources')); writeFileSync(path.join(root, 'resources/icon.png'), 'fixture'); writeFileSync(path.join(root, 'app.asar'), 'archive');
  assert.equal(existsSync(windowsNotificationIconPath(root, path.join(root, 'app.asar'))), true);
});

test('Windows resolves the registered Quotern name and icon instead of its internal application ID', t => {
  if (process.platform !== 'win32') { t.skip('Windows registration'); return; }
  const id = `dev.quotern.desktop.test.${randomUUID()}`;
  const registration = registerWindowsNotificationIdentity(id, path.resolve('resources/icon.png'), true);
  t.after(() => registration.dispose());
  const values = execFileSync('reg.exe', ['query', `HKCU\\Software\\Classes\\AppUserModelId\\${id}`], { windowsHide: true, encoding: 'utf8' });
  assert.match(values, /DisplayName\s+REG_SZ\s+Quotern/);
  assert.match(values, /IconUri\s+REG_SZ\s+.*icon\.png/);
});

test('an application directory ending in a separator cannot swallow the activation flag', async t => {
  if (process.platform !== 'win32') { t.skip('Windows protocol registration'); return; }
  let argumentsRegistered: string[] = [];
  const value = await createWindowsNotifications({ appId: `dev.quotern.desktop.test.${randomUUID()}`, iconPath: path.resolve('resources/icon.png'), temporary: true, entry: path.resolve('.') + path.sep,
    app: { setAsDefaultProtocolClient: (_scheme, _executable, args) => { argumentsRegistered = args ?? []; return true; }, removeAsDefaultProtocolClient: () => true }, onAction: () => true,
  });
  t.after(() => value.dispose());
  assert.equal(argumentsRegistered[0], path.resolve('.'));
  assert.equal(argumentsRegistered[1], '--quotern-notification-action');
});
