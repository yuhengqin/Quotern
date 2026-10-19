import type { LocalePreference, SupportedLocale } from 'quotern-i18n';

export const LOCALE_GET_CHANNEL = 'locale:get';
export const LOCALE_SET_CHANNEL = 'locale:set';
export const LOCALE_CHANGED_CHANNEL = 'locale:changed';

export interface DesktopLocaleState {
  preference: LocalePreference;
  resolved: SupportedLocale;
  systemLocale: SupportedLocale;
}
