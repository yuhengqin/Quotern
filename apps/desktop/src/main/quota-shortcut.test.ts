import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuotaShortcut } from './quota-shortcut';

test('quota shortcut reports conflicts, registers once, and releases only its own accelerator', () => {
  const owned = new Map<string, () => void>();
  owned.set('Unrelated', () => {});
  let blocked = true, opened = 0;
  const shortcut = createQuotaShortcut({
    register: (key, action) => { if (blocked) return false; owned.set(key, action); return true; },
    unregister: key => { owned.delete(key); },
    open: () => { opened++; },
  });
  assert.equal(shortcut.setEnabled(true), false);
  assert.equal(shortcut.isRegistered(), false);
  blocked = false;
  assert.equal(shortcut.setEnabled(true), true);
  assert.equal(shortcut.setEnabled(true), true);
  owned.get('CommandOrControl+Shift+U')!(); assert.equal(opened, 1);
  shortcut.setEnabled(false);
  assert.deepEqual([...owned.keys()], ['Unrelated']);
  shortcut.setEnabled(true); shortcut.dispose();
  assert.deepEqual([...owned.keys()], ['Unrelated']);
  assert.equal(shortcut.setEnabled(true), false);
  assert.deepEqual([...owned.keys()], ['Unrelated']);
});
