import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createWindowsNotifications, registerWindowsNotificationIdentity, windowsNotificationIconPath } from './windows.js';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

test('the notification identity uses the icon bundled with the Node resources', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'quotern-shell-icon-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'resources')); writeFileSync(path.join(root, 'resources/icon.png'), 'fixture');
  assert.equal(existsSync(windowsNotificationIconPath(root, path.join(root, 'Quotern.exe'))), true);
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

test('the registered protocol quotes the native host and forwards the pipe and URL separately', async t => {
  if (process.platform !== 'win32') { t.skip('Windows protocol registration'); return; }
  const hostExecutable=path.resolve('a path with spaces','Quotern.exe');
  const value = await createWindowsNotifications({ appId: `dev.quotern.desktop.test.${randomUUID()}`, iconPath: path.resolve('resources/icon.png'), temporary: true, hostExecutable, onAction: () => true,
  });
  t.after(() => value.dispose());
  const registered=execFileSync('reg.exe',['query',`HKCU\\Software\\Classes\\${value.scheme}\\shell\\open\\command`,'/ve'],{windowsHide:true,encoding:'utf8'}).trimEnd();
  assert.ok(registered.includes('"'+hostExecutable+'" --quotern-notification-action "'));
  assert.match(registered,/quotern-notifications-[a-f0-9-]+" "%1"$/);
});
