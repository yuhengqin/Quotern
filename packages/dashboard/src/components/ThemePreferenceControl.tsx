import { Label, Radio, RadioGroup } from '@heroui/react';
import { Check } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import { isThemeMode, type Theme, type ThemeMode } from '../lib/theme';
import { PaletteControl } from './PaletteControl';
import './appearance-preferences.css';

const OPTIONS: readonly ThemeMode[] = ['system', 'light', 'dark'];

function ModePreview({ mode }: { mode: ThemeMode }) {
  const themes: readonly Theme[] = mode === 'system' ? ['light', 'dark'] : [mode];

  return (
    <span aria-hidden="true" className="appearance-mode-preview">
      {themes.map(theme => (
        <span className="appearance-mode-preview-pane" data-theme={theme} key={theme}>
          <span />
        </span>
      ))}
    </span>
  );
}

/** Shared selector; each renderer owns theme resolution and persistence. */
export function ThemePreferenceControl({
  value,
  theme,
  onChange,
}: {
  value: ThemeMode;
  theme: Theme;
  onChange: (value: ThemeMode) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <RadioGroup
        className="appearance-mode-group"
        name="theme-preference"
        value={value}
        variant="secondary"
        onChange={next => {
          if (isThemeMode(next)) onChange(next);
        }}
      >
        <Label>{t('settings.appearance.label')}</Label>
        <div className="appearance-options appearance-options--modes">
          {OPTIONS.map(mode => (
            <Radio key={mode} value={mode}>
              <Radio.Content className="appearance-option appearance-option--mode">
                <ModePreview mode={mode} />
                <span className="appearance-mode-caption">
                  <span>{t(`shell.theme.${mode}`)}</span>
                  <Check aria-hidden="true" className="appearance-option-check" />
                </span>
              </Radio.Content>
            </Radio>
          ))}
        </div>
      </RadioGroup>
      <PaletteControl theme={theme} />
    </div>
  );
}
