import type { LocalePreference, SupportedLocale } from 'quotern-i18n';
import type { DesktopLocaleState } from '../shared/locale';

export interface LocaleControllerOptions {
  readPreference(): Promise<LocalePreference>;
  writePreference(preference: LocalePreference): Promise<void>;
  preferredLanguages(): readonly string[];
  resolve(preference: LocalePreference, systemLanguages: readonly string[]): SupportedLocale;
  broadcast(state: DesktopLocaleState): void;
}

/** Persist first, then make the new locale visible to every native surface. */
export function createLocaleController(options: LocaleControllerOptions) {
  let state: DesktopLocaleState = { preference: 'system', resolved: 'zh-CN' };
  let pending: Promise<unknown> = Promise.resolve();

  const broadcast = () => options.broadcast({ ...state });

  return {
    async initialize(): Promise<void> {
      const preference = await options.readPreference();
      state = {
        preference,
        resolved: options.resolve(preference, options.preferredLanguages()),
      };
    },
    getState(): DesktopLocaleState {
      return { ...state };
    },
    setPreference(preference: LocalePreference): Promise<void> {
      const run = pending.then(async () => {
        if (preference === state.preference) return;
        await options.writePreference(preference);
        state = {
          preference,
          resolved: options.resolve(preference, options.preferredLanguages()),
        };
        broadcast();
      });
      pending = run.then(() => undefined, () => undefined);
      return run;
    },
    refreshSystem(): void {
      if (state.preference !== 'system') return;
      const resolved = options.resolve('system', options.preferredLanguages());
      if (resolved === state.resolved) return;
      state = { preference: 'system', resolved };
      broadcast();
    },
  };
}
