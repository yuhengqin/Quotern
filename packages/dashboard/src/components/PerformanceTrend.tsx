import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { useTranslation } from 'quotern-i18n/react';
import type { PerformanceReport } from 'quotern-core';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from './ChartPrimitives';

/** Index-based keys keep arbitrary model IDs out of CSS custom properties. */
export function PerformanceTrend({ report, kind, compare = false }: { report: PerformanceReport; kind: 'latency' | 'speed'; compare?: boolean }) {
  const { t, i18n } = useTranslation();
  const metric = kind === 'latency' ? 'ttftP50Ms' : 'tokensPerSecond';
  const samples = kind === 'latency' ? 'ttftSampleCount' : 'speedSampleCount';
  const number = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(value);
  const colors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
  const series: Array<{ key: string; label: string; color: string; trend: PerformanceReport['trend']; metric: 'ttftP50Ms' | 'ttftP95Ms' | 'tokensPerSecond' }> = compare ? (report.comparison ?? []).map((row, i) => ({ key: `series${i}`, label: row.model, color: colors[i]!, trend: row.trend, metric }))
    : kind === 'latency' ? [
      { key: 'series0', label: t('insights.ttft50'), color: 'var(--accent)', trend: report.trend, metric: 'ttftP50Ms' as const },
      { key: 'series1', label: t('insights.ttft95'), color: 'var(--warning)', trend: report.trend, metric: 'ttftP95Ms' as const },
    ] : [{ key: 'series0', label: t('insights.speed'), color: 'var(--accent)', trend: report.trend, metric }];
  const dates = [...new Set(series.flatMap(row => row.trend.map(day => day.date)))].sort();
  const rows = dates.map(date => Object.fromEntries([['date', date], ...series.flatMap(row => {
    const day = row.trend.find(day => day.date === date);
    return [[row.key, day?.[row.metric] ?? null], [`${row.key}Count`, day?.[samples] ?? 0]];
  })]));
  const hasSamples = series.some(row => row.trend.some(day => day[samples] > 0));
  return <section className="min-w-0 rounded-2xl bg-surface p-4">
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-semibold">{t(compare ? kind === 'latency' ? 'insights.compareLatency' : 'insights.compareSpeed' : kind === 'latency' ? 'insights.latencyTrend' : 'insights.speedTrend')}</h2><span className="text-xs text-muted">{t(kind === 'latency' ? 'insights.unitSeconds' : 'insights.unitSpeed')}</span></div>
    {hasSamples ? <ChartContainer className="h-64 w-full" config={Object.fromEntries(series.map(row => [row.key, { label: row.label, color: row.color }]))}>
      <LineChart data={rows} accessibilityLayer>
        <CartesianGrid vertical={false} /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} tickLine={false} axisLine={false} minTickGap={20} />
        <YAxis tickFormatter={value => number(kind === 'latency' ? Number(value) / 1000 : Number(value))} tickLine={false} axisLine={false} width={44} />
        <ChartTooltip content={<ChartTooltipContent formatter={(value, label, item) => <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1"><span className="max-w-64 break-words">{label}</span><span className="font-medium tabular-nums">{t(kind === 'latency' ? 'insights.seconds' : 'insights.tps', { value: number(kind === 'latency' ? Number(value) / 1000 : Number(value)) })}</span><span className="text-muted">{t('insights.samples', { count: Number(item.payload[`${String(item.dataKey)}Count`]) })}</span></div>} />} />
        <ChartLegend content={<ChartLegendContent className="flex-wrap gap-x-4 gap-y-1 text-xs" />} />
        {series.map((row, i) => <Line key={row.key} name={row.label} type="monotone" dataKey={row.key} stroke={`var(--color-${row.key})`} strokeDasharray={i % 2 ? '5 3' : undefined} strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} isAnimationActive={false} />)}
      </LineChart>
    </ChartContainer> : <p className="py-16 text-center text-sm text-muted">{t('insights.noMetric')}</p>}
  </section>;
}
