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
export const validPalette = (value: unknown): value is PaletteId => PALETTES.some(row => row[0] === value);
