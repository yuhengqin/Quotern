import { Label, Radio, RadioGroup } from '@heroui/react';
import { Check } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import { registerMessages } from 'quotern-i18n';
import { PALETTES, validPalette } from '../lib/palettes';
import { resolveAppearanceTokens } from '../../../../apps/desktop/src/shared/appearance';
import { useAppearance } from './AppearanceProvider';
import './appearance-messages';
import type { Theme } from '../lib/theme';
registerMessages({ 'zh-CN': { 'settings.palette': '强调色' }, en: { 'settings.palette': 'Accent color' }, ja: { 'settings.palette': 'アクセントカラー' }, ko: { 'settings.palette': '강조 색상' } });
export function PaletteControl({ theme }: { theme: Theme }) {
  const { t, i18n } = useTranslation();
  const { preferences, update } = useAppearance();
  const selected = preferences.palette;
  const recommended = resolveAppearanceTokens({ style: preferences.style, palette: 'theme' }, theme)['--accent'] ?? (theme === 'light' ? '#0485f7' : '#48a7ff');
  const showChineseNames = (i18n.resolvedLanguage ?? '').startsWith('zh');

  const selectPalette = (value: string) => {
    if (value === 'theme' || validPalette(value)) update({ palette: value });
  };

  return (
    <RadioGroup name="accent-palette" value={selected} variant="secondary" onChange={selectPalette}>
      <Label>{t('settings.palette')}</Label>
      <div className="appearance-options">
        <Radio value="theme"><Radio.Content className="appearance-option appearance-option--palette">
          <span aria-hidden="true" className="appearance-palette-swatch" style={{ backgroundColor: recommended }} />
          <span>{t('appearance.recommended')}</span><Check aria-hidden="true" className="appearance-option-check" />
        </Radio.Content></Radio>
        {PALETTES.map(([id, name, light, dark]) => {
          const names = name.split(' · ');
          return (
            <Radio key={id} value={id}>
              <Radio.Content className="appearance-option appearance-option--palette">
                <span
                  aria-hidden="true"
                  className="appearance-palette-swatch"
                  data-theme={id === 'default' ? 'default' : undefined}
                  style={{ backgroundColor: (theme === 'dark' ? dark : light) || (theme === 'light' ? '#0485f7' : '#48a7ff') }}
                />
                <span title={showChineseNames && names.length > 1 ? name : undefined}>
                  {showChineseNames ? names[0] : names.at(-1)}
                </span>
                <Check aria-hidden="true" className="appearance-option-check" />
              </Radio.Content>
            </Radio>
          );
        })}
      </div>
    </RadioGroup>
  );
}
