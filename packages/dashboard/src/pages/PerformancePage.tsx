import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Button, Table } from '@heroui/react';
import { Activity } from 'lucide-react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { useTranslation } from 'quotern-i18n/react';
import type { PerformanceGroup, PerformanceReport } from 'quotern-core';
import { request } from '@/lib/api';
import { sourceLabel } from '@/lib/tokens';
import { useCachedRangeQuery } from '@/hooks/useCachedRangeQuery';
import { BackToUsageLink } from '../components/BackToUsageLink';
import { InsightSelect } from '../components/InsightSelect';
import { HelpPopover } from '../components/HelpPopover';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '../components/ChartPrimitives';
import { parsePerformanceSearch, type PerformanceSearch } from '../lib/performance-page';
import { parseSessionPageSearch } from '../lib/session-page';
import '../i18n/insights-messages';

export function PerformancePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const raw = useSearch({ strict: false });
  const search = useMemo(() => parsePerformanceSearch(raw), [raw]);
  const [retry, setRetry] = useState(0);
  const query = useMemo(() => {
    const params = new URLSearchParams({ days: String(search.days), groupBy: search.groupBy });
    if (search.source) params.set('sources', search.source);
    if (search.model) params.set('model', search.model);
    if (search.project) params.set('project', search.project);
    return `/functions/tud-performance?${params}`;
  }, [search]);
  const load = useCallback(() => request<PerformanceReport>(query, { signal: AbortSignal.timeout(30_000) }), [query]);
  const { data, error, loading } = useCachedRangeQuery(query, `${query}|${retry}`, load, true);
  const update = (patch: Partial<PerformanceSearch>) => { void navigate({ to: '/performance', search: { ...search, ...patch }, replace: true, resetScroll: false }); };
  const number = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(value);
  const latency = (value: number | null) => value === null ? '—' : t('insights.seconds', { value: number(value / 1000) });
  const speed = (value: number | null) => value === null ? '—' : t('insights.tps', { value: number(value) });
  const name = (value: string) => value === 'unknown' ? t('insights.unknown') : value;
  const facets = (values: string[], format: (v: string) => string = name) => [{ id: '', label: t('insights.all') }, ...values.map(value => ({ id: value, label: format(value) }))];
  const groupLabel = (group: PerformanceGroup) => t(`insights.${group === 'source' ? 'agent' : group}`);
  const count = (n: number) => t('insights.samples', { count: n });
  return <div className="min-w-0 space-y-5 pb-6">
    <header><BackToUsageLink /><div className="flex items-center gap-2"><Activity className="size-6 text-accent" aria-hidden /><h1 className="text-2xl font-semibold tracking-tight">{t('insights.performance')}</h1><HelpPopover title={t('insights.basis')}><p>{t('insights.performanceHelp')}</p></HelpPopover></div></header>
    <div className="flex flex-wrap items-end gap-3">
      <InsightSelect label={t('insights.period')} value={String(search.days)} options={[1, 7, 30, 90].map(days => ({ id: String(days), label: t('insights.days', { count: days }) }))} onChange={days => update({ days: Number(days) })} />
      <InsightSelect label={t('insights.agent')} value={search.source} options={facets(data?.facets.sources ?? (search.source ? [search.source] : []), sourceLabel)} onChange={source => update({ source })} />
      <InsightSelect label={t('insights.model')} value={search.model} options={facets(data?.facets.models ?? (search.model ? [search.model] : []))} onChange={model => update({ model })} />
      <InsightSelect label={t('insights.project')} value={search.project} options={facets(data?.facets.projects ?? (search.project ? [search.project] : []))} onChange={project => update({ project })} />
      {(search.source || search.model || search.project) && <Button variant="tertiary" size="sm" onPress={() => update({ source: '', model: '', project: '' })}>{t('insights.clear')}</Button>}
    </div>
    {error && <div className="flex items-center gap-3" role="status"><p className="text-sm text-danger">{t('insights.error')}</p><Button size="sm" variant="secondary" onPress={() => setRetry(value => value + 1)}>{t('insights.retry')}</Button></div>}
    {loading && !data && <p className="py-12 text-center text-muted" role="status">{t('insights.loading')}</p>}
    {data && !data.sampleCount && <div className="rounded-2xl bg-surface p-10 text-center" role="status"><p className="font-medium">{t('insights.emptyPerformance')}</p><p className="mt-2 text-sm text-muted">{t('insights.emptyPerformanceHint')}</p></div>}
    {data && data.sampleCount > 0 && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[[t('insights.ttft50'), latency(data.summary.ttftP50Ms), count(data.summary.ttftSampleCount)], [t('insights.ttft95'), latency(data.summary.ttftP95Ms), count(data.summary.ttftSampleCount)], [t('insights.speed'), speed(data.summary.tokensPerSecond), count(data.summary.speedSampleCount)], [t('insights.sessions'), number(data.summary.sessionCount), `${data.range.fromDate} – ${data.range.toDate}`]].map(([title, value, detail]) => <div key={title} className="rounded-2xl bg-surface p-5"><p className="text-sm text-muted">{title}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted">{detail}</p></div>)}
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {(['latency', 'speed'] as const).map(kind => <section key={kind} className="min-w-0 rounded-2xl bg-surface p-4"><h2 className="mb-4 text-sm font-semibold">{t(kind === 'latency' ? 'insights.latencyTrend' : 'insights.speedTrend')}</h2>
          {data.trend.some(row => kind === 'latency' ? row.ttftSampleCount : row.speedSampleCount) ? <ChartContainer className="h-52 w-full" config={kind === 'latency' ? { ttftP50Ms: { label: 'P50', color: 'var(--accent)' }, ttftP95Ms: { label: 'P95', color: 'var(--warning)' } } : { tokensPerSecond: { label: t('insights.speed'), color: 'var(--accent)' } }}>
            <LineChart data={data.trend} accessibilityLayer><CartesianGrid vertical={false} /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} tickLine={false} axisLine={false} minTickGap={20} /><YAxis tickFormatter={value => number(kind === 'latency' ? Number(value) / 1000 : Number(value))} tickLine={false} axisLine={false} width={44} /><ChartTooltip content={<ChartTooltipContent formatter={(value, label) => <span>{label}: {kind === 'latency' ? latency(Number(value)) : speed(Number(value))}</span>} />} />
              {kind === 'latency' ? <><Line type="monotone" dataKey="ttftP50Ms" stroke="var(--color-ttftP50Ms)" strokeWidth={2} dot={data.trend.length === 1} connectNulls={false} isAnimationActive={false} /><Line type="monotone" dataKey="ttftP95Ms" stroke="var(--color-ttftP95Ms)" strokeWidth={2} dot={data.trend.length === 1} connectNulls={false} isAnimationActive={false} /></> : <Line type="monotone" dataKey="tokensPerSecond" stroke="var(--color-tokensPerSecond)" strokeWidth={2} dot={data.trend.length === 1} connectNulls={false} isAnimationActive={false} />}
            </LineChart></ChartContainer> : <p className="py-16 text-center text-sm text-muted">{t('insights.noMetric')}</p>}
        </section>)}
      </div>
      <section className="min-w-0 space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-lg font-semibold">{t('insights.compare')}</h2><InsightSelect label={t('insights.group')} value={search.groupBy} options={(['model', 'source', 'project'] as const).map(id => ({ id, label: groupLabel(id) }))} onChange={groupBy => update({ groupBy: groupBy as PerformanceGroup })} /></div>
        <Table><Table.ScrollContainer><Table.Content aria-label={t('insights.compare')}><Table.Header><Table.Column isRowHeader>{groupLabel(search.groupBy)}</Table.Column><Table.Column>{t('insights.ttft50')}</Table.Column><Table.Column>{t('insights.ttft95')}</Table.Column><Table.Column>{t('insights.speed')}</Table.Column></Table.Header><Table.Body>{data.groups.map(row => <Table.Row key={row.label}><Table.Cell className="max-w-72 break-words">{search.groupBy === 'source' ? sourceLabel(row.label) : name(row.label)}</Table.Cell><Table.Cell className="whitespace-nowrap tabular-nums">{latency(row.ttftP50Ms)}<span className="block text-xs text-muted">{count(row.ttftSampleCount)}</span></Table.Cell><Table.Cell className="whitespace-nowrap tabular-nums">{latency(row.ttftP95Ms)}</Table.Cell><Table.Cell className="whitespace-nowrap tabular-nums">{speed(row.tokensPerSecond)}<span className="block text-xs text-muted">{count(row.speedSampleCount)}</span></Table.Cell></Table.Row>)}</Table.Body></Table.Content></Table.ScrollContainer></Table>
      </section>
      <section className="min-w-0 space-y-3"><div className="flex items-center gap-2"><h2 className="text-lg font-semibold">{t('insights.latest')}</h2><HelpPopover title={t('insights.latest')}><p>{t('insights.latestHelp')}</p></HelpPopover></div><Table><Table.ScrollContainer className="max-h-96"><Table.Content aria-label={t('insights.latest')}><Table.Header><Table.Column isRowHeader>{t('insights.session')}</Table.Column><Table.Column>{t('insights.model')}</Table.Column><Table.Column>{t('insights.time')}</Table.Column><Table.Column>{t('insights.ttft')}</Table.Column><Table.Column>{t('insights.speed')}</Table.Column></Table.Header><Table.Body>{data.samples.map(row => <Table.Row key={JSON.stringify([row.source, row.sessionId, row.id])}><Table.Cell><Link className="block max-w-64 truncate text-accent underline-offset-4 hover:underline" to="/sessions" search={parseSessionPageSearch({ sessionSource: row.source, sessionId: row.sessionId })}>{row.sessionTitle || t('usage.activity.untitledSession')}</Link><span className="text-xs text-muted">{sourceLabel(row.source)} · {name(row.project)}</span></Table.Cell><Table.Cell className="max-w-48 break-words">{name(row.model)}</Table.Cell><Table.Cell className="whitespace-nowrap text-xs">{new Intl.DateTimeFormat(i18n.resolvedLanguage, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(row.timestamp))}</Table.Cell><Table.Cell className="whitespace-nowrap tabular-nums">{latency(row.ttftMs)}</Table.Cell><Table.Cell className="whitespace-nowrap tabular-nums">{speed(row.tokensPerSecond)}</Table.Cell></Table.Row>)}</Table.Body></Table.Content></Table.ScrollContainer></Table></section>
    </>}
  </div>;
}
