import { CircleHelp } from 'lucide-react';
import { Card, Popover, Skeleton } from '@heroui/react';
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
    <section aria-label={t('usage.session.overview')} aria-busy={loading && !metrics} className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const label = t(card.labelKey);
        const value = sessionMetricValue(metrics, card.key);
        const formatted = card.duration ? formatSessionDuration(value) : value === null ? '—' : value.toLocaleString(locale);
        const task = card.key === 'taskSeconds';
        const estimated = task && value !== null && ['mixed', 'estimated'].includes(metrics?.taskTimingKind ?? '');
        const taskNote = value === null ? t('usage.session.noRecord') : metrics?.taskTimingKind === 'recorded' ? t('usage.session.recordedTime') : metrics?.taskTimingKind === 'mixed' ? t('usage.session.includesEstimate') : estimated ? t('usage.session.estimate') : t('usage.session.noTaskRecord');
        const note = !metrics && loading ? t('usage.activity.loading') : !metrics && error ? t('usage.activity.unavailable') : task ? value !== null && missingTaskSources ? t('usage.session.taskNotePartial', { note: taskNote }) : taskNote : partial ? t('usage.session.partialSources') : '\u00a0';
        return (
          <Card key={card.key} className="h-[6.25rem] min-h-[6.25rem] min-w-0 overflow-hidden rounded-2xl p-3">
            <Card.Content className="flex h-full flex-col justify-between p-0">
              <div className="flex items-center gap-0.5">
                <p className="text-xs font-medium leading-5 text-muted">{label}</p>
                <Popover>
                  <Popover.Trigger aria-label={t('usage.session.helpAria', { label })} className="flex size-4 min-w-4 items-center justify-center rounded-full text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2">
                    <CircleHelp aria-hidden className="size-3.5" />
                  </Popover.Trigger>
                  <Popover.Content placement="bottom" className="max-w-80 rounded-xl border-0 bg-overlay p-0 text-overlay-foreground shadow-surface">
                    <Popover.Dialog className="p-3 outline-none">
                      <Popover.Heading className="mb-1 text-xs font-semibold">{label}</Popover.Heading>
                      <p className="text-xs leading-relaxed">{t(card.helpKey)}</p>
                      {task && estimatedSources ? <p className="mt-2 text-xs text-muted">{t('usage.session.estimatedSources', { sources: estimatedSources })}</p> : null}
                      {task && missingTaskSources ? <p className="mt-2 text-xs text-muted">{t('usage.session.missingTaskSources', { sources: missingTaskSources })}</p> : null}
                      {!task && partial ? <p className="mt-2 text-xs text-muted">{t('usage.session.missingSources', { sources: missing })}</p> : null}
                    </Popover.Dialog>
                  </Popover.Content>
                </Popover>
              </div>
              <div>
                {loading && !metrics ? (
                  <div role="status" aria-label={t('usage.activity.loading')}><Skeleton aria-hidden="true" className="h-7 w-24 rounded-md" /></div>
                ) : (
                  <p aria-label={t(estimated ? 'usage.session.estimatedAria' : 'usage.session.valueAria', { label, value: formatted })} className="truncate text-xl font-semibold leading-7 tracking-tight text-foreground tabular-nums" title={formatted}>{formatted}</p>
                )}
                <p className="mt-0.5 h-4 truncate text-[10px] leading-4 text-muted">{note}</p>
              </div>
            </Card.Content>
          </Card>
        );
      })}
    </section>
  );
}
