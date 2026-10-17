import { createInstance } from 'i18next';
import { SUPPORTED_LOCALES, type SupportedLocale } from './locale.js';

export { normalizeLocale, isLocalePreference, resolveLocale } from './locale.js';
export type { SupportedLocale, LocalePreference } from './locale.js';

const bundledMessages: Record<SupportedLocale, Record<string, string>> = {
  'zh-CN': {
    'locale.system': '跟随系统',
    'locale.zh-CN': '简体中文',
    'locale.en': 'English',
    'locale.ja': '日本語',
    'locale.ko': '한국어',
  },
  en: {
    'locale.system': 'Follow system',
    'locale.zh-CN': '简体中文',
    'locale.en': 'English',
    'locale.ja': '日本語',
    'locale.ko': '한국어',
  },
  ja: {
    'locale.system': 'システムに合わせる',
    'locale.zh-CN': '简体中文',
    'locale.en': 'English',
    'locale.ja': '日本語',
    'locale.ko': '한국어',
  },
  ko: {
    'locale.system': '시스템 설정 따르기',
    'locale.zh-CN': '简体中文',
    'locale.en': 'English',
    'locale.ja': '日本語',
    'locale.ko': '한국어',
  },
};

export const i18n = createInstance();

void i18n.init({
  resources: Object.fromEntries(SUPPORTED_LOCALES.map(locale => [locale, { translation: bundledMessages[locale] }])),
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  supportedLngs: [...SUPPORTED_LOCALES],
  ns: ['translation'],
  defaultNS: 'translation',
  initAsync: false,
  keySeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function registerMessages(messages: Record<SupportedLocale, Record<string, string>>): void {
  for (const locale of SUPPORTED_LOCALES) {
    i18n.addResourceBundle(locale, 'translation', messages[locale], true, true);
  }
}

export function translate(locale: SupportedLocale, key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, { ...options, lng: locale }) as string;
}

export async function setActiveLocale(locale: SupportedLocale): Promise<void> {
  if (i18n.language !== locale) await i18n.changeLanguage(locale);
}
