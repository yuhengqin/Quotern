import { translate, type SupportedLocale } from 'quotern-i18n';
import type { SessionActivity } from 'quotern-core';

export const serviceLabel = (value: string, locale: SupportedLocale) => {
  const key = ({ unknown: 'usage.activity.attributionUnknown', mixed: 'usage.activity.multipleChannels' } as Record<string, string>)[value];
  return key ? translate(locale, key) : ({ openai: 'OpenAI', anthropic: 'Anthropic', xai: 'xAI', opencode: 'OpenCode' } as Record<string, string>)[value] ?? value;
};
export const modeLabel = (value: string, locale: SupportedLocale) => value === 'api' ? 'API'
  : translate(locale, value === 'subscription' ? 'usage.activity.subscription' : 'usage.activity.billingUnknown');
export const costLabel = (value: string, locale: SupportedLocale) => translate(locale, ({
  recorded: 'usage.activity.sourceRecorded', estimated: 'usage.activity.priceEstimate',
  mixed: 'usage.activity.costMixed', unknown: 'usage.activity.amountUnknown',
} as Record<string, string>)[value] ?? 'usage.activity.amountUnknown');
export function accountLabel(row: Pick<SessionActivity['billing'], 'accountRef' | 'accountLabel'>, locale: SupportedLocale, unknownKey = 'usage.activity.accountUnknown') {
  return row.accountRef ? [row.accountLabel, translate(locale, 'usage.activity.accountRef', { ref: row.accountRef.slice(0, 8) })].filter(Boolean).join(' · ')
    : translate(locale, unknownKey);
}
