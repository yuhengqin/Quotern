export const QUOTA_SHORTCUT_ACCELERATOR = 'CommandOrControl+Shift+U';

const modifiers = ['Control', 'CommandOrControl', 'Command', 'Alt', 'AltGr', 'Shift', 'Super'];
const modifierNames = new Map([
  ['ctrl', 'Control'], ['control', 'Control'], ['cmd', 'Command'], ['command', 'Command'],
  ['cmdorctrl', 'CommandOrControl'], ['commandorcontrol', 'CommandOrControl'],
  ['alt', 'Alt'], ['option', 'Alt'], ['altgr', 'AltGr'], ['shift', 'Shift'],
  ['super', 'Super'], ['meta', 'Super'], ['win', 'Super'],
]);
const keyNames = new Map([
  ...['Plus', 'Space', 'Tab', 'Capslock', 'Numlock', 'Scrolllock', 'Backspace', 'Delete', 'Insert',
    'Return', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Escape',
    'VolumeUp', 'VolumeDown', 'VolumeMute', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop',
    'MediaPlayPause', 'PrintScreen', 'numdec', 'numadd', 'numsub', 'nummult', 'numdiv',
  ].map(key => [key.toLowerCase(), key] as const),
  ['enter', 'Return'], ['esc', 'Escape'], ['del', 'Delete'],
]);

/** Browser-safe Electron accelerator validation; unmodified typing keys are not global shortcuts. */
export function normalizeQuotaShortcut(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 120 || /[\r\n\x00]/.test(value)) return null;
  const parts = value.split('+').map(part => part.trim());
  if (parts.some(part => !part)) return null;
  const rawKey = parts.pop()!;
  const key = /^[a-z0-9]$/i.test(rawKey) || /^F(?:[1-9]|1\d|2[0-4])$/i.test(rawKey) ? rawKey.toUpperCase()
    : /^num[0-9]$/i.test(rawKey) ? rawKey.toLowerCase()
    : keyNames.get(rawKey.toLowerCase()) ?? (/^[!@#$%^&*():;=,<_.?/~`{}\[\]|\\"\)>-]$/.test(rawKey) ? rawKey : null);
  if (!key) return null;
  const selected = parts.map(part => modifierNames.get(part.toLowerCase()));
  if (selected.some(part => !part) || new Set(selected).size !== selected.length) return null;
  if (selected.includes('CommandOrControl') && (selected.includes('Control') || selected.includes('Command'))) return null;
  if (!selected.some(part => part !== 'Shift') && !/^F(?:[1-9]|1\d|2[0-4])$/.test(key)) return null;
  return [...modifiers.filter(modifier => selected.includes(modifier)), key].join('+');
}

/** Resolve aliases before ownership comparisons, including the platform-specific default. */
export function resolveQuotaShortcut(value: unknown, platform: string): string | null {
  const normalized = normalizeQuotaShortcut(value);
  if (!normalized) return null;
  const parts = normalized.split('+'), key = parts.pop()!;
  if (platform !== 'darwin' && parts.includes('Command')) return null;
  const selected = new Set(parts.map(part => part === 'CommandOrControl' ? platform === 'darwin' ? 'Command' : 'Control'
    : part === 'Super' && platform === 'darwin' ? 'Command' : part));
  return [...modifiers.filter(modifier => selected.has(modifier)), key].join('+');
}
