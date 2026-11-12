import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_NOTIFICATION_PREFERENCES, NOTIFICATION_CATEGORIES, type NotificationPreferences, type NotificationPreferencePatch } from '../../shared/notifications.js';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function validNotificationPatch(value: unknown): value is NotificationPreferencePatch {
  if (!object(value) || Object.keys(value).some(key => !['modes', 'sound'].includes(key))) return false;
  if (value.sound !== undefined && (typeof value.sound !== 'string' || !['none', 'soft', 'bell'].includes(value.sound))) return false;
  return value.modes === undefined || object(value.modes) && Object.entries(value.modes).every(([key, mode]) => NOTIFICATION_CATEGORIES.includes(key as typeof NOTIFICATION_CATEGORIES[number]) && typeof mode === 'string' && ['off', 'background', 'always'].includes(mode));
}
export class NotificationPreferencesStore {
  private value = structuredClone(DEFAULT_NOTIFICATION_PREFERENCES);
  private queue = Promise.resolve();
  issue: 'load' | null = null;
  private constructor(private readonly write: (data: string) => Promise<void>) {}
  get preferences(): NotificationPreferences { return structuredClone(this.value); }
  static async open(file: string, options: { legacyAgentMuted?: boolean; write?: (data: string) => Promise<void> } = {}) {
    const store = new NotificationPreferencesStore(options.write ?? (async data => {
      const temporary = `${file}.${randomUUID()}.tmp`;
      await mkdir(path.dirname(file), { recursive: true });
      try { await writeFile(temporary, data, { flag: 'wx', mode: 0o600 }); await rename(temporary, file); }
      finally { await rm(temporary, { force: true }); }
    }));
    try {
      if ((await stat(file)).size > 16384) throw new Error('invalid preferences');
      const text = await readFile(file, 'utf8');
      if (text.length > 16384) throw new Error('invalid preferences');
      const raw = JSON.parse(text);
      if (!object(raw) || raw.version !== 1) throw new Error('invalid preferences');
      const { version: _version, ...patch } = raw;
      if (!validNotificationPatch(patch)) throw new Error('invalid preferences');
      const stored = patch as NotificationPreferencePatch;
      store.value = { ...store.value, ...stored, modes: { ...store.value.modes, ...stored.modes } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (options.legacyAgentMuted) for (const key of ['agentComplete', 'agentConfirmation', 'agentError'] as const) store.value.modes[key] = 'off';
      } else {
        store.issue = 'load'; store.value.sound = 'none';
        for (const key of NOTIFICATION_CATEGORIES) store.value.modes[key] = 'off';
      }
    }
    return store;
  }
  set(patch: NotificationPreferencePatch): Promise<NotificationPreferences> {
    if (!validNotificationPatch(patch)) return Promise.reject(new Error('NOTIFICATION_INVALID_PREFERENCES'));
    const copy = structuredClone(patch);
    const pending = this.queue.then(async () => {
      const next = { ...this.value, ...copy, modes: { ...this.value.modes, ...copy.modes } };
      await this.write(JSON.stringify({ version: 1, ...next }, null, 2) + '\n');
      this.value = next; this.issue = null;
    });
    this.queue = pending.catch(() => {});
    return pending.then(() => this.preferences);
  }
}
