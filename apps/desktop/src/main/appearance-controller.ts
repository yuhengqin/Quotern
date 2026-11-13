import { isAppearancePreferences, normalizeAppearancePreferences, type AppearancePreferences } from '../shared/appearance.js';

interface AppearancePorts {
  read: () => Promise<unknown>;
  write: (value: AppearancePreferences) => Promise<void>;
  apply: (value: AppearancePreferences) => void;
  publish: (value: AppearancePreferences) => void;
}

/** One ordered authority for durable preferences and cross-window publication. */
export function createAppearanceController(ports: AppearancePorts) {
  let current: AppearancePreferences | null = null;
  let queue: Promise<unknown> = ports.read().then(value => {
    if (isAppearancePreferences(value)) {
      current = normalizeAppearancePreferences(value);
      ports.apply({ ...current });
    }
  });
  const write = (value: unknown, initializeOnly: boolean): Promise<AppearancePreferences> => {
    if (!isAppearancePreferences(value)) return Promise.reject(Error('Invalid appearance preference'));
    const next = normalizeAppearancePreferences(value);
    const run = queue.then(async () => {
      if (initializeOnly && current) return { ...current };
      await ports.write(next);
      current = next;
      ports.apply({ ...next });
      ports.publish({ ...next });
      return { ...next };
    });
    queue = run.then(() => undefined, () => undefined);
    return run;
  };
  return {
    async get(): Promise<AppearancePreferences | null> {
      await queue;
      return current ? { ...current } : null;
    },
    set: (value: unknown) => write(value, false),
    initialize: (value: unknown) => write(value, true),
  };
}
