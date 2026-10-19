import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  setActiveLocale,
  type LocalePreference,
  type SupportedLocale,
} from 'quotern-i18n';
import { ProductI18nProvider } from 'quotern-i18n/react';
import type { DesktopLocaleState } from '../../shared/locale';

export type { DesktopLocaleState } from '../../shared/locale';

interface LocaleContextValue {
  preference: LocalePreference;
  locale: SupportedLocale;
  systemLocale: SupportedLocale;
  setPreference: (preference: LocalePreference) => Promise<void>;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function DesktopLocaleProvider({
  initialState,
  children,
}: {
  initialState: DesktopLocaleState;
  children: ReactNode;
}) {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = window.tud.onLocaleChanged((next) => {
      if (!disposed) setState(next);
    });
    // Re-read after subscribing so a change between startup and this effect
    // cannot leave this window displaying an outdated preference.
    void window.tud.getLocalePreference().then((next) => {
      if (!disposed) setState(next);
    }).catch(() => {
      // Preserve the startup preference when a later IPC read is unavailable.
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useLayoutEffect(() => {
    document.documentElement.lang = state.resolved;
    void setActiveLocale(state.resolved);
  }, [state.resolved]);

  const setPreference = useCallback(async (next: LocalePreference) => {
    await window.tud.setLocalePreference(next);
    setState(await window.tud.getLocalePreference());
  }, []);

  const value = useMemo(
    () => ({ preference: state.preference, locale: state.resolved, systemLocale: state.systemLocale, setPreference }),
    [state, setPreference],
  );

  return (
    <LocaleContext.Provider value={value}>
      <ProductI18nProvider locale={state.resolved}>{children}</ProductI18nProvider>
    </LocaleContext.Provider>
  );
}

export function useLocalePreference(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocalePreference must be used within DesktopLocaleProvider');
  return value;
}
