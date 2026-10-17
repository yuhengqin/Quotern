import { memo, useId, useMemo, useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { Button, Card, Chip, Popover, Tooltip } from '@heroui/react';
import { ActivityHeatmap } from '@/components/ActivityHeatmap';
import { DashboardSessionCards } from '@/components/DashboardSessionCards';
import type { SessionMetrics, UsageReport } from 'quotern-core';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
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
import { AchievementActivityLink } from '../../../../../packages/dashboard/src/achievements/AchievementEntry';

interface DashboardOverviewCardProps {
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
  /** Optional content rendered between the four metric cards and the heatmap. */
  belowMetrics?: ReactNode;
}

/** Four inline metrics and the daily heatmap, styled to match the tray overview. */
export const DashboardOverviewCard = memo(function DashboardOverviewCard({
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
  belowMetrics,
}: DashboardOverviewCardProps) {
  const metricTrendValues = useMemo(
    () => buildUsageMetricTrendValues(metricTrendRows),
    [metricTrendRows],
  );
  const requestCaption = showLocalMetrics
    ? formatRequestCaption(summary)
    : null;
  const cacheHitRate = showLocalMetrics
    ? cacheHitRateFromSummary(summary)
    : null;
  const reserveCaption = showLocalMetrics;
  const showCostTrend = !showLocalMetrics || (costReport !== null && costReport.filters.sources.length === 0 && costReport.summary.costExplanation.unpricedTokens === 0);
  const metrics = [
    {
      id: 'cost',
      label: '预估费用',
      value: costReport?.summary.knownCostUsd ?? summary.totalCostUsd,
      format: formatUsd,
      exactFormat: formatUsd,
      caption:
        costReport && costReport.summary.costExplanation.unpricedTokens > 0
          ? '部分用量未计价'
          : costReport && costReport.summary.costExplanation.defaultPricedTokens > 0
            ? '含默认价格估算'
            : null as string | null,
      trend: {
        comparison: showCostTrend ? metricTrends.totalCostUsd : null,
        display: 'percent' as const,
        values: showCostTrend ? metricTrendValues.costUsd : [],
      },
    },
    {
      id: 'total-tokens',
      label: '总 Token',
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
      label: '输入 Token',
      value: summary.inputTokens,
      format: formatTokens,
      exactFormat: formatTokensExact,
      caption:
        cacheHitRate == null
          ? null
          : `缓存命中率 ${(cacheHitRate * 100).toFixed(1)}%`,
      trend: {
        comparison: metricTrends.inputTokens,
        display: 'tokens' as const,
        values: metricTrendValues.inputTokens,
      },
    },
    {
      id: 'output-tokens',
      label: '输出 Token',
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
    <section aria-label="用量概览" className="w-full">
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
                    <div aria-label={costExplanationLoading ? '预估费用加载中' : '预估费用暂不可用'} className="min-w-0 truncate text-lg font-semibold leading-7 tracking-tight text-muted">
                      —
                    </div>
                  ) : metric.id === 'cost' && costReport && costReport.summary.tokens > 0 && costReport.summary.costExplanation.unpricedTokens >= costReport.summary.tokens ? (
                    <div aria-label="预估费用未知" className="min-w-0 truncate text-lg font-semibold leading-7 tracking-tight text-foreground tabular-nums" title="未知">
                      未知
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
                  label={`${metricTrendPeriodLabel}${metric.label}趋势`}
                  values={metric.trend.values}
                />
              </div>
            </Card.Content>
          </Card>
        ))}
      </div>

      <DashboardSessionCards metrics={sessionMetrics} />

      {belowMetrics}

      <div className="mt-4 rounded-2xl border border-border/60 bg-surface p-4 sm:p-5">
        <HeatmapSection
          days={heatmapDays}
          modelRows={modelRows}
          onSelectDate={onSelectDate}
          selectedDate={selectedDate}
        />
          <AchievementActivityLink />
      </div>
    </section>
  );
});

/** Prefer complete count; fall back to known evidence without "至少" wording. */
function formatRequestCaption(summary: DashboardUsageSummary): string | null {
  const count = summary.requestCount ?? summary.knownRequestCount;
  if (count == null) return null;
  return `${count.toLocaleString('zh-CN')} 次请求`;
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
  return (
    <MetricHelpLabel
      ariaLabel="总 Token 构成说明"
      heading="总 Token 构成"
      label="总 Token"
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
  return (
    <MetricHelpLabel
      ariaLabel="缓存命中率说明"
      heading="缓存命中率"
      label="输入 Token"
      panel={<CacheHitRateHelpPanel />}
    />
  );
}

function CacheHitRateHelpPanel() {
  return (
    <div className="grid max-w-56 gap-1.5 text-xs">
      <p className="font-medium text-foreground">缓存命中率</p>
      <p className="leading-4 text-muted">
        缓存读 ÷（输入 + 缓存读 + 缓存写）
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
      <p className="font-medium text-foreground">Token 构成</p>
      <BreakdownRow label="输入" value={input} />
      <BreakdownRow label="输出" value={output} />
      <div className="grid gap-1">
        <p className="text-muted">缓存</p>
        <BreakdownRow indented label="读" value={cacheRead} />
        <BreakdownRow indented label="写" value={cacheWrite} />
      </div>
      <BreakdownRow label="其它" value={other} />
      <div className="my-0.5 h-px bg-border/70" />
      <BreakdownRow emphasize label="合计" value={summary.totalTokens} />
      <p className="pt-0.5 text-[10px] leading-4 text-muted">
        总 Token = 输入 + 输出 + 缓存读 + 缓存写 + 其它
      </p>
      {showRequestHelp ? (
        <p className="pt-1 text-[10px] leading-4 text-muted">
          请求数优先用本地请求证据；无证据时按 conversation 累计
          {requestIncomplete ? '，不完整时可能偏低' : ''}
          。
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
  const isIncrease = trend.changeValue >= 0;
  const direction = isIncrease ? '上涨' : '下降';
  const label =
    display === 'tokens'
      ? `${isIncrease ? '+' : '−'}${formatTokens(Math.abs(trend.changeValue))}`
      : `${Math.abs(trend.changePct).toFixed(1)}%`;

  return (
    <Chip
      aria-label={`${direction} ${label}`}
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
