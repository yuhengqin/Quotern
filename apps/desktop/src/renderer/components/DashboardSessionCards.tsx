import { Card, Skeleton } from '@heroui/react';
import { HelpPopover } from '@/components/HelpPopover';
import { useTranslation } from 'quotern-i18n/react';
import type { SessionMetrics } from 'quotern-core';
import { formatSessionDuration, sessionMetricValue } from '@/lib/session-metric-format';
import { sourceLabel } from '@/lib/tokens';

const cards = [
  { key: 'taskSeconds', labelKey: 'usage.session.taskDuration', duration: true, helpKey: 'usage.session.taskHelp' },
  { key: 'durationSeconds', labelKey: 'usage.session.totalDuration', duration: true, helpKey: 'usage.session.durationHelp' },
  { key: 'sessionCount', labelKey: 'usage.session.count', duration: false, helpKey: 'usage.session.countHelp' },
  { key: 'messageCount', labelKey: 'usage.session.messageCount', duration: false, helpKey: 'usage.session.messageHelp' },
] as const;

export function DashboardSessionCards({ metrics, loading = false, error = false }: { metrics: SessionMetrics | null; loading?: boolean; error?: boolean }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'zh-CN';
  const list = (sources?: string[]) => sources?.length
    ? new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }).format(sources.map(sourceLabel))
    : '';
  const partial = metrics && !metrics.complete;
  const missing = list(metrics?.missingSources);
  const estimatedSources = list(metrics?.estimatedTaskSources);
  const missingTaskSources = list(metrics?.missingTaskSources);
  return (
    <section aria-label={t('usage.session.overview')} aria-busy={loading && !metrics} className="mt-2.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {cards.map((card) => {
        const label = t(card.labelKey);
        const value = sessionMetricValue(metrics, card.key);
        const formatted = card.duration ? formatSessionDuration(value) : value === null ? '—' : value.toLocaleString(locale);
        const task = card.key === 'taskSeconds';
        const estimated = task && value !== null && ['mixed', 'estimated'].includes(metrics?.taskTimingKind ?? '');
        const recorded = task && value !== null && metrics?.taskTimingKind === 'recorded';
        const taskNote = value === null ? t('usage.session.noRecord') : recorded ? '' : metrics?.taskTimingKind === 'mixed' ? t('usage.session.includesEstimate') : estimated ? t('usage.session.estimate') : t('usage.session.noTaskRecord');
        const note = !metrics && loading ? '' : !metrics && error ? t('usage.activity.unavailable') : task
          ? value !== null && missingTaskSources
            ? taskNote ? t('usage.session.taskNotePartial', { note: taskNote }) : t('usage.session.partialSources')
            : taskNote
          : partial ? t('usage.session.partialSources') : '';
        return (
          <Card key={card.key} className="min-h-[6.25rem] min-w-0 rounded-2xl p-3">
            <Card.Content className="flex flex-col gap-1 p-0">
              <div className="flex items-center gap-0.5">
                <p className="text-xs font-medium leading-5 text-muted">{label}</p>
                <HelpPopover title={label} triggerClassName="size-4 min-h-4 min-w-4">
                      <p className="text-xs leading-relaxed">{t(card.helpKey)}</p>
                      {recorded && <p>{t('usage.session.recordedTime')}</p>}
                      {task && estimatedSources ? <p className="mt-2 text-xs text-muted">{t('usage.session.estimatedSources', { sources: estimatedSources })}</p> : null}
                      {task && missingTaskSources ? <p className="mt-2 text-xs text-muted">{t('usage.session.missingTaskSources', { sources: missingTaskSources })}</p> : null}
                      {!task && partial ? <p className="mt-2 text-xs text-muted">{t('usage.session.missingSources', { sources: missing })}</p> : null}
                </HelpPopover>
              </div>
              <div>
                {loading && !metrics ? (
                  <div role="status" aria-label={t('usage.activity.loading')}><Skeleton aria-hidden="true" className="h-7 w-24 rounded-md" /></div>
                ) : (
                  <p aria-label={t(estimated ? 'usage.session.estimatedAria' : 'usage.session.valueAria', { label, value: formatted })} className="truncate text-xl font-semibold leading-7 tracking-tight text-foreground tabular-nums" title={formatted}>{formatted}</p>
                )}
                {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
              </div>
            </Card.Content>
          </Card>
        );
      })}
    </section>
  );
}
