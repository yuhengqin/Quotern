import { memo, useId, useMemo, useState } from 'react';
import { Card, Tabs } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CHART_TOOLTIP_SURFACE_CLASSNAME,
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from '@/components/ChartPrimitives';
import {
  buildUsageTrendChartRows,
  type UsageTrendChartPoint,
} from 'quotern-core/dashboard-trend';
import type {
  DashboardDailyUsageRow,
  DashboardHourlyUsageRow,
} from '@/lib/dashboard-mock-data';
import { formatTokens } from '@/lib/format';
import { cn } from '@/lib/utils';

const SERIES_KEYS = [
  'inputTokens',
  'outputTokens',
  'cachedInputTokens',
  'otherTokens',
] as const;
type SeriesKey = (typeof SERIES_KEYS)[number];
type TokenTrendView = 'all' | 'detail';

const CHART_CONFIG = {
  totalTokens: { label: 'usage.common.totalTokens', color: '#1F6FE5' },
  inputTokens: { label: 'usage.common.input', color: '#71BD99' },
  outputTokens: { label: 'usage.common.output', color: '#397FEC' },
  cachedInputTokens: { label: 'usage.common.cache', color: '#E9A846' },
  otherTokens: { label: 'usage.common.other', color: '#8C7AE6' },
} satisfies ChartConfig;

interface TokenUsageTrendCardProps {
  /** When true (today / rangeDays === 1), chart uses hourly buckets. */
  hourly: boolean;
  hourlyRows: DashboardHourlyUsageRow[];
  dailyRows: DashboardDailyUsageRow[];
  /** Heatmap day filter — use 「当日」 copy instead of 「今日」. */
  dayScoped?: boolean;
}

/** Token usage trends, with a concise total view and detailed line breakdown. */
export const TokenUsageTrendCard = memo(function TokenUsageTrendCard({
  hourly,
  hourlyRows,
  dailyRows,
  dayScoped = false,
}: TokenUsageTrendCardProps) {
  const { t } = useTranslation();
  const chartConfig = Object.fromEntries(
    Object.entries(CHART_CONFIG).map(([key, value]) => [key, { ...value, label: t(value.label) }]),
  ) as ChartConfig;
  const gradientId = useId().replace(/:/g, '');
  const [trendView, setTrendView] = useState<TokenTrendView>('all');

  const rows = useMemo(
    () => buildUsageTrendChartRows({ dailyRows, hourly, hourlyRows }),
    [dailyRows, hourly, hourlyRows],
  );

  const title = hourly
    ? dayScoped
      ? t('usage.chart.dayTokens')
      : t('usage.chart.todayTokens')
    : t('usage.chart.tokens');
  const description =
    trendView === 'all'
      ? t('usage.chart.totalTrend')
      : t('usage.chart.breakdownTrend');

  return (
    <Card className="h-full min-w-0 overflow-hidden rounded-2xl">
      <Card.Header className="flex-row flex-nowrap items-start justify-between gap-4 pb-0">
        <div className="min-w-0 flex-1">
          <Card.Title>{title}</Card.Title>
          <Card.Description className="mt-1">{description}</Card.Description>
        </div>
        <Tabs
          aria-label={t('usage.chart.viewMode')}
          className="w-fit shrink-0 text-center"
          selectedKey={trendView}
          onSelectionChange={(key) =>
            setTrendView(String(key) as TokenTrendView)
          }
        >
          <Tabs.ListContainer>
            <Tabs.List
              aria-label={t('usage.chart.viewMode')}
              className="w-fit *:h-6 *:w-fit *:px-3 *:text-sm *:font-normal *:data-[selected=true]:text-accent-foreground"
            >
              <Tabs.Tab id="all">
                <span className="text-xs font-normal">{t('usage.common.all')}</span>
                <Tabs.Indicator className="bg-accent" />
              </Tabs.Tab>
              <Tabs.Tab id="detail">
                <span className="text-xs font-normal">{t('usage.common.detail')}</span>
                <Tabs.Indicator className="bg-accent" />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
      </Card.Header>
      <Card.Content className="pt-4">
        {rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">{t('usage.common.noData')}</p>
        ) : (
          <ChartContainer
            className="h-[260px] w-full"
            config={chartConfig}
            initialDimension={{ width: 720, height: 260 }}
          >
            <ComposedChart
              accessibilityLayer
              data={rows}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <defs>
                {(trendView === 'all'
                  ? (['totalTokens'] as const)
                  : SERIES_KEYS
                ).map((key) => (
                  <linearGradient
                    id={`${gradientId}-${key}`}
                    key={key}
                    x1="0"
                    x2="0"
                    y1="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={`var(--color-${key})`} stopOpacity={0.32} />
                    <stop offset="72%" stopColor={`var(--color-${key})`} stopOpacity={0.08} />
                    <stop offset="100%" stopColor={`var(--color-${key})`} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="label"
                interval={hourly ? 2 : 'preserveEnd'}
                tickFormatter={(value: string) => (hourly ? value : value.slice(5))}
                tickLine={false}
                tickMargin={10}
              />
              <YAxis
                axisLine={false}
                tick={({ payload, y }) => (
                  <text
                    className="fill-muted text-xs"
                    dy="0.32em"
                    textAnchor="start"
                    x={0}
                    y={y}
                  >
                    {formatTokens(Number(payload?.value ?? 0))}
                  </text>
                )}
                tickLine={false}
                width={56}
              />
              <ChartTooltip
                content={<TokenDayTooltip />}
                cursor={{ stroke: 'var(--border)', strokeDasharray: '3 3' }}
              />
              {trendView === 'all' ? (
                <TrendSeries gradientId={gradientId} seriesKey="totalTokens" />
              ) : (
                SERIES_KEYS.map((key) => (
                  <TrendSeries gradientId={gradientId} key={key} seriesKey={key} />
                ))
              )}
            </ComposedChart>
          </ChartContainer>
        )}
      </Card.Content>
    </Card>
  );
});

function TrendSeries({
  gradientId,
  seriesKey,
}: {
  gradientId: string;
  seriesKey: 'totalTokens' | SeriesKey;
}) {
  return (
    <>
      <Area
        dataKey={seriesKey}
        fill={`url(#${gradientId}-${seriesKey})`}
        fillOpacity={1}
        isAnimationActive={false}
        legendType="none"
        stroke="none"
        type="monotone"
      />
      <Line
        activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 1.5 }}
        dataKey={seriesKey}
        dot={false}
        isAnimationActive={false}
        stroke={`var(--color-${seriesKey})`}
        strokeLinecap="round"
        strokeWidth={2.25}
        type="monotone"
      />
    </>
  );
}

/** Tooltip exposes the complete Token breakdown for the hovered bucket. */
function TokenDayTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Record<string, unknown> }>;
}) {
  const { t } = useTranslation();
  if (!active || !payload?.length) return null;

  const row = payload[0]?.payload as UsageTrendChartPoint | undefined;
  if (!row) return null;

  return (
    <div
      className={cn(
        'grid min-w-40 items-start gap-1.5 px-2.5 py-1.5 text-xs font-medium',
        CHART_TOOLTIP_SURFACE_CLASSNAME,
      )}
    >
      <div className="font-medium">{row.label}</div>
      <div className="grid gap-1.5">
        <div className="flex w-full items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: CHART_CONFIG.totalTokens.color }}
            />
            {t('usage.common.total')}
          </span>
          <span className="font-mono tabular-nums text-foreground">
            {formatTokens(row.totalTokens)}
          </span>
        </div>
        {SERIES_KEYS.map((key) => (
          <div className="flex w-full items-center justify-between gap-4" key={key}>
            <span className="flex items-center gap-1.5 text-muted">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: CHART_CONFIG[key].color }}
              />
              {t(CHART_CONFIG[key].label)}
            </span>
            <span className="font-mono tabular-nums text-foreground">
              {formatTokens(Number(row[key] ?? 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
