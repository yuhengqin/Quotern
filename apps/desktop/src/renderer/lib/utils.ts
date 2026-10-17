import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { i18n, normalizeLocale } from 'quotern-i18n';

const TOKEN_COUNT_UNITS = [
  { value: 1_000_000_000_000, suffix: 'T' },
  { value: 1_000_000_000, suffix: 'B' },
  { value: 1_000_000, suffix: 'M' },
  { value: 1_000, suffix: 'K' },
] as const;

const CHINESE_TOKEN_COUNT_UNITS = [
  { value: 1_000_000_000_000, suffix: '万亿' },
  { value: 100_000_000, suffix: '亿' },
  { value: 10_000, suffix: '万' },
] as const;

const TOKEN_UNIT_STORAGE_KEY = 'quotern-token-unit-mode';

export type TokenUnitMode = 'chinese' | 'international';

function displayLocale() {
  return normalizeLocale(i18n.resolvedLanguage ?? i18n.language);
}

function defaultTokenUnitMode(): TokenUnitMode {
  return displayLocale() === 'zh-CN' ? 'chinese' : 'international';
}

export function getTokenUnitMode(): TokenUnitMode {
  try {
    const saved = localStorage.getItem(TOKEN_UNIT_STORAGE_KEY);
    return saved === 'chinese' || saved === 'international' ? saved : defaultTokenUnitMode();
  } catch {
    return defaultTokenUnitMode();
  }
}

export function setTokenUnitMode(mode: TokenUnitMode): void {
  try {
    localStorage.setItem(TOKEN_UNIT_STORAGE_KEY, mode);
  } catch {
    // Private browsing can block storage; the display falls back to Chinese.
  }
}

/**
 * Combine class names with Tailwind-aware conflict resolution.
 * Shared class-name helper for business components and chart primitives.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a potentially large Token count using the UI's saved unit preference.
 *
 * Chinese is the default; the international K/M/B/T style remains selectable.
 */
export function formatCompactTokenCount(
  value: number,
  mode: TokenUnitMode = getTokenUnitMode(),
): string {
  if (!Number.isFinite(value)) return '0';

  const locale = displayLocale();
  if (mode === 'chinese') return formatChineseTokenCount(value, locale);

  const absoluteValue = Math.abs(value);
  const unitIndex = TOKEN_COUNT_UNITS.findIndex(
    (unit) => absoluteValue >= unit.value,
  );

  if (unitIndex === -1) {
    return Math.round(value).toLocaleString(locale);
  }

  let selectedIndex = unitIndex;
  let unit = TOKEN_COUNT_UNITS[selectedIndex];
  let scaledValue = roundCompactValue(value / unit.value);

  if (
    Math.abs(scaledValue) >= 1_000 &&
    selectedIndex > 0
  ) {
    selectedIndex -= 1;
    unit = TOKEN_COUNT_UNITS[selectedIndex];
    scaledValue = roundCompactValue(value / unit.value);
  }

  return `${scaledValue.toLocaleString(locale, {
    maximumFractionDigits: 1,
  })}${unit.suffix}`;
}

function formatChineseTokenCount(value: number, locale: string): string {
  const absoluteValue = Math.abs(value);
  const unitIndex = CHINESE_TOKEN_COUNT_UNITS.findIndex(
    (unit) => absoluteValue >= unit.value,
  );
  if (unitIndex === -1) return Math.round(value).toLocaleString(locale);

  let selectedIndex = unitIndex;
  let unit = CHINESE_TOKEN_COUNT_UNITS[selectedIndex];
  let scaledValue = Number((value / unit.value).toPrecision(4));
  if (Math.abs(scaledValue) >= 10_000 && selectedIndex > 0) {
    selectedIndex -= 1;
    unit = CHINESE_TOKEN_COUNT_UNITS[selectedIndex];
    scaledValue = Number((value / unit.value).toPrecision(4));
  }

  return `${scaledValue.toLocaleString(locale, {
    maximumSignificantDigits: 4,
  })}${unit.suffix}`;
}

function roundCompactValue(value: number) {
  return Math.round(value * 10) / 10;
}
