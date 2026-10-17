import { Label, Radio, RadioGroup } from '@heroui/react';
import { isLocalePreference, type LocalePreference } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';

const OPTIONS: LocalePreference[] = ['system', 'zh-CN', 'en', 'ja', 'ko'];

export function LanguagePreferenceControl({
  value,
  onChange,
  isDisabled,
}: {
  value: LocalePreference;
  onChange: (value: LocalePreference) => void;
  isDisabled?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <RadioGroup
      name="locale-preference"
      value={value}
      variant="secondary"
      isDisabled={isDisabled}
      onChange={(next) => {
        if (isLocalePreference(next)) onChange(next);
      }}
    >
      <Label>{t('settings.language.label')}</Label>
      {OPTIONS.map((option) => (
        <Radio key={option} value={option}>
          <Radio.Content>
            <Radio.Control><Radio.Indicator /></Radio.Control>
            {t(`settings.language.${option}`)}
          </Radio.Content>
        </Radio>
      ))}
    </RadioGroup>
  );
}
