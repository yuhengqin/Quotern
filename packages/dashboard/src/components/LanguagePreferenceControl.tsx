import { Label, Radio, RadioGroup } from '@heroui/react';
import { isLocalePreference, type LocalePreference, type SupportedLocale } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';

const OPTIONS: SupportedLocale[] = ['zh-CN', 'en', 'ja', 'ko'];

export function LanguagePreferenceControl({
  value,
  systemLocale,
  onChange,
  isDisabled,
}: {
  value: LocalePreference;
  systemLocale: SupportedLocale;
  onChange: (value: LocalePreference) => void;
  isDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const enableSystemForSelectedOption = (target: EventTarget) => {
    // A saved fixed locale may already select this row. RadioGroup skips
    // onChange for it, so explicit activation must still enable system mode.
    const input = target instanceof HTMLElement
      ? target.closest('label')?.querySelector('input')
      : null;
    if (!isDisabled && value === systemLocale && input?.value === systemLocale) {
      onChange('system');
    }
  };

  return (
    <div
      onClickCapture={(event) => enableSystemForSelectedOption(event.target)}
      onKeyUpCapture={(event) => {
        if (event.key === ' ') enableSystemForSelectedOption(event.target);
      }}
    >
      <RadioGroup
        name="locale-preference"
        value={value === 'system' ? systemLocale : value}
        variant="secondary"
        isDisabled={isDisabled}
        onChange={(next) => {
          if (isLocalePreference(next)) onChange(next === systemLocale ? 'system' : next);
        }}
      >
        <Label>{t('settings.language.label')}</Label>
        {OPTIONS.map((option) => (
          <Radio key={option} value={option}>
            <Radio.Content>
              <Radio.Control><Radio.Indicator /></Radio.Control>
              {option === systemLocale
                ? t('settings.language.system', { language: t(`settings.language.${option}`) })
                : t(`settings.language.${option}`)}
            </Radio.Content>
          </Radio>
        ))}
      </RadioGroup>
    </div>
  );
}
