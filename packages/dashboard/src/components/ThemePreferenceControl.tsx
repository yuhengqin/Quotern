import { Label, Radio, RadioGroup } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { isThemeMode, type ThemeMode } from '../lib/theme';

const OPTIONS: readonly ThemeMode[] = ['system', 'light', 'dark'];

/** Shared selector; each renderer owns theme resolution and persistence. */
export function ThemePreferenceControl({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (value: ThemeMode) => void;
}) {
  const { t } = useTranslation();

  return (
    <RadioGroup
      name="theme-preference"
      value={value}
      variant="secondary"
      onChange={(next) => {
        if (isThemeMode(next)) onChange(next);
      }}
    >
      <Label>{t('settings.appearance.label')}</Label>
      {OPTIONS.map((mode) => (
        <Radio key={mode} value={mode}>
          <Radio.Content>
            <Radio.Control><Radio.Indicator /></Radio.Control>
            {t(`shell.theme.${mode}`)}
          </Radio.Content>
        </Radio>
      ))}
    </RadioGroup>
  );
}
