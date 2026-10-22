import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useTheme as useHeroUITheme } from '@heroui/react';
import { isThemeMode, type Theme, type ThemeMode } from '@/lib/theme';
import { isDemoMode } from '../lib/demo-runtime';
import { useLocalStorage } from './useLocalStorage';

interface ThemeContextValue {
  /** Resolved theme actually rendered (follows the OS when mode is `system`). */
  theme: Theme;
  /** User's persisted preference (HeroUI's `theme` intent). */
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

/**
 * Single-button cycle order. Kept explicit (not derived from the mode list) so
 * reordering modes can never silently change the UI cycle.
 */
const THEME_MODE_CYCLE: Record<ThemeMode, ThemeMode> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Wraps HeroUI's useTheme as a thin adapter:
 *
 * - HeroUI stores the user's *intent* (`system` | `light` | `dark`) in
 *   localStorage (`heroui-theme`), resolves `system` against the OS
 *   `prefers-color-scheme`, follows live OS changes, and applies the resolved
 *   theme to `<html>` in a layout effect (no first-paint flash). None of that
 *   is reimplemented here.
 * - Default intent is `system` for first-time visitors; visitors who pinned
 *   light/dark under the old two-state toggle keep their pinned choice.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return isDemoMode() ? <DemoThemeProvider>{children}</DemoThemeProvider> : <LocalThemeProvider>{children}</LocalThemeProvider>;
}
function DemoThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeMode] = useLocalStorage<ThemeMode>('heroui-theme', 'system', isThemeMode);
  const media = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
  const dark = useSyncExternalStore(callback => { media.addEventListener('change', callback); return () => media.removeEventListener('change', callback); }, () => media.matches);
  const theme: Theme = themeMode === 'system' ? dark ? 'dark' : 'light' : themeMode;
  useLayoutEffect(() => {
    document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme);
    document.documentElement.setAttribute('data-theme', theme); document.documentElement.style.colorScheme = theme;
  }, [theme]);
  return <ThemeContext.Provider value={{ theme, themeMode, setThemeMode, toggleTheme: () => setThemeMode(THEME_MODE_CYCLE[themeMode]) }}>{children}</ThemeContext.Provider>;
}
function LocalThemeProvider({ children }: { children: ReactNode }) {
  const {
    theme: heroUIThemeIntent,
    resolvedTheme,
    setTheme: setHeroUITheme,
  } = useHeroUITheme('system');
  const theme: Theme = resolvedTheme === 'dark' ? 'dark' : 'light';
  const themeMode: ThemeMode = isThemeMode(heroUIThemeIntent)
    ? heroUIThemeIntent
    : 'system';
  // Seeded from the stored intent so the initial ref never disagrees with the
  // persisted preference; kept in sync by setThemeMode.
  const themeModeRef = useRef<ThemeMode>(themeMode);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    // Keep the ref current so a rapid burst of clicks cycles forward instead
    // of every click reading the same stale state.
    themeModeRef.current = mode;
    setHeroUITheme(mode);
  }, [setHeroUITheme]);

  const toggleTheme = useCallback(() => {
    setThemeMode(THEME_MODE_CYCLE[themeModeRef.current]);
  }, [setThemeMode]);

  const value = useMemo(
    () => ({ theme, themeMode, setThemeMode, toggleTheme }),
    [theme, themeMode, setThemeMode, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
