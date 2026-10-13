import type { ReactNode } from 'react';
import { differenceInCalendarDays, format } from 'date-fns';
import { Card, Chip, ProgressBar } from '@heroui/react';
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
              <span className="shrink-0 text-[10px] text-muted">旧</span>
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
          <p role="status" className="text-xs text-muted">{data.message}</p>
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
  return (
    <div className="grid min-h-12 content-start gap-3">
      {metrics.slice(0, 3).map((metric) => {
        const daysOnly = metric.resetDisplay === 'days-only';
        const resetLabel = daysOnly
          ? formatSubscriptionDaysRemaining(metric.resetsAt)
          : formatSubscriptionResetTime(metric.resetsAt);
        const resetTitle = daysOnly
          ? formatSubscriptionExpiryDate(metric.resetsAt)
          : formatSubscriptionResetTime(metric.resetsAt, new Date(), true);
        const timeKind = daysOnly ? '到期' : '刷新时间';
        return (
          <div
            className="grid min-w-0 gap-0.5"
            key={metric.label}
          >
            <div className="flex min-w-0 items-center justify-between gap-3">
              <span className="shrink-0 text-xs font-normal text-muted">{metric.label}</span>
              {resetLabel ? (
                <span
                  aria-label={`${timeKind}：${resetLabel}`}
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
                aria-label={`${title} ${metric.label} ${metric.valueText ?? `剩余 ${Math.round(metric.remainingPercent)}%`}${resetLabel ? `，${timeKind}${resetLabel}` : ''}`}
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
): string | null {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) || resetsAt <= 0) return null;
  const date = new Date(resetsAt * 1_000);
  if (!Number.isFinite(date.getTime())) return null;
  if (absolute) return format(date, 'M月d日 HH:mm');

  const daysUntilReset = differenceInCalendarDays(date, now);
  const dayLabel = daysUntilReset === 0
    ? '今日'
    : daysUntilReset === 1
      ? '明日'
      : daysUntilReset > 1
        ? `${daysUntilReset}天后`
        : format(date, 'M月d日');
  return `${dayLabel} ${format(date, 'HH:mm')}`;
}

function formatSubscriptionDaysRemaining(resetsAt?: number | null, now = new Date()): string | null {
  const date = subscriptionTimestampToDate(resetsAt);
  if (!date) return null;
  const daysUntilExpiry = differenceInCalendarDays(date, now);
  if (daysUntilExpiry <= 0) return '今日';
  if (daysUntilExpiry === 1) return '明日';
  return `${daysUntilExpiry}天后`;
}

function formatSubscriptionExpiryDate(resetsAt?: number | null): string | null {
  const date = subscriptionTimestampToDate(resetsAt);
  return date ? format(date, 'M月d日到期') : null;
}

function subscriptionTimestampToDate(timestamp?: number | null): Date | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp * 1_000);
  return Number.isFinite(date.getTime()) ? date : null;
}
