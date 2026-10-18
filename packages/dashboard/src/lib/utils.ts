import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { i18n, normalizeLocale, type SupportedLocale } from 'quotern-i18n';

const TOKEN_COUNT_UNITS = [
  { value: 1_000_000_000_000, suffix: 'T' },
  { value: 1_000_000_000, suffix: 'B' },
  { value: 1_000_000, suffix: 'M' },
  { value: 1_000, suffix: 'K' },
] as const;

const EAST_ASIAN_TOKEN_COUNT_UNITS = {
  'zh-CN': [
    { value: 1_000_000_000_000, suffix: '万亿' },
    { value: 100_000_000, suffix: '亿' },
    { value: 10_000, suffix: '万' },
  ],
  ja: [
    { value: 1_000_000_000_000, suffix: '兆' },
    { value: 100_000_000, suffix: '億' },
    { value: 10_000, suffix: '万' },
  ],
  ko: [
    { value: 1_000_000_000_000, suffix: '조' },
    { value: 100_000_000, suffix: '억' },
    { value: 10_000, suffix: '만' },
  ],
} as const;

const TOKEN_UNIT_STORAGE_KEY = 'quotern-token-unit-mode';

export type TokenUnitMode = 'localized' | 'international';

function displayLocale() {
  return normalizeLocale(i18n.resolvedLanguage ?? i18n.language);
}

export function usesEastAsianTokenUnits(): boolean {
  return displayLocale() !== 'en';
}

export function getTokenUnitMode(): TokenUnitMode {
  try {
    const saved = localStorage.getItem(TOKEN_UNIT_STORAGE_KEY);
    if (saved === 'international') return 'international';
    // Keep the former Chinese choice, but let it follow the current language.
    return 'localized';
  } catch {
    return 'localized';
  }
}

export function setTokenUnitMode(mode: TokenUnitMode): void {
  try {
    localStorage.setItem(TOKEN_UNIT_STORAGE_KEY, mode);
  } catch {
    // Private browsing can block storage; the display follows the current language.
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
 * The localized style follows the interface language; K/M/B/T stays selectable.
 */
export function formatCompactTokenCount(
  value: number,
  mode: TokenUnitMode = getTokenUnitMode(),
): string {
  if (!Number.isFinite(value)) return '0';

  const locale = displayLocale();
  if (mode === 'localized' && locale !== 'en') return formatEastAsianTokenCount(value, locale);

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

function formatEastAsianTokenCount(value: number, locale: Exclude<SupportedLocale, 'en'>): string {
  const units = EAST_ASIAN_TOKEN_COUNT_UNITS[locale];
  const absoluteValue = Math.abs(value);
  const unitIndex = units.findIndex(
    (unit) => absoluteValue >= unit.value,
  );
  if (unitIndex === -1) return Math.round(value).toLocaleString(locale);

  let selectedIndex = unitIndex;
  let unit = units[selectedIndex];
  let scaledValue = Number((value / unit.value).toPrecision(4));
  if (Math.abs(scaledValue) >= 10_000 && selectedIndex > 0) {
    selectedIndex -= 1;
    unit = units[selectedIndex];
    scaledValue = Number((value / unit.value).toPrecision(4));
  }

  return `${scaledValue.toLocaleString(locale, {
    maximumSignificantDigits: 4,
  })}${unit.suffix}`;
}

function roundCompactValue(value: number) {
  return Math.round(value * 10) / 10;
}
