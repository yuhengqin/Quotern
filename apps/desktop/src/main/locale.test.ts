import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

let userData: string;
let autostart: Record<string, (...args: any[]) => Promise<any>>;
const electronId = require.resolve('electron');
require(electronId);
const originalElectron = require.cache[electronId]!.exports;

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'quotern-locale-test-'));
  require.cache[electronId]!.exports = {
    app: { getPath: () => userData },
    BrowserWindow: { getAllWindows: () => [] },
    ipcMain: {},
  };
  delete require.cache[require.resolve('./autostart.js')];
  autostart = require('./autostart.js');
  require.cache[electronId]!.exports = originalElectron;
});

afterEach(async () => {
  require.cache[electronId]!.exports = originalElectron;
  await rm(userData, { recursive: true, force: true });
});

test('locale preference defaults to system and persists without replacing other desktop preferences', async () => {
  assert.equal(await autostart.loadLocalePreference(), 'system');
  await writeFile(join(userData, 'desktop-prefs.json'), JSON.stringify({
    openAtLogin: false,
    launchHidden: false,
    themeMode: 'dark',
  }));

  await autostart.saveLocalePreference('ja');

  const persisted = JSON.parse(await readFile(join(userData, 'desktop-prefs.json'), 'utf8'));
  assert.equal(persisted.localePreference, 'ja');
  assert.equal(persisted.openAtLogin, false);
  assert.equal(persisted.launchHidden, false);
  assert.equal(persisted.themeMode, 'dark');
  assert.equal(await autostart.loadLocalePreference(), 'ja');
});

test('invalid saved locale falls back to system', async () => {
  await writeFile(join(userData, 'desktop-prefs.json'), JSON.stringify({
    openAtLogin: true,
    launchHidden: true,
    localePreference: 'fr',
  }));
  assert.equal(await autostart.loadLocalePreference(), 'system');
});
