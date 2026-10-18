export type SupportedLocale = 'zh-CN' | 'en' | 'ja' | 'ko';
export type LocalePreference = 'system' | SupportedLocale;

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ['zh-CN', 'en', 'ja', 'ko'];

function matchSupportedLocale(input: unknown): SupportedLocale | undefined {
  if (typeof input !== 'string') return undefined;
  const value = input.trim().replace(/[.@].*$/, '').replaceAll('_', '-');
  if (!value) return undefined;

  try {
    const [canonical] = Intl.getCanonicalLocales(value);
    switch (canonical.split('-')[0]?.toLowerCase()) {
      case 'zh': return 'zh-CN';
      case 'en': return 'en';
      case 'ja': return 'ja';
      case 'ko': return 'ko';
      default: return undefined;
    }
  } catch {
    return undefined;
  }
}

export function normalizeLocale(input: unknown): SupportedLocale {
  return matchSupportedLocale(input) ?? 'en';
}

export function isLocalePreference(input: unknown): input is LocalePreference {
  return input === 'system' || SUPPORTED_LOCALES.includes(input as SupportedLocale);
}

export function resolveLocale(preference: LocalePreference, systemLanguages: readonly string[]): SupportedLocale {
  if (preference !== 'system') return preference;
  for (const language of systemLanguages) {
    const match = matchSupportedLocale(language);
    if (match) return match;
  }
  return 'en';
}
