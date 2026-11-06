import type { QuotaHistoryCycle, QuotaHistoryReport } from 'quotern-core';
import { quotaWindowPeriodSeconds } from 'quotern-core/quota/shared/quota';
import { localizeQuotaWindowLabel } from 'quotern-i18n/quota';
import type { SupportedLocale } from 'quotern-i18n';

export function quotaCycleStatus(cycle: QuotaHistoryCycle, newestId: string, observedAt: number): 'current' | 'ended' | 'previousSegment' | 'unknownStatus' {
  if (cycle.resetsAt === null || !Number.isFinite(cycle.resetsAt)) return 'unknownStatus';
  if (cycle.resetsAt <= observedAt) return 'ended';
  return cycle.id === newestId ? 'current' : 'previousSegment';
}

export function quotaHistoryWindowLabel(window: QuotaHistoryReport['windows'][number], provider: string, locale: SupportedLocale) {
  const period = quotaWindowPeriodSeconds({ ...window, usedPercent: 0, resetsAt: null });
  const label = window.label === window.id && period && !['monthly', 'limit_month_total'].includes(window.id)
    ? period % 86400 === 0 ? `${period / 86400}d` : `${period / 3600}h` : window.label;
  return localizeQuotaWindowLabel(locale, provider, { ...window, label, periodSeconds: period });
}
