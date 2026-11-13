import { Button, Description, Label, Radio, RadioGroup, Switch } from '@heroui/react';
import { Check } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import { useId, useState, type CSSProperties } from 'react';
import { APPEARANCE_STYLES, appearanceChrome, hasAppearanceDecoration, isAppearanceStyle, resolveAppearanceTokens, type AppearanceStyle } from '../../../../apps/desktop/src/shared/appearance';
import { useAppearance } from './AppearanceProvider';
import './appearance-messages';

function StylePreview({ style, theme }: { style: AppearanceStyle; theme: 'light' | 'dark' }) {
  const tokens = resolveAppearanceTokens({ style, palette: 'theme' }, theme), chrome = appearanceChrome(theme, style);
  const preview = { backgroundColor: chrome.background, color: chrome.foreground,
    '--preview-surface': tokens['--surface'] ?? (theme === 'light' ? '#ffffff' : '#18191b'),
    '--preview-accent': tokens['--accent'] ?? (theme === 'light' ? '#0485f7' : '#48a7ff'),
    '--accent': tokens['--accent'] ?? (theme === 'light' ? '#0485f7' : '#48a7ff'),
    '--appearance-texture': tokens['--appearance-texture'] ?? 'none',
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
  const [expanded, setExpanded] = useState(false);
  const optionsId = useId();
  const visibleStyles = APPEARANCE_STYLES.filter((style, index) => expanded || index < 4 || style === preferences.style);
  return <div>
    <RadioGroup name="appearance-style" value={preferences.style} variant="secondary" onChange={value => { if (isAppearanceStyle(value)) update({ style: value }); }}>
      <Label>{t('appearance.style')}</Label>
      <div id={optionsId} className="appearance-options appearance-options--styles">
        {visibleStyles.map(style => <Radio value={style} key={style}><Radio.Content className="appearance-option appearance-option--style">
          <StylePreview style={style} theme={theme} />
          <span className="appearance-style-caption"><span>{t(`appearance.${style}`)}</span><Check aria-hidden="true" className="appearance-option-check" /></span>
        </Radio.Content></Radio>)}
      </div>
    </RadioGroup>
    <Button data-appearance-more aria-expanded={expanded} aria-controls={optionsId} className="appearance-more-button" size="sm" variant="tertiary" onPress={() => setExpanded(value => !value)}>
      {expanded ? t('appearance.fewer') : t('appearance.more', { count: APPEARANCE_STYLES.length })}
    </Button>
    {hasAppearanceDecoration(preferences.style) && <Switch className="appearance-motion-control" name="appearance-decorations" isSelected={preferences.decorations === true} onChange={decorations => update({ decorations })}>
      <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control><Label>{t('appearance.decorations')}</Label></Switch.Content>
      {preferences.decorations && <Description className="appearance-motion-reduced">{t('appearance.reducedMotion')}</Description>}
    </Switch>}
    {saveError && <div data-appearance-save-error role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-danger">
      <span>{t('appearance.saveFailed')}</span><Button data-appearance-retry size="sm" variant="secondary" onPress={retry}>{t('appearance.retry')}</Button>
    </div>}
  </div>;
}
