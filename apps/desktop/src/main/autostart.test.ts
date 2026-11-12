import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { buildTrayMenuTemplate, type TrayMenuOptions } from './tray-menu.js';

let userData: string;
let autostart: typeof import('./autostart.js');
let failLogin: boolean;
let loginItems: unknown[];
let sent: unknown[][];
const originalArgv = [...process.argv];
const electronId = require.resolve('electron');
require(electronId);
const originalElectron = require.cache[electronId]!.exports;

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'quotern-autostart-test-'));
  failLogin = true;
  loginItems = [];
  sent = [];
  process.argv = [...originalArgv, '--hidden'];
  require.cache[electronId]!.exports = {
    app: {
      isPackaged: true,
      getPath: () => userData,
      setLoginItemSettings: (settings: unknown) => {
        if (failLogin) throw new Error('login registration failed');
        loginItems.push(settings);
      },
    },
    BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (...args: unknown[]) => sent.push(args) } }] },
  };
  delete require.cache[require.resolve('./autostart.js')];
  autostart = require('./autostart.js') as typeof import('./autostart.js');
  require.cache[electronId]!.exports = originalElectron;
});

afterEach(async () => {
  process.argv = originalArgv;
  require.cache[electronId]!.exports = originalElectron;
  await rm(userData, { recursive: true, force: true });
});

test('first hidden launch stays hidden if login registration fails', async () => {
  await assert.rejects(autostart.initAutostartOnLaunch(), /login registration failed/);
  assert.equal(autostart.shouldStartHidden(), true);
});

test('existing hidden launch stays hidden if login registration fails', async () => {
  await writeFile(join(userData, 'desktop-prefs.json'), JSON.stringify({
    openAtLogin: true,
    launchHidden: true,
  }));
  await assert.rejects(autostart.initAutostartOnLaunch(), /login registration failed/);
  assert.equal(autostart.shouldStartHidden(), true);
});

test('a failed autostart toggle leaves the saved choice unchanged', async () => {
  await writeFile(join(userData, 'desktop-prefs.json'), JSON.stringify({
    openAtLogin: false, launchHidden: false, themeMode: 'dark',
  }));
  await assert.rejects(autostart.applyAutostart(true), /login registration failed/);
  const saved = JSON.parse(await readFile(join(userData, 'desktop-prefs.json'), 'utf8'));
  assert.equal(saved.openAtLogin, false);
  assert.equal(saved.launchHidden, false);
  assert.equal(saved.themeMode, 'dark');
  assert.deepEqual(sent, []);
});

test('a successful autostart toggle preserves other preferences and notifies open settings', async () => {
  failLogin = false;
  await writeFile(join(userData, 'desktop-prefs.json'), JSON.stringify({
    openAtLogin: false, launchHidden: false, themeMode: 'dark',
  }));
  assert.equal(await autostart.applyAutostart(true), true);
  assert.deepEqual(loginItems, [{ openAtLogin: true, openAsHidden: false, args: [] }]);
  const saved = JSON.parse(await readFile(join(userData, 'desktop-prefs.json'), 'utf8'));
  assert.equal(saved.openAtLogin, true);
  assert.equal(saved.launchHidden, false);
  assert.equal(saved.themeMode, 'dark');
  assert.deepEqual(sent, [['autostart:changed', true]]);
});

test('a preference write failure restores the previous system login item', async () => {
  failLogin = false;
  await mkdir(join(userData, 'desktop-prefs.json'));
  await assert.rejects(autostart.applyAutostart(false));
  assert.deepEqual(loginItems, [
    { openAtLogin: false, openAsHidden: true, args: ['--hidden'] },
    { openAtLogin: true, openAsHidden: true, args: ['--hidden'] },
  ]);
  assert.deepEqual(sent, []);
});

test('settings changes refresh a subscribed native menu without a right-click rebuild', async () => {
  failLogin = false;
  const options: TrayMenuOptions = {
    getLocale: () => 'zh-CN', showMainWindow() {}, openSettings() {}, quit() {},
    getAutostart: async () => (await autostart.loadAutostartPref()).openAtLogin,
    setAutostart: enabled => autostart.applyAutostart(enabled),
    onError: error => { throw error; },
  };
  let menu = await buildTrayMenuTemplate(options);
  assert.equal(menu[1]!.checked, true);
  let refreshed: Promise<void> | undefined;
  const dispose = autostart.onAutostartPrefChanged(() => {
    refreshed = buildTrayMenuTemplate(options).then(next => { menu = next; });
  });
  await autostart.applyAutostart(false);
  await refreshed;
  assert.equal(menu[1]!.checked, false);
  dispose();
  await autostart.applyAutostart(true);
  assert.equal(menu[1]!.checked, false, 'disposing removes the native menu subscription');
});
