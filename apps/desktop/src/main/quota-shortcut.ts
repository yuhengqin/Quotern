import { QUOTA_SHORTCUT_ACCELERATOR } from '../shared/quota-desktop';

/** Own exactly one registration; never unregister another feature's shortcuts. */
export function createQuotaShortcut(deps: {
  register(accelerator: string, action: () => void): boolean;
  unregister(accelerator: string): void;
  open(): void;
}) {
  let registered = false, disposed = false;
  return {
    setEnabled(enabled: boolean): boolean {
      if (disposed) return !enabled;
      if (!enabled) {
        if (registered) deps.unregister(QUOTA_SHORTCUT_ACCELERATOR);
        registered = false; return true;
      }
      if (registered) return true;
      try { registered = deps.register(QUOTA_SHORTCUT_ACCELERATOR, deps.open); }
      catch { registered = false; }
      return registered;
    },
    isRegistered: () => registered,
    dispose() { disposed = true; if (registered) deps.unregister(QUOTA_SHORTCUT_ACCELERATOR); registered = false; },
  };
}
