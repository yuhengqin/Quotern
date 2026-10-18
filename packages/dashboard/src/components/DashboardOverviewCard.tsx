import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { Button, Card, Chip, Popover, Tooltip } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { translate, type SupportedLocale } from 'quotern-i18n';
import { ActivityHeatmap } from '@/components/ActivityHeatmap';
import { DashboardSessionCards } from '@/components/DashboardSessionCards';
import type { SessionMetrics, UsageReport } from 'quotern-core';
import { CostExplanationLabel } from '@/components/CostExplanationLabel';
import { TokenSourceDetails } from '@/components/TokenSourceDetails';
import {
  buildUsageMetricTrendValues,
  type UsageMetricTrendPoint,
} from 'quotern-core/dashboard-trend';
import type { DailyUsageRow, ModelBreakdownRow } from '@/lib/api';
import type {
  DashboardMetricTrend,
  DashboardMetricTrends,
  DashboardUsageSummary,
} from '@/lib/dashboard-mock-data';
import {
  formatTokens,
  formatTokensExact,
  formatUsd,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import { AchievementActivityLink } from '../achievements/AchievementEntry';

interface DashboardOverviewCardProps {
  belowMetrics?: ReactNode;
  /** Ordered hourly or daily buckets for the selected dashboard range. */
  metricTrendRows: readonly UsageMetricTrendPoint[];
  metricTrendPeriodLabel: string;
  heatmapDays: DailyUsageRow[];
  modelRows?: ModelBreakdownRow[];
  metricTrends: DashboardMetricTrends;
  summary: DashboardUsageSummary;
  sessionMetrics?: SessionMetrics | null;
  selectedDate?: string | null;
  onSelectDate?: (date: string) => void;
  /** Local CLI/Desktop only: show request count + cache hit captions. */
  showLocalMetrics?: boolean;
  costReport?: UsageReport | null;
  costExplanationLoading?: boolean;
  costExplanationError?: boolean;
}

/** Four inline metrics and the daily heatmap, styled to match the tray overview. */
export function DashboardOverviewCard({
  belowMetrics,
  metricTrendRows,
  metricTrendPeriodLabel,
  heatmapDays,
  modelRows = [],
  metricTrends,
  summary,
  sessionMetrics = null,
  selectedDate = null,
  onSelectDate,
  showLocalMetrics = false,
  costReport = null,
  costExplanationLoading = false,
  costExplanationError = false,
}: DashboardOverviewCardProps) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  const metricTrendValues = useMemo(
    () => buildUsageMetricTrendValues(metricTrendRows),
    [metricTrendRows],
  );
  const requestCaption = showLocalMetrics
    ? formatRequestCaption(summary, locale)
    : null;
  const cacheHitRate = showLocalMetrics
    ? cacheHitRateFromSummary(summary)
    : null;
  const reserveCaption = showLocalMetrics;
  const showCostTrend = !showLocalMetrics || (costReport !== null && costReport.filters.sources.length === 0 && costReport.summary.costExplanation.unpricedTokens === 0);
  const metrics = [
    {
      id: 'cost',
      label: t('usage.common.estimatedCost'),
      value: costReport?.summary.knownCostUsd ?? summary.totalCostUsd,
      format: formatUsd,
      exactFormat: formatUsd,
      caption:
        costReport && costReport.summary.costExplanation.unpricedTokens > 0
          ? t('usage.overview.unpriced')
          : costReport && costReport.summary.costExplanation.defaultPricedTokens > 0
            ? t('usage.overview.defaultPrice')
            : null as string | null,
      trend: {
        comparison: showCostTrend ? metricTrends.totalCostUsd : null,
        display: 'percent' as const,
        values: showCostTrend ? metricTrendValues.costUsd : [],
      },
    },
    {
      id: 'total-tokens',
      label: t('usage.common.totalTokens'),
      value: summary.totalTokens,
      format: formatTokens,
      exactFormat: formatTokensExact,
      caption: requestCaption,
      trend: {
        comparison: metricTrends.totalTokens,
        display: 'percent' as const,
        values: metricTrendValues.totalTokens,
      },
    },
    {
      id: 'input-tokens',
      label: t('usage.common.inputTokens'),
      value: summary.inputTokens,
      format: formatTokens,
      exactFormat: formatTokensExact,
      caption:
        cacheHitRate == null
          ? null
          : t('usage.overview.cacheHitRate', { percent: (cacheHitRate * 100).toFixed(1) }),
      trend: {
        comparison: metricTrends.inputTokens,
        display: 'tokens' as const,
        values: metricTrendValues.inputTokens,
      },
    },
    {
      id: 'output-tokens',
      label: t('usage.common.outputTokens'),
      value: summary.outputTokens,
      format: formatTokens,
      exactFormat: formatTokensExact,
      caption: null as string | null,
      trend: {
        comparison: metricTrends.outputTokens,
        display: 'tokens' as const,
        values: metricTrendValues.outputTokens,
      },
    },
  ] as const;

  return (
    <section aria-label={t('usage.page.overview')} className="w-full">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <Card
            className={cn(
              'min-w-0 overflow-hidden rounded-2xl p-3',
              reserveCaption
                ? 'h-[6.25rem] min-h-[6.25rem]'
                : 'h-[5.5rem] min-h-[5.5rem]',
            )}
            key={metric.id}
          >
            <Card.Content className="grid h-full grid-rows-[1.25rem_1fr] content-start gap-3 p-0">
              <div className="flex h-5 min-w-0 items-center justify-between gap-2">
                {metric.id === 'cost' && showLocalMetrics ? (
                  <CostExplanationLabel
                    report={costReport}
                    loading={costExplanationLoading}
                    error={costExplanationError}
                  />
                ) : metric.id === 'total-tokens' ? (
                  <TotalTokenLabel
                    report={costReport}
                    loading={costExplanationLoading}
                    error={costExplanationError}
                    showRequestHelp={showLocalMetrics}
                    summary={summary}
                  />
                ) : metric.id === 'input-tokens' && showLocalMetrics ? (
                  <InputTokenLabel />
                ) : (
                  <p className="min-w-0 truncate text-xs font-medium leading-5 text-muted">
                    {metric.label}
                  </p>
                )}
                <div className="flex h-5 shrink-0 items-center justify-end">
                  {metric.trend.comparison ? (
                    <MetricTrend
                      display={metric.trend.display}
                      trend={metric.trend.comparison}
                    />
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_64px] items-end gap-2">
                <div className="min-w-0">
                  {metric.id === 'cost' && showLocalMetrics && !costReport ? (
                    <div aria-label={t(costExplanationLoading ? 'usage.overview.costLoading' : 'usage.overview.costUnavailable')} className="min-w-0 truncate text-lg font-semibold leading-7 tracking-tight text-muted">
                      —
                    </div>
                  ) : metric.id === 'cost' && costReport && costReport.summary.tokens > 0 && costReport.summary.costExplanation.unpricedTokens >= costReport.summary.tokens ? (
                    <div aria-label={t('usage.overview.costUnknown')} className="min-w-0 truncate text-lg font-semibold leading-7 tracking-tight text-foreground tabular-nums" title={t('usage.common.unknown')}>
                      {t('usage.common.unknown')}
                    </div>
                  ) : (
                    <NestedAnimatedValue
                      exactFormat={metric.exactFormat}
                      format={metric.format}
                      label={metric.label}
                      value={metric.value}
                    />
                  )}
                  {reserveCaption ? (
                    <p className="mt-0.5 h-4 truncate text-[10px] leading-4 text-muted tabular-nums">
                      {metric.caption ?? '\u00a0'}
                    </p>
                  ) : null}
                </div>
                <MetricSparkline
                  isIncrease={(metric.trend.comparison?.changeValue ?? 0) >= 0}
                  label={t('usage.page.metricTrend', { period: metricTrendPeriodLabel, metric: metric.label })}
                  values={metric.trend.values}
                />
              </div>
            </Card.Content>
          </Card>
        ))}
      </div>

      <DashboardSessionCards metrics={sessionMetrics} />

      {belowMetrics}

      <Card className="mt-4">
        <Card.Content>
          <HeatmapSection
            days={heatmapDays}
            modelRows={modelRows}
            onSelectDate={onSelectDate}
            selectedDate={selectedDate}
          />
          <AchievementActivityLink />
        </Card.Content>
      </Card>
    </section>
  );
}

/** Prefer complete count; fall back to known evidence without "至少" wording. */
function formatRequestCaption(summary: DashboardUsageSummary, locale: SupportedLocale): string | null {
  const count = summary.requestCount ?? summary.knownRequestCount;
  if (count == null) return null;
  return translateRequestCount(count, locale);
}

function translateRequestCount(count: number, locale: SupportedLocale): string {
  return translate(locale, 'usage.overview.requestCount', { count, display: count.toLocaleString(locale) });
}

/** OpenUsage / Anthropic-style: cache_read / (input + cache_read + cache_write). */
function cacheHitRateFromSummary(summary: DashboardUsageSummary): number | null {
  const denom =
    summary.inputTokens +
    summary.cachedInputTokens +
    summary.cacheCreationInputTokens;
  return denom > 0 ? summary.cachedInputTokens / denom : null;
}

function MetricHelpLabel({
  ariaLabel,
  heading,
  label,
  panel,
  details,
}: {
  ariaLabel: string;
  heading: string;
  label: string;
  panel: ReactNode;
  details?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <p className="min-w-0 truncate text-xs font-medium leading-5 text-muted">
        {label}
      </p>
      <Popover isOpen={open} onOpenChange={setOpen}>
        <Tooltip closeDelay={80} delay={120} isDisabled={open}>
          <Button
            aria-label={ariaLabel}
            className="size-4 min-h-4 min-w-4 shrink-0 p-0 text-muted data-[hovered]:bg-transparent data-[hovered]:text-foreground"
            isIconOnly
            size="sm"
            variant="ghost"
          >
            <CircleHelp aria-hidden className="size-3.5" />
          </Button>
          <Tooltip.Content
            className="rounded-xl border-0 bg-overlay p-3 text-overlay-foreground shadow-surface"
            placement="bottom"
          >
            {panel}
          </Tooltip.Content>
        </Tooltip>
        <Popover.Content
          className="rounded-xl border-0 bg-overlay p-0 text-overlay-foreground shadow-surface"
          placement="bottom"
        >
          <Popover.Dialog className="max-h-[calc(100dvh-3rem)] max-w-[calc(100vw-2rem)] overflow-y-auto p-3 outline-none">
            <Popover.Heading className="sr-only">{heading}</Popover.Heading>
            {panel}
            {details}
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}

function TotalTokenLabel({
  report,
  loading,
  error,
  showRequestHelp,
  summary,
}: {
  report: UsageReport | null;
  loading: boolean;
  error: boolean;
  showRequestHelp: boolean;
  summary: DashboardUsageSummary;
}) {
  const { t } = useTranslation();
  return (
    <MetricHelpLabel
      ariaLabel={t('usage.overview.totalHelpAria')}
      heading={t('usage.overview.totalHeading')}
      label={t('usage.common.totalTokens')}
      details={showRequestHelp ? <TokenSourceDetails report={report} loading={loading} error={error} /> : null}
      panel={
        <TokenBreakdownPanel
          showRequestHelp={showRequestHelp}
          summary={summary}
        />
      }
    />
  );
}

function InputTokenLabel() {
  const { t } = useTranslation();
  return (
    <MetricHelpLabel
      ariaLabel={t('usage.overview.cacheHelpAria')}
      heading={t('usage.overview.cacheHitHeading')}
      label={t('usage.common.inputTokens')}
      panel={<CacheHitRateHelpPanel />}
    />
  );
}

function CacheHitRateHelpPanel() {
  const { t } = useTranslation();
  return (
    <div className="grid max-w-56 gap-1.5 text-xs">
      <p className="font-medium text-foreground">{t('usage.overview.cacheHitHeading')}</p>
      <p className="leading-4 text-muted">
        {t('usage.overview.cacheFormula')}
      </p>
    </div>
  );
}

function TokenBreakdownPanel({
  showRequestHelp,
  summary,
}: {
  showRequestHelp: boolean;
  summary: DashboardUsageSummary;
}) {
  const { t } = useTranslation();
  const input = summary.inputTokens;
  const output = summary.outputTokens;
  const cacheRead = summary.cachedInputTokens;
  const cacheWrite = summary.cacheCreationInputTokens;
  const other = Math.max(
    0,
    summary.totalTokens - input - output - cacheRead - cacheWrite,
  );
  const requestIncomplete =
    showRequestHelp &&
    summary.requestCount == null &&
    (summary.knownRequestCount ?? 0) > 0;

  return (
    <div className="grid min-w-44 gap-1.5 text-xs">
      <p className="font-medium text-foreground">{t('usage.overview.breakdownHeading')}</p>
      <BreakdownRow label={t('usage.common.input')} value={input} />
      <BreakdownRow label={t('usage.common.output')} value={output} />
      <div className="grid gap-1">
        <p className="text-muted">{t('usage.common.cache')}</p>
        <BreakdownRow indented label={t('usage.overview.read')} value={cacheRead} />
        <BreakdownRow indented label={t('usage.overview.write')} value={cacheWrite} />
      </div>
      <BreakdownRow label={t('usage.common.other')} value={other} />
      <div className="my-0.5 h-px bg-border/70" />
      <BreakdownRow emphasize label={t('usage.common.total')} value={summary.totalTokens} />
      <p className="pt-0.5 text-[10px] leading-4 text-muted">
        {t('usage.overview.formula')}
      </p>
      {showRequestHelp ? (
        <p className="pt-1 text-[10px] leading-4 text-muted">
          {t(requestIncomplete ? 'usage.overview.requestNoteIncomplete' : 'usage.overview.requestNote')}
        </p>
      ) : null}
    </div>
  );
}

function BreakdownRow({
  emphasize = false,
  indented = false,
  label,
  value,
}: {
  emphasize?: boolean;
  indented?: boolean;
  label: string;
  value: number;
}) {
  return (
    <div
      className={cn(
        'flex w-full items-center justify-between gap-4',
        indented && 'pl-3',
      )}
    >
      <span className={emphasize ? 'font-medium text-foreground' : 'text-muted'}>
        {label}
      </span>
      <span
        className={cn(
          'font-mono tabular-nums',
          emphasize ? 'font-medium text-foreground' : 'text-foreground',
        )}
      >
        {formatTokens(value)}
      </span>
    </div>
  );
}

function HeatmapSection({
  days,
  modelRows,
  selectedDate,
  onSelectDate,
}: {
  days: DailyUsageRow[];
  modelRows: ModelBreakdownRow[];
  selectedDate: string | null;
  onSelectDate?: (date: string) => void;
}) {
  return (
    <ActivityHeatmap
      days={days}
      embedded
      models={modelRows}
      onSelectDate={onSelectDate}
      selectedDate={selectedDate}
    />
  );
}

function NestedAnimatedValue({
  exactFormat,
  format,
  label,
  value,
}: {
  exactFormat: (value: number) => string;
  format: (value: number) => string;
  label: string;
  value: number;
}) {
  const animatedValue = useAnimatedNumber(value);

  return (
    <div
      aria-label={`${label} ${exactFormat(value)}`}
      className="min-w-0 truncate text-lg font-semibold leading-7 tracking-tight text-foreground tabular-nums"
      title={exactFormat(value)}
    >
      {format(animatedValue)}
    </div>
  );
}

function MetricSparkline({
  label,
  values,
  isIncrease,
}: {
  label: string;
  values: readonly number[];
  isIncrease: boolean;
}) {
  const gradientId = useId().replace(/:/g, '');
  const points = useMemo(
    () => values.filter((value) => Number.isFinite(value)),
    [values],
  );

  if (points.length < 2) {
    return (
      <div
        aria-hidden="true"
        className="h-6 w-16 justify-self-end"
      />
    );
  }

  const width = 64;
  const height = 24;
  const padding = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stroke = isIncrease ? 'var(--chart-2)' : 'var(--chart-5)';
  const path = points
    .map((value, index) => {
      const x =
        padding +
        (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
      const y =
        height -
        padding -
        ((value - min) / span) * (height - padding * 2);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <div aria-label={label} className="pointer-events-none h-6 w-16 justify-self-end" role="img">
      <svg
        aria-hidden="true"
        className="h-full w-full overflow-visible"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.24} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path
          d={`${path} L ${width - padding} ${height} L ${padding} ${height} Z`}
          fill={`url(#${gradientId})`}
        />
        <path
          d={path}
          fill="none"
          stroke={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
}

function MetricTrend({
  display,
  trend,
}: {
  display: 'percent' | 'tokens';
  trend: DashboardMetricTrend;
}) {
  const { t } = useTranslation();
  const isIncrease = trend.changeValue >= 0;
  const label =
    display === 'tokens'
      ? `${isIncrease ? '+' : '−'}${formatTokens(Math.abs(trend.changeValue))}`
      : `${Math.abs(trend.changePct).toFixed(1)}%`;

  return (
    <Chip
      aria-label={t(isIncrease ? 'usage.overview.increaseAria' : 'usage.overview.decreaseAria', { value: label })}
      className="shrink-0"
      color={isIncrease ? 'success' : 'danger'}
      size="sm"
      variant="soft"
    >
      <span aria-hidden="true">{isIncrease ? '↑' : '↓'}</span>
      <Chip.Label className="tabular-nums">{label}</Chip.Label>
    </Chip>
  );
}

function useAnimatedNumber(target: number, duration = 1_200) {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      valueRef.current = target;
      setValue(target);
      return;
    }

    const from = valueRef.current;
    if (Object.is(from, target) || Math.abs(from - target) < 1e-9) {
      valueRef.current = target;
      setValue(target);
      return;
    }

    let frameId = 0;
    const startedAt = performance.now();

    const update = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const next = from + (target - from) * easedProgress;
      valueRef.current = next;
      setValue(next);

      if (progress < 1) {
        frameId = requestAnimationFrame(update);
      }
    };

    frameId = requestAnimationFrame(update);

    return () => cancelAnimationFrame(frameId);
  }, [duration, target]);

  return value;
}
