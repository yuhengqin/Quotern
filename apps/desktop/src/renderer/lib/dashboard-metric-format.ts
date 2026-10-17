import type { DashboardChartMetric } from '@/lib/dashboard-mock-data';
import { formatTokens, formatUsd } from '@/lib/format';
import { i18n, normalizeLocale, translate, type SupportedLocale } from 'quotern-i18n';

export function formatDashboardMetric(
  metric: DashboardChartMetric,
  value: number,
  locale: SupportedLocale = normalizeLocale(i18n.resolvedLanguage),
) {
  if (metric === 'tokens') return formatTokens(value);
  if (metric === 'cost') return formatUsd(value);
  return formatDashboardDuration(value, locale);
}

export function formatDashboardMetricCompact(
  metric: DashboardChartMetric,
  value: number,
  locale: SupportedLocale = normalizeLocale(i18n.resolvedLanguage),
) {
  if (metric === 'tokens') return formatTokens(value);
  if (metric === 'cost') {
    return value >= 10 ? `$${value.toFixed(0)}` : `$${value.toFixed(1)}`;
  }

  const minutes = Math.round(value);
  if (minutes < 60) return translate(locale, 'desktop.duration.compactMinutes', { count: minutes });
  const number = (amount: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(amount);
  if (minutes < 1_440) return translate(locale, 'desktop.duration.compactHours', { count: number(minutes / 60) });
  return translate(locale, 'desktop.duration.compactDays', { count: number(minutes / 1_440) });
}

export function formatDashboardDuration(value: number, locale: SupportedLocale = normalizeLocale(i18n.resolvedLanguage)) {
  const minutes = Math.round(value);
  if (minutes < 60) return translate(locale, 'desktop.duration.minutes', { count: minutes });

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0
    ? translate(locale, 'desktop.duration.hours', { count: hours })
    : translate(locale, 'desktop.duration.hoursMinutes', { hours, minutes: remainder });
}
