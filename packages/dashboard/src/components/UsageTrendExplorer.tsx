import { useMemo, useState } from 'react';
import { Card, Tabs } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { Area, Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';
import type { TrendGranularity, UsageTrend } from 'quotern-core';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ChartPrimitives';
import { DashboardMetricTabs } from '@/components/DashboardMetricTabs';
import { useUsageTrend } from '../hooks/useUsageTrend';
import { chartColor } from '@/lib/chart-data';
import { isCliBackend } from '@/lib/api';
import { formatTokens, formatUsd } from '@/lib/format';
import type { DashboardDateRange } from '@/lib/dashboard-date-range';
import type { DashboardDailyUsageRow, DashboardHourlyUsageRow } from '@/lib/dashboard-mock-data';
import { TokenUsageTrendCard } from '@/components/TokenUsageTrendCard';
import { DailyUsageTrendCard } from '@/components/DailyUsageTrendCard';

interface Props {
  variant: 'tokens' | 'usage'; days: number; selectedDate: string | null; dateRange: DashboardDateRange | null;
  sources: readonly string[]; enabled: boolean; hourly: boolean; dayScoped: boolean;
  dailyRows: DashboardDailyUsageRow[]; hourlyRows: DashboardHourlyUsageRow[]; rangeLabel?: string;
}
/** Shared by Dashboard and Desktop. Only this chart's grain changes. */
export function UsageTrendExplorer(props: Props) {
  if (!isCliBackend()) return props.variant === 'tokens'
    ? <TokenUsageTrendCard hourly={props.hourly} dayScoped={props.dayScoped} hourlyRows={props.hourlyRows} dailyRows={props.dailyRows} />
    : <DailyUsageTrendCard hourly={props.hourly} dayScoped={props.dayScoped} hourlyRows={props.hourlyRows} rows={props.dailyRows} rangeDays={props.days} rangeLabel={props.rangeLabel} />;
  return <LocalUsageTrendExplorer {...props} />;
}
function LocalUsageTrendExplorer(props: Props) {
  const { t } = useTranslation();
  const [grain, setGrain] = useState<TrendGranularity | 'auto'>('auto');
  const [metric, setMetric] = useState<'tokens' | 'cost'>('tokens');
  const [view, setView] = useState<'all' | 'detail'>('all');
  const [grouping, setGrouping] = useState<'total' | 'models'>('total');
  const effectiveGrain = grain === 'auto' ? props.hourly ? 'hourly' : 'daily' : grain;
  const { data, error } = useUsageTrend(props.days, props.selectedDate, props.dateRange, props.sources, effectiveGrain, props.enabled);
  const chart = useMemo(() => data ? projectChart(data, metric, props.variant === 'tokens' && view === 'detail', metric === 'cost' && grouping === 'models', t) : null, [data, metric, view, grouping, props.variant, t]);
  return <Card className="h-full min-w-0 overflow-hidden rounded-2xl">
    <Card.Header className="flex-row flex-wrap items-start justify-between gap-3 pb-0">
      <div className="min-w-0 flex-1"><Card.Title>{t(props.variant === 'tokens' ? 'usage.explorer.tokenTitle' : 'usage.explorer.costTitle')}</Card.Title><Card.Description className="mt-1">{data ? `${data.fromDate} – ${data.toDate}` : t('usage.explorer.range')}</Card.Description></div>
      {props.variant === 'usage' ? <DashboardMetricTabs ariaLabel={t('usage.chart.dailyMetric')} metrics={['tokens', 'cost'] as const} selectedMetric={metric} onMetricChange={setMetric} />
        : <Tabs selectedKey={view} onSelectionChange={key => setView(String(key) as 'all' | 'detail')}><Tabs.ListContainer><Tabs.List aria-label={t('usage.chart.viewMode')} className="*:h-6 *:px-3 *:text-xs">{(['all', 'detail'] as const).map(value => <Tabs.Tab id={value} key={value}>{t(`usage.common.${value}`)}<Tabs.Indicator /></Tabs.Tab>)}</Tabs.List></Tabs.ListContainer></Tabs>}
    </Card.Header>
    <Card.Content className="pt-3">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-xs text-muted">{t('usage.explorer.grain')}<select aria-label={t('usage.explorer.grain')} className="rounded-lg border border-separator bg-surface px-2 py-1 text-foreground focus-visible:outline-accent" value={grain} onChange={event => setGrain(event.target.value as typeof grain)}>{(['auto', 'hourly', 'daily', 'weekly', 'monthly'] as const).map(value => <option key={value} value={value}>{t(`usage.explorer.${value}`)}</option>)}</select></label>
        {props.variant === 'usage' && metric === 'cost' && <label className="flex items-center gap-2 text-xs text-muted">{t('usage.explorer.grouping')}<select aria-label={t('usage.explorer.grouping')} className="rounded-lg border border-separator bg-surface px-2 py-1 text-foreground focus-visible:outline-accent" value={grouping} onChange={event => setGrouping(event.target.value as typeof grouping)}>{(['total', 'models'] as const).map(value => <option value={value} key={value}>{t(`usage.explorer.${value}`)}</option>)}</select></label>}
      </div>
      {error && <p role="status" className="mb-2 text-xs text-warning">{t('usage.explorer.error')}</p>}
      {!chart ? <p role="status" className="flex h-[260px] items-center justify-center text-sm text-muted">{t(error ? 'usage.explorer.error' : 'usage.explorer.loading')}</p>
        : <><ChartContainer config={chart.config} className="h-[260px] w-full" initialDimension={{ width: 720, height: 260 }}>
          <ComposedChart data={chart.rows} accessibilityLayer margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={24} interval="preserveStartEnd" tick={{ fontSize: 11 }} />
            <YAxis axisLine={false} tickLine={false} width={58} tickFormatter={value => metric === 'cost' ? formatUsd(Number(value)) : formatTokens(Number(value))} tick={{ fontSize: 11 }} />
            <ChartTooltip formatter={(value, name) => [metric === 'cost' ? formatUsd(Number(value)) : formatTokens(Number(value)), chart.config[String(name)]?.label ?? name]} contentStyle={{ background: 'var(--overlay)', color: 'var(--overlay-foreground)', borderRadius: 10, border: 0 }} />
            {chart.keys.map(key => metric === 'cost' && grouping === 'models' ? <Area key={key} type="monotone" dataKey={key} stackId="models" stroke={`var(--color-${key})`} fill={`var(--color-${key})`} fillOpacity={0.6} isAnimationActive={false} />
              : props.variant === 'usage' && metric === 'tokens' ? <Bar key={key} dataKey={key} fill={`var(--color-${key})`} stackId="tokens" maxBarSize={32} isAnimationActive={false} />
                : <Line key={key} type="monotone" dataKey={key} stroke={`var(--color-${key})`} dot={chart.rows.length === 1 ? { r: 4 } : false} strokeWidth={2} isAnimationActive={false} />)}
          </ComposedChart>
        </ChartContainer><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">{chart.keys.map(key => <span className="inline-flex min-w-0 items-center gap-1.5" key={key}><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: chart.config[key]?.color }} /><span className="max-w-52 truncate" title={String(chart.config[key]?.label)}>{chart.config[key]?.label}</span></span>)}</div></>}
      {!!data?.points.some(point => point.unpricedTokens > 0) && metric === 'cost' && <p className="mt-2 text-[11px] text-muted">{t('usage.explorer.partial')}</p>}
    </Card.Content>
  </Card>;
}

function projectChart(data: UsageTrend, metric: 'tokens' | 'cost', detail: boolean, byModel: boolean, t: (key: string) => string) {
  const config: ChartConfig = {};
  let keys: string[];
  const modelNames = data.models.slice(0, 6);
  const colors = new Map(Object.entries(data.points.reduce<Record<string, number>>((totals, point) => { for (const [model, value] of Object.entries(point.models)) totals[model] = (totals[model] ?? 0) + value.tokens; return totals; }, {})).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name], i) => [name, chartColor(i)]));
  if (byModel) {
    keys = modelNames.map((model, i) => { const key = `m${i}`; config[key] = { label: model, color: colors.get(model) }; return key; });
    if (data.models.length > 6) { keys.push('other'); config.other = { label: t('usage.explorer.otherModels'), color: chartColor(7) }; }
  } else if (detail || metric === 'tokens' && data.granularity && !detail) {
    keys = detail ? ['inputTokens', 'cacheReadTokens', 'outputTokens', 'otherTokens'] : ['tokens'];
    keys.forEach((key, i) => config[key] = { label: t(({ inputTokens: 'usage.common.input', outputTokens: 'usage.common.output', cacheReadTokens: 'usage.distribution.cacheRead', otherTokens: 'usage.common.other', tokens: 'usage.common.totalTokens' } as Record<string, string>)[key]!), color: chartColor(i) });
  } else { keys = ['cost']; config.cost = { label: t('usage.common.cost'), color: chartColor(4) }; }
  const rows = data.points.map(point => {
    const label = data.granularity === 'hourly' ? `${point.key.slice(5, 10)} ${point.key.slice(-2)}:00` : data.granularity === 'monthly' ? point.key : point.key.slice(5);
    const values: Record<string, string | number> = { label, tokens: point.tokens, inputTokens: point.inputTokens, cacheReadTokens: point.cacheReadTokens, outputTokens: point.outputTokens, otherTokens: point.cacheWriteTokens + point.reasoningTokens, cost: point.knownCostUsd };
    modelNames.forEach((model, i) => { values[`m${i}`] = point.models[model]?.knownCostUsd ?? 0; });
    values.other = Object.entries(point.models).reduce((sum, [model, value]) => sum + (modelNames.includes(model) ? 0 : value.knownCostUsd), 0);
    return values;
  });
  return { config, keys, rows };
}
