import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { demoStorageKey } from '../lib/demo-runtime';
import { isAppearancePreferences, normalizeAppearancePreferences, resolveAppearanceTokens, type AppearanceBridge, type AppearancePreferences } from '../../../../apps/desktop/src/shared/appearance';
import './appearance-themes.css';
import { AppearanceDecorations } from './AppearanceDecorations';

interface AppearanceContextValue {
  preferences: AppearancePreferences;
  update: (patch: Partial<AppearancePreferences>) => void;
  saveError: boolean;
  retry: () => void;
}
const AppearanceContext = createContext<AppearanceContextValue | null>(null);
const storageKey = () => demoStorageKey('quotern-appearance');
const legacyKey = () => demoStorageKey('quotern-palette');
function readLocalAppearance(): AppearancePreferences {
  try {
    const raw = localStorage.getItem(storageKey());
    return normalizeAppearancePreferences(raw ? JSON.parse(raw) : null, localStorage.getItem(legacyKey()));
  } catch { return normalizeAppearancePreferences(null); }
}
function writeLocalAppearance(value: AppearancePreferences): void {
  localStorage.setItem(legacyKey(), value.palette);
  localStorage.setItem(storageKey(), JSON.stringify(value));
  window.dispatchEvent(new Event('quotern:palette-changed'));
}

export function AppearanceProvider({ children, theme, bridge, initialPreferences }: { children: ReactNode; theme: 'light' | 'dark'; bridge?: AppearanceBridge; initialPreferences?: AppearancePreferences | null }) {
  const [preferences, setPreferences] = useState(() => initialPreferences ?? readLocalAppearance());
  const [saveError, setSaveError] = useState(false);
  const current = useRef(preferences), intent = useRef(0), pending = useRef(0), remoteEpoch = useRef(0), mounted = useRef(true);
  const managedTokens = useRef<string[]>([]);
  const applySnapshot = useCallback((value: AppearancePreferences) => { current.current = value; setPreferences(value); }, []);
  const persist = useCallback(async (next: AppearancePreferences, revision: number, initializeOnly = false) => {
    pending.current++;
    let saved = false;
    try {
      const result = bridge ? await (initializeOnly ? bridge.initializeAppearance(next) : bridge.setAppearance(next)) : (writeLocalAppearance(next), next);
      saved = true;
      if (mounted.current && revision === intent.current) { applySnapshot(result); setSaveError(false); }
    } catch {
      if (mounted.current && revision === intent.current) setSaveError(true);
    } finally {
      pending.current--;
      // Another window may have saved while this window had a local draft.
      if (bridge && saved && pending.current === 0 && mounted.current) {
        const epoch = remoteEpoch.current, latestIntent = intent.current;
        try {
          const latest = await bridge.getAppearance();
          if (mounted.current && pending.current === 0 && epoch === remoteEpoch.current && latestIntent === intent.current && isAppearancePreferences(latest)) applySnapshot(latest);
        } catch { /* A successful write remains applied until a later event resyncs. */ }
      }
    }
  }, [bridge, applySnapshot]);
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    if (bridge) {
      const startingIntent = intent.current, startingEpoch = remoteEpoch.current;
      const unsubscribe = bridge.onAppearanceChanged(value => {
        remoteEpoch.current++;
        if (pending.current === 0) { applySnapshot(value); setSaveError(false); }
      });
      void bridge.getAppearance().then(value => {
        if (disposed || startingIntent !== intent.current || startingEpoch !== remoteEpoch.current) return;
        if (isAppearancePreferences(value)) applySnapshot(value);
        else void persist(current.current, startingIntent, true);
      }).catch(() => { if (!disposed) setSaveError(true); });
      return () => { disposed = true; mounted.current = false; unsubscribe(); };
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === storageKey() || event.key === legacyKey()) { applySnapshot(readLocalAppearance()); setSaveError(false); }
    };
    window.addEventListener('storage', onStorage);
    return () => { mounted.current = false; window.removeEventListener('storage', onStorage); };
  }, [bridge, applySnapshot, persist]);
  useLayoutEffect(() => {
    const root = document.documentElement, tokens = resolveAppearanceTokens(preferences, theme);
    for (const name of managedTokens.current) if (!(name in tokens)) root.style.removeProperty(name);
    for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
    managedTokens.current = Object.keys(tokens);
    root.dataset.appearance = preferences.style;
    root.dataset.palette = preferences.palette;
  }, [preferences, theme]);
  useLayoutEffect(() => () => {
    for (const name of managedTokens.current) document.documentElement.style.removeProperty(name);
    managedTokens.current = [];
  }, []);
  const update = useCallback((patch: Partial<AppearancePreferences>) => {
    const next = normalizeAppearancePreferences({ ...current.current, ...patch }), revision = ++intent.current;
    applySnapshot(next); setSaveError(false); void persist(next, revision);
  }, [applySnapshot, persist]);
  const retry = useCallback(() => { void persist(current.current, ++intent.current); }, [persist]);
  return <AppearanceContext.Provider value={{ preferences, update, saveError, retry }}>{children}<AppearanceDecorations style={preferences.style} enabled={preferences.decorations === true} bridge={bridge} onStop={() => update({ decorations: false })} saveError={saveError} retry={retry} /></AppearanceContext.Provider>;
}
export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) throw Error('useAppearance must be used within AppearanceProvider');
  return value;
}
