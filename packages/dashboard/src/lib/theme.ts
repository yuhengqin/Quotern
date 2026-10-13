/**
 * Theme domain for the web dashboard.
 *
 * ThemeMode is the user's preference (an intent persisted by HeroUI's
 * useTheme); Theme is the resolved theme actually rendered. `system` resolves
 * against the browser's prefers-color-scheme and follows it live.
 */

export type Theme = 'light' | 'dark';

export type ThemeMode = 'system' | 'light' | 'dark';

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}
