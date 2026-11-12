/** Browser-safe visual preferences shared by the browser, Electron and preload. */
export const APPEARANCE_STYLES = ['default', 'catppuccin', 'win95', 'newspaper'] as const;
export type AppearanceStyle = typeof APPEARANCE_STYLES[number];
type ColorMode = 'light' | 'dark';

export const PALETTES = [
  ['default', '天蓝 · Sky Blue', '', ''], ['ocean', '海洋 · Ocean', '#075985', '#7dd3fc'],
  ['cobalt', '钴蓝 · Cobalt', '#1d4ed8', '#93c5fd'], ['indigo', '靛青 · Indigo', '#4338ca', '#a5b4fc'],
  ['violet', '紫罗兰 · Violet', '#6d28d9', '#c4b5fd'], ['plum', '梅紫 · Plum', '#86198f', '#f0abfc'],
  ['rose', '玫瑰 · Rose', '#be123c', '#fda4af'], ['coral', '珊瑚 · Coral', '#b91c1c', '#fca5a5'],
  ['copper', '铜色 · Copper', '#9a3412', '#fdba74'], ['amber', '琥珀 · Amber', '#92400e', '#fcd34d'],
  ['olive', '橄榄 · Olive', '#3f6212', '#bef264'], ['forest', '森林 · Forest', '#166534', '#86efac'],
  ['jade', '翡翠 · Jade', '#065f46', '#6ee7b7'], ['teal', '青绿 · Teal', '#115e59', '#5eead4'],
  ['slate', '岩灰 · Slate', '#334155', '#cbd5e1'], ['graphite', '石墨 · Graphite', '#3f3f46', '#d4d4d8'],
] as const;
export type PaletteId = typeof PALETTES[number][0];
export type AppearancePalette = PaletteId | 'theme';
export interface AppearancePreferences { style: AppearanceStyle; palette: AppearancePalette }
export const DEFAULT_APPEARANCE: AppearancePreferences = { style: 'default', palette: 'theme' };
export const APPEARANCE_GET_CHANNEL = 'appearance:get';
export const APPEARANCE_SET_CHANNEL = 'appearance:set';
export const APPEARANCE_INITIALIZE_CHANNEL = 'appearance:initialize';
export const APPEARANCE_CHANGED_CHANNEL = 'appearance:changed';
export interface AppearanceBridge {
  getAppearance: () => Promise<AppearancePreferences | null>;
  setAppearance: (value: AppearancePreferences) => Promise<AppearancePreferences>;
  initializeAppearance: (value: AppearancePreferences) => Promise<AppearancePreferences>;
  onAppearanceChanged: (callback: (value: AppearancePreferences) => void) => () => void;
}

export const isAppearanceStyle = (value: unknown): value is AppearanceStyle =>
  APPEARANCE_STYLES.some(style => style === value);
export const validPalette = (value: unknown): value is PaletteId => PALETTES.some(row => row[0] === value);
const validAccent = (value: unknown): value is AppearancePalette => value === 'theme' || validPalette(value);
export function isAppearancePreferences(value: unknown): value is AppearancePreferences {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return isAppearanceStyle(candidate.style) && validAccent(candidate.palette);
}
export function normalizeAppearancePreferences(value: unknown, legacyPalette?: unknown): AppearancePreferences {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    style: isAppearanceStyle(candidate.style) ? candidate.style : 'default',
    palette: validAccent(candidate.palette) ? candidate.palette : validPalette(legacyPalette) ? legacyPalette : 'theme',
  };
}

type Tokens = Record<string, string>;
interface PresetColors {
  background: string; foreground: string; surface: string; secondary: string; overlay: string;
  muted: string; border: string; accent: string; accentForeground: string;
  success: string; warning: string; danger: string;
}
const COLORS: Record<Exclude<AppearanceStyle, 'default'>, Record<ColorMode, PresetColors>> = {
  catppuccin: {
    light: { background: '#eff1f5', foreground: '#4c4f69', surface: '#e6e9ef', secondary: '#dce0e8', overlay: '#eff1f5', muted: '#5c5f77', border: '#9ca0b0', accent: '#1e66f5', accentForeground: '#ffffff', success: '#236f37', warning: '#8f5100', danger: '#a91838' },
    dark: { background: '#1e1e2e', foreground: '#cdd6f4', surface: '#313244', secondary: '#45475a', overlay: '#313244', muted: '#bac2de', border: '#6c7086', accent: '#89b4fa', accentForeground: '#11111b', success: '#a6e3a1', warning: '#f9e2af', danger: '#f38ba8' },
  },
  win95: {
    light: { background: '#d4d0c8', foreground: '#151515', surface: '#c0c0c0', secondary: '#dedad2', overlay: '#e8e6df', muted: '#4b4b4b', border: '#707070', accent: '#000080', accentForeground: '#ffffff', success: '#205c32', warning: '#754500', danger: '#a11616' },
    dark: { background: '#22242b', foreground: '#f5f4ed', surface: '#30323a', secondary: '#41444e', overlay: '#30323a', muted: '#c2c4ce', border: '#777c8a', accent: '#9abaff', accentForeground: '#14213d', success: '#94dfac', warning: '#ffd282', danger: '#ffb0a8' },
  },
  newspaper: {
    light: { background: '#eee9df', foreground: '#28231d', surface: '#faf7ef', secondary: '#f1ece1', overlay: '#fffaf1', muted: '#675e50', border: '#a49a88', accent: '#7d2a20', accentForeground: '#fffaf1', success: '#32613e', warning: '#7a4b00', danger: '#a42722' },
    dark: { background: '#201f1b', foreground: '#eee9d9', surface: '#2b2923', secondary: '#363329', overlay: '#302d25', muted: '#bdb29e', border: '#766d5b', accent: '#e4b78a', accentForeground: '#201f1b', success: '#a9d2a2', warning: '#f0c76a', danger: '#ffaaa0' },
  },
};

/** Default returns no tokens: leave the shipped HeroUI/default styles untouched. */
export function resolveAppearanceTokens(preferences: AppearancePreferences, mode: ColorMode): Tokens {
  const { style, palette } = preferences;
  const tokens: Tokens = {};
  if (style !== 'default') {
    const c = COLORS[style][mode];
    Object.assign(tokens, {
      '--background': c.background, '--foreground': c.foreground,
      '--surface': c.surface, '--surface-foreground': c.foreground,
      '--surface-secondary': c.secondary, '--surface-secondary-foreground': c.foreground,
      '--surface-tertiary': c.background, '--surface-tertiary-foreground': c.foreground,
      '--overlay': c.overlay, '--overlay-foreground': c.foreground,
      '--muted': c.muted, '--border': c.border, '--separator': c.border,
      '--default': c.secondary, '--default-foreground': c.foreground,
      '--field-background': c.overlay, '--field-foreground': c.foreground,
      '--field-placeholder': c.muted, '--field-border': c.border,
      '--success': c.success, '--warning': c.warning, '--danger': c.danger,
      '--success-foreground': mode === 'light' ? '#ffffff' : c.background,
      '--warning-foreground': mode === 'light' ? '#ffffff' : c.background,
      '--danger-foreground': mode === 'light' ? '#ffffff' : c.background,
      '--surface-shadow': 'none', '--overlay-shadow': '0 6px 22px rgb(0 0 0 / 22%)',
      '--heatmap-0': 'var(--default)',
      '--heatmap-1': 'color-mix(in oklab, var(--accent) 18%, var(--surface))',
      '--heatmap-2': 'color-mix(in oklab, var(--accent) 38%, var(--surface))',
      '--heatmap-3': 'color-mix(in oklab, var(--accent) 62%, var(--surface))',
      '--heatmap-4': 'var(--accent)',
      '--radius': style === 'catppuccin' ? '0.6rem' : '0rem',
      '--link': 'var(--accent)',
    });
    if (palette === 'theme') {
      tokens['--accent'] = c.accent;
      tokens['--accent-foreground'] = c.accentForeground;
    }
    if (style === 'win95') {
      tokens['--font-dashboard-sans'] = 'Tahoma, "Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif';
      tokens['--appearance-bevel-light'] = mode === 'light' ? '#ffffff' : '#737987';
      tokens['--appearance-bevel-dark'] = mode === 'light' ? '#404040' : '#101117';
      tokens['--appearance-title-background'] = mode === 'light' ? '#000080' : '#263b70';
      tokens['--appearance-title-foreground'] = '#ffffff';
    } else if (style === 'newspaper') {
      tokens['--font-dashboard-sans'] = 'Georgia, "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", SimSun, serif';
    }
  }
  if (palette !== 'theme' && palette !== 'default') {
    const row = PALETTES.find(item => item[0] === palette)!;
    tokens['--accent'] = row[mode === 'dark' ? 3 : 2];
    tokens['--accent-foreground'] = mode === 'dark' ? '#101010' : '#ffffff';
  }
  if (tokens['--accent']) {
    tokens['--focus'] = tokens['--accent'];
    tokens['--accent-soft'] = 'color-mix(in srgb, var(--accent) 14%, transparent)';
    tokens['--accent-soft-foreground'] = tokens['--accent'];
  }
  return tokens;
}

export function appearanceChrome(mode: ColorMode, style: AppearanceStyle): { background: string; foreground: string } {
  return style === 'default'
    ? { background: mode === 'dark' ? '#050607' : '#f5f5f5', foreground: mode === 'dark' ? '#d7dce2' : '#1f2328' }
    : { background: COLORS[style][mode].background, foreground: COLORS[style][mode].foreground };
}
