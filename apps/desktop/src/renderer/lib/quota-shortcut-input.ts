import { resolveQuotaShortcut } from '../../shared/quota-desktop';

const keyAliases = new Map([
  [' ', 'Space'], ['+', 'Plus'],
  ['ArrowUp', 'Up'], ['ArrowDown', 'Down'], ['ArrowLeft', 'Left'], ['ArrowRight', 'Right'],
  ['AudioVolumeUp', 'VolumeUp'], ['AudioVolumeDown', 'VolumeDown'], ['AudioVolumeMute', 'VolumeMute'],
  ['MediaTrackNext', 'MediaNextTrack'], ['MediaTrackPrevious', 'MediaPreviousTrack'],
]);
const numpadAliases = new Map([
  ['+', 'numadd'], ['-', 'numsub'], ['*', 'nummult'], ['/', 'numdiv'], ['.', 'numdec'], [',', 'numdec'],
]);
const caretKeys = /^(?:Arrow(?:Up|Down|Left|Right)|Home|End|Backspace|Delete)$/;

type ShortcutKeyEvent = Pick<KeyboardEvent,
  'key' | 'location' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'getModifierState'>;

export function quotaShortcutFromKey(event: ShortcutKeyEvent, platform: string): string | null {
  const { key, ctrlKey, metaKey, altKey, shiftKey } = event;
  if (event.getModifierState('AltGraph')) return null;

  const isMac = platform === 'darwin';
  const editingModifier = !altKey && (isMac ? metaKey && !ctrlKey : ctrlKey && !metaKey);
  const editingKey = shiftKey ? /^[vz]$/i : /^(?:[acvxyz]|Insert)$/i;
  if (editingModifier && editingKey.test(key)) return null;
  if (caretKeys.test(key) && (editingModifier || (isMac && altKey && !ctrlKey && !metaKey))) return null;

  const parts: string[] = [];
  if (ctrlKey) parts.push('Control');
  if (metaKey) parts.push('Super');
  if (altKey) parts.push('Alt');
  if (shiftKey) parts.push('Shift');

  // DOM_KEY_LOCATION_NUMPAD distinguishes keypad keys from their main-row equivalents.
  const numpadKey = event.location === 3
    ? (/^[0-9]$/.test(key) ? `num${key}` : numpadAliases.get(key))
    : undefined;
  parts.push(numpadKey ?? keyAliases.get(key) ?? key);
  return resolveQuotaShortcut(parts.join('+'), platform);
}
