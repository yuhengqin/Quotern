import { QUOTA_SHORTCUT_ACCELERATOR, resolveQuotaShortcut } from '../shared/quota-desktop';

/** Retain the old registration until both the replacement and persistence succeed. */
export function createQuotaShortcut(deps: {
  register(accelerator: string, action: () => void): boolean;
  unregister(accelerator: string): void;
  open(): void;
  platform?: string;
}) {
  let registered: string | null = null, reserved: string | null = null;
  let disposed = false, saving = false;
  const resolve = (value: string) => resolveQuotaShortcut(value, deps.platform ?? process.platform);
  const register = (key: string) => {
    try { return deps.register(key, () => { if (!disposed && registered === key) deps.open(); }); }
    catch { return false; }
  };
  const releaseReserved = () => { if (reserved) deps.unregister(reserved); reserved = null; };
  return {
    setEnabled(enabled: boolean, accelerator = QUOTA_SHORTCUT_ACCELERATOR): boolean {
      if (disposed) return !enabled;
      // Manager refreshes may emit the previous settings while a disk write is pending.
      if (saving) return registered !== null;
      const next = enabled ? resolve(accelerator) : null;
      if (enabled && !next) return false;
      if (next === registered) return true;
      if (next && !register(next)) return false;
      if (registered) deps.unregister(registered);
      registered = next;
      return true;
    },
    async save<T>(enabled: boolean, accelerator: string, persist: () => Promise<T>): Promise<T> {
      if (disposed || saving) throw new Error('QUOTA_SHORTCUT_UNAVAILABLE');
      const key = resolve(accelerator);
      if (!key) throw new Error('QUOTA_SHORTCUT_INVALID');
      // Also check edits made while disabled, then release the temporary reservation.
      if (key !== registered) {
        if (!register(key)) throw new Error('QUOTA_SHORTCUT_UNAVAILABLE');
        reserved = key;
      }
      saving = true;
      try {
        const result = await persist();
        if (!disposed) {
          const next = enabled ? key : null;
          if (registered && registered !== next) deps.unregister(registered);
          registered = next;
          if (reserved === next) reserved = null;
        }
        return result;
      } finally { releaseReserved(); saving = false; }
    },
    isRegistered: () => registered !== null,
    dispose() {
      disposed = true;
      if (registered) deps.unregister(registered);
      registered = null;
      releaseReserved();
    },
  };
}
