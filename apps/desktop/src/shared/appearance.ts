/** Browser-safe visual preferences shared by the browser, Electron and preload. */
export const APPEARANCE_STYLES = [
  'default', 'catppuccin', 'win95', 'newspaper', 'classic', 'matrix', 'cloud_observation',
  'aquarium', 'prism_arcade', 'stained_glass', 'migration', 'sketchbook', 'heart_monitor',
  'origami', 'black_hole', 'lepidoptera', 'world_cup',
] as const;
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
export interface AppearancePreferences { style: AppearanceStyle; palette: AppearancePalette; decorations?: boolean }
export const DEFAULT_APPEARANCE: AppearancePreferences = { style: 'default', palette: 'theme' };
export const APPEARANCE_GET_CHANNEL = 'appearance:get';
export const APPEARANCE_SET_CHANNEL = 'appearance:set';
export const APPEARANCE_INITIALIZE_CHANNEL = 'appearance:initialize';
export const APPEARANCE_CHANGED_CHANNEL = 'appearance:changed';
export const APPEARANCE_VISIBILITY_CHANNEL = 'appearance:visibility';
export const APPEARANCE_WATCH_VISIBILITY_CHANNEL = 'appearance:watch-visibility';
export const APPEARANCE_UNWATCH_VISIBILITY_CHANNEL = 'appearance:unwatch-visibility';
export interface AppearanceBridge {
  getAppearance: () => Promise<AppearancePreferences | null>;
  setAppearance: (value: AppearancePreferences) => Promise<AppearancePreferences>;
  initializeAppearance: (value: AppearancePreferences) => Promise<AppearancePreferences>;
  onAppearanceChanged: (callback: (value: AppearancePreferences) => void) => () => void;
  onAppearanceVisibilityChanged?: (callback: (visible: boolean) => void) => () => void;
}

export const DECORATED_APPEARANCE_STYLES = ['matrix', 'cloud_observation', 'aquarium', 'prism_arcade', 'stained_glass', 'migration', 'heart_monitor', 'origami', 'black_hole', 'lepidoptera', 'world_cup'] as const satisfies readonly AppearanceStyle[];
export type DecoratedAppearanceStyle = typeof DECORATED_APPEARANCE_STYLES[number];
export const hasAppearanceDecoration = (style: AppearanceStyle): style is DecoratedAppearanceStyle => DECORATED_APPEARANCE_STYLES.some(value => value === style);

export const isAppearanceStyle = (value: unknown): value is AppearanceStyle =>
  APPEARANCE_STYLES.some(style => style === value);
export const validPalette = (value: unknown): value is PaletteId => PALETTES.some(row => row[0] === value);
const validAccent = (value: unknown): value is AppearancePalette => value === 'theme' || validPalette(value);
export function isAppearancePreferences(value: unknown): value is AppearancePreferences {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return isAppearanceStyle(candidate.style) && validAccent(candidate.palette)
    && (candidate.decorations === undefined || typeof candidate.decorations === 'boolean');
}
export function normalizeAppearancePreferences(value: unknown, legacyPalette?: unknown): AppearancePreferences {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    style: isAppearanceStyle(candidate.style) ? candidate.style : 'default',
    palette: validAccent(candidate.palette) ? candidate.palette : validPalette(legacyPalette) ? legacyPalette : 'theme',
    ...(typeof candidate.decorations === 'boolean' ? { decorations: candidate.decorations } : {}),
  };
}

type Tokens = Record<string, string>;
interface PresetColors {
  background: string; foreground: string; surface: string; secondary: string; overlay: string;
  muted: string; border: string; accent: string; accentForeground: string;
  success: string; warning: string; danger: string;
}
// The additional presets share status semantics; their materials never encode usage data.
function colors(mode: ColorMode, background: string, foreground: string, surface: string, secondary: string, muted: string, border: string, accent: string): PresetColors {
  return { background, foreground, surface, secondary, overlay: surface, muted, border, accent,
    accentForeground: mode === 'light' ? '#ffffff' : '#10151c',
    ...(mode === 'light' ? { success: '#23623c', warning: '#825000', danger: '#ad283c' } : { success: '#98dfb1', warning: '#f4ce87', danger: '#ffb1bb' }),
  };
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
  classic: {
    light: colors('light', '#eaf0f6', '#243447', '#f8fbff', '#dfe8f3', '#485d70', '#9daec3', '#265d94'),
    dark: colors('dark', '#101923', '#e7eef8', '#1c2a39', '#29394c', '#b5c5d9', '#637792', '#9fcaff'),
  },
  matrix: {
    light: colors('light', '#e9f3eb', '#113c24', '#f4fbf5', '#d9e9de', '#396247', '#84a78e', '#136336'),
    dark: colors('dark', '#07130e', '#b6f5c9', '#0d2117', '#173423', '#93c9a4', '#3d7753', '#79efa0'),
  },
  cloud_observation: {
    light: colors('light', '#e6f0f6', '#263e51', '#f5fbff', '#dceaf3', '#4b667b', '#98b3c7', '#295e85'),
    dark: colors('dark', '#152535', '#e0edf9', '#20364b', '#2a445a', '#b1c9dd', '#6b8ca3', '#a1d7fa'),
  },
  aquarium: {
    light: colors('light', '#e2f1f1', '#163f49', '#f1fbf9', '#cce6e5', '#38636d', '#79a8b1', '#00666a'),
    dark: colors('dark', '#061e2b', '#d2f4f0', '#0e2d3b', '#18414b', '#a0ccd0', '#4b7d89', '#79dfd3'),
  },
  prism_arcade: {
    light: colors('light', '#f0eaf8', '#39274f', '#fbf7ff', '#e8ddf2', '#635076', '#ab92c5', '#763298'),
    dark: colors('dark', '#1a102b', '#f5e3ff', '#2a1a3f', '#3b2751', '#d1b6e4', '#89629e', '#efa5e5'),
  },
  stained_glass: {
    light: colors('light', '#ebe9f2', '#2d2949', '#f9f6ff', '#dedbea', '#575273', '#a398b8', '#5a398b'),
    dark: colors('dark', '#171425', '#f1eafa', '#292238', '#393048', '#cabbdc', '#8b729f', '#c5afff'),
  },
  migration: {
    light: colors('light', '#f5e8e4', '#4f2e48', '#fff6ee', '#eedad8', '#704d65', '#b48b98', '#884133'),
    dark: colors('dark', '#2b1743', '#fff0e8', '#3d204e', '#513159', '#deb7d1', '#b47d97', '#ffbc8c'),
  },
  sketchbook: {
    light: colors('light', '#f2eddb', '#34332d', '#fcf8e9', '#e8e1c9', '#625f50', '#9e9882', '#426248'),
    dark: colors('dark', '#272822', '#f2eedc', '#33352e', '#424439', '#c4c1ad', '#93947f', '#c0d39c'),
  },
  heart_monitor: {
    light: colors('light', '#e8f1ec', '#183c2d', '#f4faf6', '#d8e7df', '#3b6350', '#85a894', '#17623f'),
    dark: colors('dark', '#06150f', '#c8f6dc', '#0c251b', '#143c2b', '#9ed1b4', '#408065', '#80edb2'),
  },
  origami: {
    light: colors('light', '#f4f1e9', '#14324a', '#e5f0f7', '#d3e4ef', '#3d5e74', '#7c9db4', '#225d87'),
    dark: colors('dark', '#17232d', '#e0ecf5', '#243747', '#30495b', '#b7cbd9', '#7799af', '#9bccec'),
  },
  black_hole: {
    light: colors('light', '#f3e9e1', '#442e27', '#fff8f0', '#ead8c7', '#6e4e3b', '#b18a6f', '#8c421d'),
    dark: colors('dark', '#100e16', '#f9eadb', '#251d25', '#392c35', '#d9bfa9', '#936c61', '#ffc080'),
  },
  lepidoptera: {
    light: colors('light', '#e5edf3', '#203d54', '#f4f9fd', '#d6e4ee', '#43637a', '#89a7bd', '#2c5c85'),
    dark: colors('dark', '#0b2841', '#e7f1fb', '#10314e', '#1c425f', '#b0d0e6', '#6b9ebc', '#91ccff'),
  },
  world_cup: {
    light: colors('light', '#e5eee1', '#213e2c', '#f5f9ec', '#d8e5cd', '#47604b', '#91aa85', '#31623a'),
    dark: colors('dark', '#10291c', '#f0f3db', '#1a3827', '#2b4b34', '#c0d1af', '#7c9e6c', '#e4ce86'),
  },
};

const line = (color: string, size: number) => `repeating-linear-gradient(0deg, ${color} 0 1px, transparent 1px ${size}px), repeating-linear-gradient(90deg, ${color} 0 1px, transparent 1px ${size}px)`;
const soft = (percent: number) => `color-mix(in srgb, var(--accent) ${percent}%, transparent)`;
/** Restrained surface motifs, also reused by static picker previews. */
const MATERIALS: Partial<Record<AppearanceStyle, string>> = {
  classic: `linear-gradient(145deg, ${soft(6)}, transparent 45%)`,
  matrix: line(soft(5), 22),
  cloud_observation: `radial-gradient(ellipse at 15% 0%, ${soft(10)}, transparent 50%), radial-gradient(ellipse at 95% 100%, ${soft(6)}, transparent 45%)`,
  aquarium: `radial-gradient(ellipse at 80% 0%, ${soft(12)}, transparent 55%), linear-gradient(170deg, transparent 65%, ${soft(6)})`,
  prism_arcade: `linear-gradient(125deg, ${soft(10)}, transparent 25% 70%, color-mix(in srgb, #25bcbc 7%, transparent))`,
  stained_glass: `conic-gradient(from 125deg at 100% 0%, ${soft(13)} 0 30deg, transparent 30deg 55deg, color-mix(in srgb, #c26e89 8%, transparent) 55deg 90deg, transparent 90deg 360deg)`,
  migration: `${line(soft(6), 36)}, radial-gradient(ellipse at 0% 0%, color-mix(in srgb, #f3a475 8%, transparent), transparent 55%)`,
  sketchbook: line(soft(7), 24),
  heart_monitor: line(soft(6), 16),
  origami: `linear-gradient(135deg, transparent calc(100% - 24px), ${soft(16)} calc(100% - 24px))`,
  black_hole: `radial-gradient(ellipse at 100% 0%, ${soft(12)}, transparent 45%), radial-gradient(ellipse at 0% 100%, color-mix(in srgb, #9778d5 7%, transparent), transparent 40%)`,
  lepidoptera: line(soft(6), 32),
  world_cup: `repeating-linear-gradient(90deg, transparent 0 48px, ${soft(4)} 48px 96px)`,
};

function rgbChannels(hex: string): number[] {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}

function luminance(rgb: number[]): number {
  const linear = rgb.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function readableQuotaAccent(accent: string, surfaces: string[], mode: ColorMode): string {
  const channels = rgbChannels(accent);
  const backgrounds = surfaces.map(surface => luminance(rgbChannels(surface)));
  const endpoint = mode === 'dark' ? 255 : 0;
  for (let percent = 0; percent <= 100; percent++) {
    const shade = channels.map(channel => Math.round(channel + (endpoint - channel) * percent / 100));
    const light = luminance(shade);
    // Leave a little room for the accent-tinted hover and focused backgrounds.
    if (backgrounds.every(background => (Math.max(light, background) + 0.05) / (Math.min(light, background) + 0.05) >= 5)) {
      return percent === 0 ? accent : `#${shade.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return accent;
}

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
      '--radius': ['win95', 'newspaper', 'matrix', 'heart_monitor', 'origami'].includes(style) ? '0rem' : style === 'sketchbook' ? '0.2rem' : '0.6rem',
      '--appearance-texture': MATERIALS[style] ?? 'none',
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
    } else if (['newspaper', 'migration', 'lepidoptera'].includes(style)) {
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
  if (style !== 'default' || tokens['--accent']) {
    const surfaces = mode === 'light' ? ['#efeff0', '#ffffff'] : ['#222227', '#18181b'];
    tokens['--quota-accent'] = readableQuotaAccent(tokens['--accent'] ?? '#0485f7',
      [tokens['--surface-secondary'] ?? surfaces[0], tokens['--overlay'] ?? surfaces[1]], mode);
  }
  return tokens;
}

export function appearanceChrome(mode: ColorMode, style: AppearanceStyle): { background: string; foreground: string } {
  return style === 'default'
    ? { background: mode === 'dark' ? '#050607' : '#f5f5f5', foreground: mode === 'dark' ? '#d7dce2' : '#1f2328' }
    : { background: COLORS[style][mode].background, foreground: COLORS[style][mode].foreground };
}
