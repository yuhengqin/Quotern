import type { SessionMetrics } from 'quotern-core';
import { i18n, normalizeLocale, translate, type SupportedLocale } from 'quotern-i18n';

export function formatSessionDuration(seconds: number | null, locale: SupportedLocale = normalizeLocale(i18n.resolvedLanguage)): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return translate(locale, 'desktop.sessionDuration.seconds', { count: total });
  const minutes = Math.floor(total / 60);
  return minutes < 60
    ? translate(locale, 'desktop.sessionDuration.minutes', { count: minutes })
    : translate(locale, 'desktop.sessionDuration.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export function sessionMetricValue(metrics: SessionMetrics | null, key: 'sessionCount' | 'messageCount' | 'durationSeconds' | 'activeSeconds' | 'taskSeconds'): number | null {
  if (!metrics) return null;
  if (key === 'taskSeconds') return metrics.taskSeconds ?? null;
  if (!metrics.complete && metrics.sessionCount === 0) return null;
  return metrics[key];
}
