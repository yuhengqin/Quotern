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
  const resolveState = (preference: LocalePreference): DesktopLocaleState => {
    const languages = options.preferredLanguages();
    return {
      preference,
      resolved: options.resolve(preference, languages),
      systemLocale: options.resolve('system', languages),
    };
  };
  let state: DesktopLocaleState = { preference: 'system', resolved: 'zh-CN', systemLocale: 'zh-CN' };
  let pending: Promise<unknown> = Promise.resolve();

  const broadcast = () => options.broadcast({ ...state });

  return {
    async initialize(): Promise<void> {
      const preference = await options.readPreference();
      state = resolveState(preference);
    },
    getState(): DesktopLocaleState {
      return { ...state };
    },
    setPreference(preference: LocalePreference): Promise<void> {
      const run = pending.then(async () => {
        if (preference === state.preference) return;
        await options.writePreference(preference);
        state = resolveState(preference);
        broadcast();
      });
      pending = run.then(() => undefined, () => undefined);
      return run;
    },
    refreshSystem(): void {
      const next = resolveState(state.preference);
      if (next.resolved === state.resolved && next.systemLocale === state.systemLocale) return;
      state = next;
      broadcast();
    },
  };
}
