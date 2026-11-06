import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuotaShortcut } from './quota-shortcut';

test('changing the shortcut reserves the new key and preserves the old key on conflict or save failure', async () => {
  const owned = new Map<string, () => void>();
  let opened = 0, saves = 0;
  const shortcut = createQuotaShortcut({
    platform: 'win32',
    register: (key, action) => { if (owned.has(key)) return false; owned.set(key, action); return true; },
    unregister: key => { owned.delete(key); }, open: () => { opened++; },
  });
  assert.equal(shortcut.setEnabled(true), true);
  owned.set('Control+Alt+K', () => {});
  await assert.rejects(shortcut.save(true, 'Ctrl+Alt+K', async () => { saves++; }), /QUOTA_SHORTCUT_UNAVAILABLE/);
  assert.equal(saves, 0);
  await assert.rejects(shortcut.save(true, 'Ctrl+Alt+J', async () => {
    owned.get('Control+Shift+U')!();
    owned.get('Control+Alt+J')!(); // A reserved key cannot fire before persistence succeeds.
    assert.equal(opened, 1);
    shortcut.setEnabled(true); // A refresh during persistence must not change ownership.
    throw new Error('disk full');
  }), /disk full/);
  assert.deepEqual([...owned.keys()].sort(), ['Control+Alt+K', 'Control+Shift+U']);
  await shortcut.save(true, 'ctrl + alt + j', async () => { saves++; });
  assert.equal(owned.has('Control+Shift+U'), false);
  owned.get('Control+Alt+J')!(); assert.equal(opened, 2);
  // Equivalent spellings do not falsely conflict with our own registration.
  await shortcut.save(true, 'Alt+Control+J', async () => { saves++; });
  await shortcut.save(false, 'Control+Alt+J', async () => { saves++; });
  assert.deepEqual([...owned.keys()], ['Control+Alt+K']);
  // Saving while disabled checks availability without leaving a shortcut registered.
  await assert.rejects(shortcut.save(false, 'Control+Alt+K', async () => {}), /QUOTA_SHORTCUT_UNAVAILABLE/);
  await shortcut.save(false, 'Control+Alt+J', async () => {});
  assert.deepEqual([...owned.keys()], ['Control+Alt+K']);
  shortcut.dispose();
});

test('invalid shortcuts never reach the OS or persistence and disposal also releases pending reservations', async () => {
  const owned = new Set<string>();
  const shortcut = createQuotaShortcut({ platform: 'win32', register: key => { owned.add(key); return true; }, unregister: key => { owned.delete(key); }, open() {} });
  await assert.rejects(shortcut.save(true, 'U', async () => assert.fail('must not save')), /QUOTA_SHORTCUT_INVALID/);
  await assert.rejects(shortcut.save(true, 'Cmd+U', async () => assert.fail('must not save')), /QUOTA_SHORTCUT_INVALID/);
  assert.equal(owned.size, 0);
  shortcut.setEnabled(true);
  await shortcut.save(true, 'Ctrl+Alt+J', async () => { shortcut.dispose(); });
  assert.equal(owned.size, 0);
  assert.equal(shortcut.isRegistered(), false);
});

test('quota shortcut reports conflicts, registers once, and releases only its own accelerator', () => {
  const owned = new Map<string, () => void>();
  owned.set('Unrelated', () => {});
  let blocked = true, opened = 0;
  const shortcut = createQuotaShortcut({
    platform: 'win32',
    register: (key, action) => { if (blocked) return false; owned.set(key, action); return true; },
    unregister: key => { owned.delete(key); },
    open: () => { opened++; },
  });
  assert.equal(shortcut.setEnabled(true), false);
  assert.equal(shortcut.isRegistered(), false);
  blocked = false;
  assert.equal(shortcut.setEnabled(true), true);
  assert.equal(shortcut.setEnabled(true), true);
  owned.get('Control+Shift+U')!(); assert.equal(opened, 1);
  shortcut.setEnabled(false);
  assert.deepEqual([...owned.keys()], ['Unrelated']);
  shortcut.setEnabled(true); shortcut.dispose();
  assert.deepEqual([...owned.keys()], ['Unrelated']);
  assert.equal(shortcut.setEnabled(true), false);
  assert.deepEqual([...owned.keys()], ['Unrelated']);
});
