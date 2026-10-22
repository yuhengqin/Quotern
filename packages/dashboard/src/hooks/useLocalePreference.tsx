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
  isLocalePreference,
  resolveLocale,
  setActiveLocale,
  type LocalePreference,
  type SupportedLocale,
} from 'quotern-i18n';
import { ProductI18nProvider } from 'quotern-i18n/react';

const STORAGE_KEY = 'quotern.locale.preference';

interface LocaleContextValue {
  preference: LocalePreference;
  locale: SupportedLocale;
  systemLocale: SupportedLocale;
  setPreference: (preference: LocalePreference) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function readBrowserLocalePreference(): LocalePreference {
  try {
    const value = window.localStorage.getItem(demoStorageKey(STORAGE_KEY));
    return isLocalePreference(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

function browserLanguages(): string[] {
  return navigator.languages?.length ? [...navigator.languages] : [navigator.language];
}

export function browserInitialLocale(): SupportedLocale {
  return resolveLocale(readBrowserLocalePreference(), browserLanguages());
}

export function BrowserLocaleProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LocalePreference>(readBrowserLocalePreference);
  const [languages, setLanguages] = useState(browserLanguages);
  const systemLocale = useMemo(() => resolveLocale('system', languages), [languages]);
  const locale = useMemo(() => resolveLocale(preference, languages), [preference, languages]);

  useEffect(() => {
    const onLanguageChange = () => setLanguages(browserLanguages());
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        setPreferenceState(readBrowserLocalePreference());
      }
    };
    window.addEventListener('languagechange', onLanguageChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('languagechange', onLanguageChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    void setActiveLocale(locale);
  }, [locale]);

  const setPreference = useCallback((next: LocalePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(demoStorageKey(STORAGE_KEY), next);
    } catch {
      // Browsers with disabled storage still retain this choice for the tab.
    }
  }, []);

  const value = useMemo(
    () => ({ preference, locale, systemLocale, setPreference }),
    [preference, locale, systemLocale, setPreference],
  );

  return (
    <LocaleContext.Provider value={value}>
      <ProductI18nProvider locale={locale}>{children}</ProductI18nProvider>
    </LocaleContext.Provider>
  );
}

export function useLocalePreference(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocalePreference must be used within BrowserLocaleProvider');
  return value;
}
import { demoStorageKey } from '../lib/demo-runtime';
