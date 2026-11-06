import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeQuotaShortcut, resolveQuotaShortcut } from '../src/quota/shared/quota-shortcut.js';
import { openQuotaStore, validQuotaPatch } from '../src/quota/readers/quota-store.js';

test('shortcut validation normalizes aliases and rejects incomplete or unsafe combinations', () => {
  assert.equal(normalizeQuotaShortcut(' shift + CTRL + u '), 'Control+Shift+U');
  assert.equal(normalizeQuotaShortcut('CmdOrCtrl+alt+F12'), 'CommandOrControl+Alt+F12');
  assert.equal(normalizeQuotaShortcut('Alt+Enter'), 'Alt+Return');
  assert.equal(normalizeQuotaShortcut('F8'), 'F8');
  for (const value of ['', 'U', 'Shift+U', 'Ctrl+', 'Ctrl+Ctrl+U', 'Ctrl+Shift', 'Ctrl+U+V', 'Control+CommandOrControl+U', 'Ctrl+F25', {}, null, 'Ctrl+constructor']) {
    assert.equal(normalizeQuotaShortcut(value), null, String(value));
    assert.equal(validQuotaPatch({ quotaShortcutAccelerator: value }), false);
  }
  assert.equal(validQuotaPatch({ quotaShortcutAccelerator: 'Ctrl+Shift+J' }), true);
  assert.equal(resolveQuotaShortcut('CommandOrControl+Shift+U', 'win32'), 'Control+Shift+U');
  assert.equal(resolveQuotaShortcut('CommandOrControl+Shift+U', 'darwin'), 'Command+Shift+U');
  assert.equal(resolveQuotaShortcut('Super+U', 'darwin'), 'Command+U');
  assert.equal(resolveQuotaShortcut('Command+U', 'win32'), null);
});

test('new and legacy preferences default service alerts on while preserving an explicit opt-out', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quotern-shortcut-'));
  try {
    let store = await openQuotaStore(directory);
    assert.equal(store.preferences.serviceAlerts, true);
    assert.equal(store.preferences.quotaShortcutAccelerator, 'CommandOrControl+Shift+U');
    await writeFile(path.join(directory, 'preferences.json'), JSON.stringify({ quotaShortcut: true }));
    store = await openQuotaStore(directory);
    assert.equal(store.preferences.serviceAlerts, true);
    assert.equal(store.preferences.quotaShortcut, true);
    await store.savePreferences({ ...store.preferences, serviceAlerts: false, quotaShortcutAccelerator: 'Control+Alt+J' });
    store = await openQuotaStore(directory);
    assert.equal(store.preferences.serviceAlerts, false);
    assert.equal(store.preferences.quotaShortcutAccelerator, 'Control+Alt+J');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
