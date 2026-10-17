import type { DashboardChartMetric } from '@/lib/dashboard-mock-data';
import { formatTokens, formatUsd } from '@/lib/format';
import { translate, type SupportedLocale } from 'quotern-i18n';

export function formatDashboardMetric(
  metric: DashboardChartMetric,
  value: number,
  locale: SupportedLocale = 'zh-CN',
) {
  if (metric === 'tokens') return formatTokens(value);
  if (metric === 'cost') return formatUsd(value);
  return formatDashboardDuration(value, locale);
}

export function formatDashboardMetricCompact(
  metric: DashboardChartMetric,
  value: number,
) {
  if (metric === 'tokens') return formatTokens(value);
  if (metric === 'cost') {
    return value >= 10 ? `$${value.toFixed(0)}` : `$${value.toFixed(1)}`;
  }

  const minutes = Math.round(value);
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1_440).toFixed(1)}d`;
}

export function formatDashboardDuration(value: number, locale: SupportedLocale = 'zh-CN') {
  const minutes = Math.round(value);
  if (minutes < 60) return translate(locale, 'usage.common.minutes', { count: minutes });

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0
    ? translate(locale, 'usage.common.hours', { count: hours })
    : translate(locale, 'usage.common.hoursMinutes', { hours, minutes: remainder });
}
