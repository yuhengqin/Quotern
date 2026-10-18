import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Label, ListBox, Select, Tabs } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { Area, Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';
import type { UsageTrend } from 'quotern-core';
import { CHART_TOOLTIP_SURFACE_CLASSNAME, ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ChartPrimitives';
import { DashboardMetricTabs } from '@/components/DashboardMetricTabs';
import { useUsageTrend } from '../hooks/useUsageTrend';
import { chartColor } from '@/lib/chart-data';
import { isCliBackend } from '@/lib/api';
import { formatTokens, formatUsd } from '@/lib/format';
import type { DashboardDateRange } from '@/lib/dashboard-date-range';
import type { DashboardDailyUsageRow, DashboardHourlyUsageRow } from '@/lib/dashboard-mock-data';
import { TokenUsageTrendCard } from '@/components/TokenUsageTrendCard';
import { DailyUsageTrendCard } from '@/components/DailyUsageTrendCard';
import { localDateNow } from '@/lib/stats-timezone';
import { formatTrendDateRange, formatTrendPointLabels, getTrendAxisTicks, getTrendControls, getTrendDateRange, type TrendSelection } from '../lib/usage-trend-controls';

interface Props {
  days: number; selectedDate: string | null; dateRange: DashboardDateRange | null;
  sources: readonly string[]; enabled: boolean; hourly: boolean; dayScoped: boolean;
  dailyRows: DashboardDailyUsageRow[]; hourlyRows: DashboardHourlyUsageRow[]; rangeLabel?: string;
}

const TOKEN_BREAKDOWN_KEYS = ['inputTokens', 'cacheReadTokens', 'outputTokens', 'otherTokens'] as const;
const TOKEN_SERIES = {
  tokens: { label: 'usage.common.totalTokens', color: chartColor(0) },
  inputTokens: { label: 'usage.common.input', color: chartColor(0) },
  cacheReadTokens: { label: 'usage.distribution.cacheRead', color: chartColor(2) },
  outputTokens: { label: 'usage.common.output', color: chartColor(1) },
  otherTokens: { label: 'usage.common.other', color: chartColor(5) },
};

/** Both clients share the interval and query so the two charts have comparable time axes. */
export function UsageTrendExplorer(props: Props) {
  if (!isCliBackend()) return <>
    <TokenUsageTrendCard hourly={props.hourly} dayScoped={props.dayScoped} hourlyRows={props.hourlyRows} dailyRows={props.dailyRows} />
    <DailyUsageTrendCard hourly={props.hourly} dayScoped={props.dayScoped} hourlyRows={props.hourlyRows} rows={props.dailyRows} rangeDays={props.days} rangeLabel={props.rangeLabel} />
  </>;
  return <LocalUsageTrendExplorer {...props} />;
}
function LocalUsageTrendExplorer(props: Props) {
  const { t } = useTranslation();
  const [grain, setGrain] = useState<TrendSelection>('auto');
  const chartGrid = useRef<HTMLDivElement>(null);
  const [cardWidth, setCardWidth] = useState(320);
  const today = localDateNow();
  const range = getTrendDateRange(props.days, props.selectedDate, props.dateRange, today);
  const controls = getTrendControls(range, grain);
  useEffect(() => {
    if (grain !== controls.selection) setGrain(controls.selection);
  }, [grain, controls.selection]);
  const { data, error } = useUsageTrend(props.days, props.selectedDate, props.dateRange, props.sources, controls.granularity, props.enabled);
  useEffect(() => {
    const grid = chartGrid.current;
    if (!grid) return;
    const updateWidth = () => {
      const widths = Array.from(grid.children).map(card => card.getBoundingClientRect().width).filter(width => width > 0);
      if (widths.length) setCardWidth(Math.min(...widths));
    };
    const observer = new ResizeObserver(updateWidth);
    observer.observe(grid);
    Array.from(grid.children).forEach(card => observer.observe(card));
    updateWidth();
    return () => observer.disconnect();
  }, []);
  const singleDay = range.start === range.end;
  const ticks = useMemo(() => data ? getTrendAxisTicks(data.points, data.granularity, singleDay, cardWidth) : [], [data, singleDay, cardWidth]);
  const options = [
    { value: 'auto', label: t('usage.explorer.autoResolved', { grain: t(`usage.explorer.${controls.autoGranularity}`) }) },
    ...controls.options.map(value => ({ value, label: t(`usage.explorer.${value}`) })),
  ];
  return <div className="min-w-0 lg:col-span-2">
    <div role="group" aria-label={t('usage.explorer.grain')} className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
      <p className="min-w-0 text-xs text-muted">{formatTrendDateRange(range, today, t('usage.range.today'))}</p>
      <TrendSelect label={t('usage.explorer.grain')} value={controls.selection} options={options} onChange={value => {
        if (options.some(option => option.value === value)) setGrain(value as TrendSelection);
      }} />
    </div>
    <div ref={chartGrid} className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
      <TrendChart variant="tokens" data={data} error={error} singleDay={singleDay} ticks={ticks} />
      <TrendChart variant="usage" data={data} error={error} singleDay={singleDay} ticks={ticks} />
    </div>
  </div>;
}

function TrendSelect({ label, value, options, onChange }: {
  label: string; value: string; options: readonly { value: string; label: string }[]; onChange: (value: string) => void;
}) {
  return <Select aria-label={label} value={value} onChange={key => { if (typeof key === 'string') onChange(key); }} variant="secondary" className="w-fit min-w-0 max-w-full">
    <Label className="sr-only">{label}</Label>
    <Select.Trigger className="!h-8 !min-h-8 !w-fit max-w-full !rounded-full ps-3 pe-8 !text-xs font-normal">
      <Select.Value className="min-w-0 truncate" /><Select.Indicator className="size-3.5 text-muted" />
    </Select.Trigger>
    <Select.Popover className="min-w-36 rounded-xl bg-surface shadow-md" placement="bottom end">
      <ListBox aria-label={label}>{options.map(option => <ListBox.Item id={option.value} key={option.value} textValue={option.label} className="rounded-lg px-2 py-1.5 text-xs">
        {option.label}<ListBox.ItemIndicator />
      </ListBox.Item>)}</ListBox>
    </Select.Popover>
  </Select>;
}

function TrendChart({ variant, data, error, singleDay, ticks }: { variant: 'tokens' | 'usage'; data: UsageTrend | null; error: boolean; singleDay: boolean; ticks: string[] }) {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<'tokens' | 'cost'>('tokens');
  const [view, setView] = useState<'all' | 'detail'>('all');
  const [grouping, setGrouping] = useState<'total' | 'models'>('total');
  const chart = useMemo(() => data ? projectChart(data, metric, metric === 'tokens' && (variant === 'usage' || view === 'detail'), metric === 'cost' && grouping === 'models', t, singleDay) : null, [data, metric, view, grouping, variant, t, singleDay]);
  return <Card className="h-full min-w-0 overflow-hidden rounded-2xl">
    <Card.Header className="flex-row flex-wrap items-start justify-between gap-3 pb-0">
      <Card.Title className="min-w-0 flex-1 basis-40">{t(variant === 'tokens' ? 'usage.explorer.tokenTitle' : 'usage.explorer.costTitle')}</Card.Title>
      <div className="flex max-w-full flex-wrap items-center gap-2">
      {variant === 'usage' && metric === 'cost' && <TrendSelect label={t('usage.explorer.grouping')} value={grouping} options={(['total', 'models'] as const).map(value => ({ value, label: t(`usage.explorer.${value}`) }))} onChange={value => { if (value === 'total' || value === 'models') setGrouping(value); }} />}
      {variant === 'usage' ? <DashboardMetricTabs ariaLabel={t('usage.chart.dailyMetric')} metrics={['tokens', 'cost'] as const} selectedMetric={metric} onMetricChange={setMetric} />
        : <Tabs selectedKey={view} onSelectionChange={key => setView(String(key) as 'all' | 'detail')}><Tabs.ListContainer><Tabs.List aria-label={t('usage.chart.viewMode')} className="*:h-6 *:px-3 *:text-xs">{(['all', 'detail'] as const).map(value => <Tabs.Tab id={value} key={value}>{t(`usage.common.${value}`)}<Tabs.Indicator /></Tabs.Tab>)}</Tabs.List></Tabs.ListContainer></Tabs>}
      </div>
    </Card.Header>
    <Card.Content className="pt-3">
      {error && <p role="status" className="mb-2 text-xs text-warning">{t('usage.explorer.error')}</p>}
      {!chart ? <p role="status" className="flex h-[260px] items-center justify-center text-sm text-muted">{t(error ? 'usage.explorer.error' : 'usage.explorer.loading')}</p>
        : <><ChartContainer config={chart.config} className="h-[260px] w-full" initialDimension={{ width: 720, height: 260 }}>
          <ComposedChart data={chart.rows} accessibilityLayer margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" axisLine={false} tickLine={false} ticks={ticks} interval={0} tick={({ x, y, payload }) => <text x={x} y={y} dy={12} fontSize={11} className="fill-muted" textAnchor={ticks.length > 1 && payload.value === ticks[0] ? 'start' : ticks.length > 1 && payload.value === ticks.at(-1) ? 'end' : 'middle'}>{payload.value}</text>} />
            <YAxis axisLine={false} tickLine={false} width={58} tickFormatter={value => metric === 'cost' ? formatUsd(Number(value)) : formatTokens(Number(value))} tick={{ fontSize: 11 }} />
            <ChartTooltip content={metric === 'tokens' ? <TokenTrendTooltip weekly={data?.granularity === 'weekly'} /> : undefined} labelFormatter={data?.granularity === 'weekly' ? (label, payload) => {
              const point = payload?.[0]?.payload as { tooltipLabel?: string; partialWeek?: boolean } | undefined;
              return <div>
                <p>{t('usage.explorer.reportedPeriod', { range: point?.tooltipLabel ?? String(label) })}</p>
                {point?.partialWeek && <p className="mt-1 text-xs text-muted">{t('usage.explorer.partialWeek')}</p>}
              </div>;
            } : undefined} formatter={(value, name) => [metric === 'cost' ? formatUsd(Number(value)) : formatTokens(Number(value)), chart.config[String(name)]?.label ?? name]} contentStyle={{ background: 'var(--overlay)', color: 'var(--overlay-foreground)', borderRadius: 10, border: 0 }} />
            {chart.keys.map(key => metric === 'cost' && grouping === 'models' ? <Area key={key} type="monotone" dataKey={key} stackId="models" stroke={`var(--color-${key})`} fill={`var(--color-${key})`} fillOpacity={0.6} isAnimationActive={false} />
              : variant === 'usage' && metric === 'tokens' ? <Bar key={key} dataKey={key} fill={`var(--color-${key})`} stackId="tokens" maxBarSize={32} isAnimationActive={false} />
                : <Line key={key} type="monotone" dataKey={key} stroke={`var(--color-${key})`} dot={chart.rows.length === 1 ? { r: 4 } : false} strokeWidth={2} isAnimationActive={false} />)}
          </ComposedChart>
        </ChartContainer><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">{chart.keys.map(key => <span className="inline-flex min-w-0 items-center gap-1.5" key={key}><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: chart.config[key]?.color }} /><span className="max-w-52 truncate" title={String(chart.config[key]?.label)}>{chart.config[key]?.label}</span></span>)}</div></>}
      {!!data?.points.some(point => point.unpricedTokens > 0) && metric === 'cost' && <p className="mt-2 text-[11px] text-muted">{t('usage.explorer.partial')}</p>}
    </Card.Content>
  </Card>;
}

/** Read the full bucket so the total-only line still exposes every Token component. */
function TokenTrendTooltip({ active, payload, weekly }: {
  active?: boolean;
  payload?: readonly { payload?: Record<string, string | number | boolean> }[];
  weekly?: boolean;
}) {
  const { t } = useTranslation();
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return <div className={`grid min-w-48 gap-2 px-3 py-2.5 text-xs ${CHART_TOOLTIP_SURFACE_CLASSNAME}`}>
    <div className="font-medium">
      {weekly ? t('usage.explorer.reportedPeriod', { range: String(point.tooltipLabel) }) : point.tooltipLabel}
    </div>
    {weekly && point.partialWeek && <p className="text-xs text-muted">{t('usage.explorer.partialWeek')}</p>}
    <div className="grid gap-1.5">
      {(['tokens', ...TOKEN_BREAKDOWN_KEYS] as const).map(key => <div className="flex items-center justify-between gap-4" key={key}>
        <span className="inline-flex items-center gap-1.5 text-muted">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TOKEN_SERIES[key].color }} />
          {t(key === 'tokens' ? 'usage.common.total' : TOKEN_SERIES[key].label)}
        </span>
        <span className="font-mono font-medium tabular-nums">{formatTokens(Number(point[key]))}</span>
      </div>)}
    </div>
  </div>;
}

function projectChart(data: UsageTrend, metric: 'tokens' | 'cost', detail: boolean, byModel: boolean, t: (key: string) => string, singleDay: boolean) {
  const config: ChartConfig = {};
  let keys: string[];
  const modelNames = data.models.slice(0, 6);
  const colors = new Map(Object.entries(data.points.reduce<Record<string, number>>((totals, point) => { for (const [model, value] of Object.entries(point.models)) totals[model] = (totals[model] ?? 0) + value.tokens; return totals; }, {})).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name], i) => [name, chartColor(i)]));
  if (byModel) {
    keys = modelNames.map((model, i) => { const key = `m${i}`; config[key] = { label: model, color: colors.get(model) }; return key; });
    if (data.models.length > 6) { keys.push('other'); config.other = { label: t('usage.explorer.otherModels'), color: chartColor(7) }; }
  } else if (metric === 'tokens') {
    keys = detail ? [...TOKEN_BREAKDOWN_KEYS] : ['tokens'];
    Object.entries(TOKEN_SERIES).forEach(([key, series]) => config[key] = { ...series, label: t(series.label) });
  } else { keys = ['cost']; config.cost = { label: t('usage.common.cost'), color: chartColor(4) }; }
  const rows = data.points.map(point => {
    const { axisLabel: label, tooltipLabel, partialWeek } = formatTrendPointLabels(point, data.granularity, singleDay);
    const values: Record<string, string | number | boolean> = { label, tooltipLabel, partialWeek, tokens: point.tokens, inputTokens: point.inputTokens, cacheReadTokens: point.cacheReadTokens, outputTokens: point.outputTokens, otherTokens: point.cacheWriteTokens + point.reasoningTokens, cost: point.knownCostUsd };
    modelNames.forEach((model, i) => { values[`m${i}`] = point.models[model]?.knownCostUsd ?? 0; });
    values.other = Object.entries(point.models).reduce((sum, [model, value]) => sum + (modelNames.includes(model) ? 0 : value.knownCostUsd), 0);
    return values;
  });
  return { config, keys, rows };
}
