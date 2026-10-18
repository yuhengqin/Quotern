import type { ReactNode } from 'react';
import { differenceInCalendarDays } from 'date-fns';
import { Card, Chip, ProgressBar } from '@heroui/react';
import { i18n, normalizeLocale, translate, type SupportedLocale } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';
import { AlarmClockIcon } from 'lucide-react';
import { visibleSubscriptionPlanLabel } from '../../shared/subscription-plan';

export interface SubscriptionUsageMetric {
  color: string;
  label: string;
  remainingPercent: number | null;
  /** Official allowance reset timestamp, in Unix seconds. */
  resetsAt?: number | null;
  /** Show a subscription expiry as days remaining instead of a reset time. */
  resetDisplay?: 'date-time' | 'days-only';
  /** Literal value for balances and credits; percentage remains the bar value. */
  valueText?: string;
}

export interface SubscriptionUsageCardData {
  /** Fixed-size LobeHub brand mark rendered in the card title bar. */
  icon?: ReactNode;
  metrics: readonly SubscriptionUsageMetric[];
  planLabel?: string | null;
  showFreePlan?: boolean;
  stale?: boolean;
  hasAccount?: boolean;
  message?: string | null;
  title: string;
}

interface SubscriptionUsageCardProps {
  data: SubscriptionUsageCardData;
  loading: boolean;
  /** Optional feedback keeps a failed channel visible even without metrics. */
  feedback?: ReactNode;
}

/** Shared desktop presentation for subscription allowance progress bars. */
export function SubscriptionUsageCard({
  data,
  loading,
  feedback,
}: SubscriptionUsageCardProps) {
  const { t } = useTranslation();
  const visiblePlanLabel = visibleSubscriptionPlanLabel(data.planLabel, data.showFreePlan);
  const visibleMetrics = data.metrics.filter(
    (metric): metric is SubscriptionUsageMetric & { remainingPercent: number } =>
      metric.remainingPercent !== null,
  );

  // Channels without explicit feedback retain the existing empty/loading behavior.
  if (!feedback && (loading || (visibleMetrics.length === 0 && !(data.hasAccount && data.message)))) return null;

  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl p-3">
      <Card.Content className="grid content-start gap-3 p-0">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {data.icon}
            <p className="min-w-0 truncate text-sm font-semibold leading-none tracking-tight text-foreground">
              {data.title}
            </p>
            {data.stale ? (
              <span className="shrink-0 text-[10px] text-muted">{t('desktop.subscription.stale')}</span>
            ) : null}
          </div>
          {visiblePlanLabel ? (
            <Chip className="max-w-24 shrink-0" size="sm" variant="primary">
              <Chip.Label className="truncate">{visiblePlanLabel}</Chip.Label>
            </Chip>
          ) : null}
        </div>
        {visibleMetrics.length > 0 ? (
          <SubscriptionProgressBars metrics={visibleMetrics} title={data.title} />
        ) : null}
        {feedback ?? (data.hasAccount && data.message ? (
          <p role="status" className="text-xs text-muted">{t('desktop.subscription.unavailable', { provider: data.title })}</p>
        ) : null)}
      </Card.Content>
    </Card>
  );
}

function SubscriptionProgressBars({
  metrics,
  title,
}: {
  metrics: readonly (SubscriptionUsageMetric & { remainingPercent: number })[];
  title: string;
}) {
  const { t, i18n: activeI18n } = useTranslation();
  const locale = normalizeLocale(activeI18n.resolvedLanguage);
  return (
    <div className="grid min-h-12 content-start gap-3">
      {metrics.slice(0, 3).map((metric) => {
        const daysOnly = metric.resetDisplay === 'days-only';
        const resetLabel = daysOnly
          ? formatSubscriptionDaysRemaining(metric.resetsAt, new Date(), locale)
          : formatSubscriptionResetTime(metric.resetsAt, new Date(), false, locale);
        const resetTitle = daysOnly
          ? formatSubscriptionExpiryDate(metric.resetsAt, locale)
          : formatSubscriptionResetTime(metric.resetsAt, new Date(), true, locale);
        const timeKind = t(daysOnly ? 'desktop.subscription.expires' : 'desktop.subscription.resetTime');
        const resetDescription = resetLabel
          ? t('desktop.subscription.progressReset', { kind: timeKind, time: resetLabel })
          : '';
        return (
          <div
            className="grid min-w-0 gap-0.5"
            key={metric.label}
          >
            <div className="flex min-w-0 items-center justify-between gap-3">
              <span className="shrink-0 text-xs font-normal text-muted">{metric.label}</span>
              {resetLabel ? (
                <span
                  aria-label={t('desktop.subscription.timeLabel', { kind: timeKind, time: resetLabel })}
                  className="flex min-w-0 items-center gap-1 text-xs font-normal leading-none tabular-nums text-muted"
                  title={resetTitle ?? resetLabel}
                >
                  {!daysOnly ? (
                    <AlarmClockIcon aria-hidden="true" className="size-3 shrink-0" />
                  ) : null}
                  <span className="truncate">{resetLabel}</span>
                </span>
              ) : null}
            </div>
            <div className="flex min-w-0 items-center gap-3">
              <ProgressBar
                aria-label={t('desktop.subscription.progress', {
                  title,
                  metric: metric.label,
                  value: metric.valueText ?? t('desktop.subscription.remaining', { percent: Math.round(metric.remainingPercent) }),
                  reset: resetDescription,
                })}
                className="min-w-0 flex-1"
                maxValue={100}
                size="sm"
                style={{
                  gap: 0,
                  gridTemplateAreas: '"track"',
                  gridTemplateColumns: 'minmax(0, 1fr)',
                  gridTemplateRows: 'auto',
                }}
                value={metric.remainingPercent}
              >
                <ProgressBar.Track className="h-1.5 rounded-full bg-surface-secondary">
                  <ProgressBar.Fill className="rounded-full" style={{ backgroundColor: metric.color }} />
                </ProgressBar.Track>
              </ProgressBar>
              <span className="shrink-0 whitespace-nowrap text-right text-[11px] font-medium tabular-nums text-foreground">
                {metric.valueText ?? `${Math.round(metric.remainingPercent)}%`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Format only provider-supplied reset timestamps; fetch time is intentionally excluded. */
export function formatSubscriptionResetTime(
  resetsAt?: number | null,
  now = new Date(),
  absolute = false,
  locale: SupportedLocale = normalizeLocale(i18n.resolvedLanguage),
): string | null {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) || resetsAt <= 0) return null;
  const date = new Date(resetsAt * 1_000);
  if (!Number.isFinite(date.getTime())) return null;
  if (absolute) return `${formatSubscriptionDate(date, locale)} ${formatSubscriptionClock(date, locale)}`;

  const daysUntilReset = differenceInCalendarDays(date, now);
  const dayLabel = daysUntilReset === 0
    ? translate(locale, 'desktop.subscription.today')
    : daysUntilReset === 1
      ? translate(locale, 'desktop.subscription.tomorrow')
      : daysUntilReset > 1
        ? translate(locale, 'desktop.subscription.daysLater', { count: daysUntilReset })
        : formatSubscriptionDate(date, locale);
  return `${dayLabel} ${formatSubscriptionClock(date, locale)}`;
}

function formatSubscriptionDaysRemaining(resetsAt?: number | null, now = new Date(), locale: SupportedLocale = normalizeLocale(i18n.resolvedLanguage)): string | null {
  const date = subscriptionTimestampToDate(resetsAt);
  if (!date) return null;
  const daysUntilExpiry = differenceInCalendarDays(date, now);
  if (daysUntilExpiry <= 0) return translate(locale, 'desktop.subscription.today');
  if (daysUntilExpiry === 1) return translate(locale, 'desktop.subscription.tomorrow');
  return translate(locale, 'desktop.subscription.daysLater', { count: daysUntilExpiry });
}

function formatSubscriptionExpiryDate(resetsAt?: number | null, locale: SupportedLocale = normalizeLocale(i18n.resolvedLanguage)): string | null {
  const date = subscriptionTimestampToDate(resetsAt);
  return date ? translate(locale, 'desktop.subscription.expiresOnDate', { date: formatSubscriptionDate(date, locale) }) : null;
}

function formatSubscriptionDate(date: Date, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
}

function formatSubscriptionClock(date: Date, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

function subscriptionTimestampToDate(timestamp?: number | null): Date | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp * 1_000);
  return Number.isFinite(date.getTime()) ? date : null;
}
