import { useLayoutEffect, useReducer, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { I18nProvider } from 'react-aria';
import { i18n, setActiveLocale, type SupportedLocale } from './index.js';

export { useTranslation } from 'react-i18next';

export function ProductI18nProvider({ locale, children }: { locale: SupportedLocale; children: ReactNode }) {
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const renderedLanguage = i18n.language;

  useLayoutEffect(() => {
    let current = true;
    void setActiveLocale(locale).then(() => {
      // The first change can finish before descendant hooks subscribe to languageChanged.
      if (current && renderedLanguage !== locale) refresh();
    });
    return () => { current = false; };
  }, [locale, renderedLanguage]);

  return (
    <I18nextProvider i18n={i18n}>
      <I18nProvider locale={locale}>{children}</I18nProvider>
    </I18nextProvider>
  );
}
