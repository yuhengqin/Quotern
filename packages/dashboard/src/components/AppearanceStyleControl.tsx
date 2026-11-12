import { Button, Label, Radio, RadioGroup } from '@heroui/react';
import { Check } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import type { CSSProperties } from 'react';
import { APPEARANCE_STYLES, appearanceChrome, isAppearanceStyle, resolveAppearanceTokens, type AppearanceStyle } from '../../../../apps/desktop/src/shared/appearance';
import { useAppearance } from './AppearanceProvider';
import './appearance-messages';

function StylePreview({ style, theme }: { style: AppearanceStyle; theme: 'light' | 'dark' }) {
  const tokens = resolveAppearanceTokens({ style, palette: 'theme' }, theme), chrome = appearanceChrome(theme, style);
  const preview = { backgroundColor: chrome.background, color: chrome.foreground,
    '--preview-surface': tokens['--surface'] ?? (theme === 'light' ? '#ffffff' : '#18191b'),
    '--preview-accent': tokens['--accent'] ?? (theme === 'light' ? '#0485f7' : '#48a7ff'),
  } as CSSProperties;
  return <span aria-hidden="true" className="appearance-style-preview" data-style={style} style={preview}>
    <span className="appearance-style-preview-heading" />
    <span className="appearance-style-preview-card"><span /><span /></span>
    <span className="appearance-style-preview-card"><span /><span /></span>
  </span>;
}
export function AppearanceStyleControl({ theme }: { theme: 'light' | 'dark' }) {
  const { t } = useTranslation();
  const { preferences, update, saveError, retry } = useAppearance();
  return <div>
    <RadioGroup name="appearance-style" value={preferences.style} variant="secondary" onChange={value => { if (isAppearanceStyle(value)) update({ style: value }); }}>
      <Label>{t('appearance.style')}</Label>
      <div className="appearance-options appearance-options--styles">
        {APPEARANCE_STYLES.map(style => <Radio value={style} key={style}><Radio.Content className="appearance-option appearance-option--style">
          <StylePreview style={style} theme={theme} />
          <span className="appearance-style-caption"><span>{t(`appearance.${style}`)}</span><Check aria-hidden="true" className="appearance-option-check" /></span>
        </Radio.Content></Radio>)}
      </div>
    </RadioGroup>
    {saveError && <div data-appearance-save-error role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-danger">
      <span>{t('appearance.saveFailed')}</span><Button data-appearance-retry size="sm" variant="secondary" onPress={retry}>{t('appearance.retry')}</Button>
    </div>}
  </div>;
}
