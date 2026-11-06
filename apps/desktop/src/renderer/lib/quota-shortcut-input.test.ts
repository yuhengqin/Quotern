import assert from 'node:assert/strict';
import test from 'node:test';
import { quotaShortcutFromKey } from './quota-shortcut-input';

type ShortcutKeyEvent = Parameters<typeof quotaShortcutFromKey>[0];

function keyEvent(key: string, modifiers: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return { key, location: 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, getModifierState: () => false, ...modifiers };
}

test('records shortcut chords with platform modifiers and Electron key names', () => {
  assert.equal(quotaShortcutFromKey(keyEvent('U', { ctrlKey: true, shiftKey: true }), 'win32'), 'Control+Shift+U');
  assert.equal(quotaShortcutFromKey(keyEvent('U', { metaKey: true, shiftKey: true }), 'darwin'), 'Command+Shift+U');
  assert.equal(quotaShortcutFromKey(keyEvent('u', { metaKey: true }), 'win32'), 'Super+U');
  assert.equal(quotaShortcutFromKey(keyEvent('Enter', { altKey: true }), 'win32'), 'Alt+Return');
  assert.equal(quotaShortcutFromKey(keyEvent('ArrowDown', { ctrlKey: true, altKey: true }), 'win32'), 'Control+Alt+Down');
  assert.equal(quotaShortcutFromKey(keyEvent(' ', { ctrlKey: true }), 'win32'), 'Control+Space');
  assert.equal(quotaShortcutFromKey(keyEvent('+', { ctrlKey: true, shiftKey: true }), 'win32'), 'Control+Shift+Plus');
  assert.equal(quotaShortcutFromKey(keyEvent('+', { ctrlKey: true, location: 3 }), 'win32'), 'Control+numadd');
  assert.equal(quotaShortcutFromKey(keyEvent('1', { ctrlKey: true, location: 3 }), 'win32'), 'Control+num1');
  assert.equal(quotaShortcutFromKey(keyEvent('F8'), 'win32'), 'F8');
});

test('leaves typing, focus navigation, and native text editing to the input', () => {
  for (const event of [
    keyEvent('u'), keyEvent('U', { shiftKey: true }), keyEvent('Control', { ctrlKey: true }),
    keyEvent('Tab'), keyEvent('Tab', { shiftKey: true }), keyEvent('Escape'),
    keyEvent('a', { ctrlKey: true }), keyEvent('v', { ctrlKey: true }), keyEvent('V', { ctrlKey: true, shiftKey: true }),
    keyEvent('Insert', { ctrlKey: true }), keyEvent('ArrowLeft', { ctrlKey: true }),
    keyEvent('+', { ctrlKey: true, altKey: true, getModifierState: name => name === 'AltGraph' }),
  ]) assert.equal(quotaShortcutFromKey(event, 'win32'), null, event.key);
  assert.equal(quotaShortcutFromKey(keyEvent('c', { metaKey: true }), 'darwin'), null);
  assert.equal(quotaShortcutFromKey(keyEvent('Backspace', { altKey: true }), 'darwin'), null);
});
