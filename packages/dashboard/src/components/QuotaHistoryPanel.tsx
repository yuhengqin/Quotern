import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { useTranslation } from 'quotern-i18n/react';
import type { QuotaHistoryReport } from 'quotern-core';
import type { SupportedLocale } from 'quotern-i18n';
import { request } from '@/lib/api';
import { formatTokens, formatUsd } from '@/lib/format';
import { HelpPopover } from './HelpPopover';
import { InsightSelect } from './InsightSelect';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from './ChartPrimitives';
import { quotaCycleStatus, quotaHistoryWindowLabel, quotaHistoryBounds, quotaHistorySegments } from '../lib/quota-history-presentation';
import '../i18n/quota-experience-messages';
import '../i18n/insights-messages';
import '../i18n/data-management-messages';

export function QuotaHistoryPanel({ providerId, providerType = providerId, refreshVersion = 0 }: { providerId: string; providerType?: string; refreshVersion?: number }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<QuotaHistoryReport | null>(null);
  const [error, setError] = useState(false), [retry, setRetry] = useState(0);
  const [windowId, setWindowId] = useState(''), [cycleId, setCycleId] = useState('');
  const [range, setRange] = useState<number | null>(null), [rangeEnd, setRangeEnd] = useState<number | null>(null), [compareId, setCompareId] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(false);
    void request<QuotaHistoryReport>(`/functions/tud-quota-history?provider=${encodeURIComponent(providerId)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [providerId, retry, refreshVersion]);
  const selectedWindow = data?.windows.find(window => window.id === windowId) ?? data?.windows[0];
  const cycle = selectedWindow?.cycles.find(row => row.id === cycleId) ?? selectedWindow?.cycles[0];
  const date = (at: number) => new Date(at * 1000).toLocaleString(i18n.resolvedLanguage, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const percent = (value: number) => `${value.toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 1 })}%`;
  const bounds = data && cycle ? range ? quotaHistoryBounds(data, range, rangeEnd ?? data.observedAt) : { from: cycle.firstObservedAt, to: Math.max(cycle.firstObservedAt + 1, cycle.lastObservedAt), canPrevious: false, canNext: false } : null;
  const compared = data?.windows.find(window => window.id === compareId && window.id !== selectedWindow?.id);
  const segments = data && selectedWindow && bounds ? quotaHistorySegments([range ? selectedWindow : { ...selectedWindow, cycles: cycle ? [cycle] : [] }, ...(compared ? [compared] : [])], bounds.from, bounds.to) : [];
  const chartRows = (() => { const rows = new Map<number, Record<string, number>>(); for (const segment of segments) for (const sample of segment.samples) { const row = rows.get(sample.at) ?? { at: sample.at }; row[segment.key] = sample.usedPercent; rows.set(sample.at, row); } return [...rows.values()].sort((a, b) => a.at - b.at); })();
  return <section className="min-w-0 space-y-4">
    <div className="flex items-center gap-2"><h2 className="text-lg font-semibold">{t('history.title')}</h2><HelpPopover title={t('insights.basis')}><p>{t('history.help')}</p></HelpPopover></div>
    {error ? <div className="space-y-2" role="status"><p className="text-sm text-danger">{t('insights.error')}</p><Button size="sm" variant="secondary" onPress={() => setRetry(value => value + 1)}>{t('insights.retry')}</Button></div>
      : !data ? <p role="status" className="text-sm text-muted">{t('insights.loading')}</p>
        : !cycle ? <p role="status" className="text-sm text-muted">{t('history.empty')}</p> : <>
          <div className="flex flex-wrap gap-3"><InsightSelect label={t('history.window')} value={selectedWindow!.id} options={data.windows.map(window => ({ id: window.id, label: quotaHistoryWindowLabel(window, providerType, (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale) }))} onChange={id => { setWindowId(id); setCycleId(''); }} /><InsightSelect label={t('history.cycle')} value={cycle.id} options={selectedWindow!.cycles.map(row => ({ id: row.id, label: `${date(row.firstObservedAt)} · ${t(`history.${quotaCycleStatus(row, selectedWindow!.cycles[0]!.id, data.observedAt)}`)}` }))} onChange={id => { setCycleId(id); setRange(null); }} /></div>
          <div role="group" aria-label={t('experience.range')} className="flex flex-wrap gap-1">{[null, 5 * 3600, 86400, 7 * 86400, 30 * 86400].map((seconds, index) => <Button key={index} size="sm" variant={range === seconds ? 'secondary' : 'ghost'} aria-pressed={range === seconds} onPress={() => { setRange(seconds); setRangeEnd(null); }}>{seconds === null ? t('experience.cycle') : ['','5h','24h','7d','30d'][index]}</Button>)}</div>
          {bounds && <div className="flex flex-wrap items-center gap-2 text-xs"><span className="tabular-nums">{date(bounds.from)} – {date(bounds.to)}</span>{range && <><Button size="sm" variant="ghost" className="aria-disabled:opacity-40" aria-disabled={!bounds.canPrevious} onPress={() => { if (bounds.canPrevious) setRangeEnd(bounds.to - range); }}>{t('experience.previous')}</Button><Button size="sm" variant="ghost" className="aria-disabled:opacity-40" aria-disabled={!bounds.canNext} onPress={() => { if (bounds.canNext) setRangeEnd(bounds.to + range); }}>{t('experience.next')}</Button><Button size="sm" variant="ghost" className="aria-disabled:opacity-40" aria-disabled={!bounds.canNext} onPress={() => { if (bounds.canNext) setRangeEnd(null); }}>{t('experience.now')}</Button></>}</div>}
          {data.windows.length > 1 && <InsightSelect label={t('experience.compare')} value={compared?.id ?? ''} options={[{ id: '', label: t('experience.noCompare') }, ...data.windows.filter(window => window.id !== selectedWindow!.id).map(window => ({ id: window.id, label: quotaHistoryWindowLabel(window, providerType, (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale) }))]} onChange={setCompareId} />}
          {compared && <div className="flex flex-wrap gap-4 text-xs">{[selectedWindow!, compared].map((window, index) => <span key={window.id} className="flex items-center gap-2"><span aria-hidden="true" className={`w-6 border-t-2 ${index ? 'border-dashed border-foreground' : 'border-accent'}`} />{quotaHistoryWindowLabel(window, providerType, (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale)}</span>)}</div>}
          <p className="text-xs font-medium">{t(`history.${quotaCycleStatus(cycle, selectedWindow!.cycles[0]!.id, data.observedAt)}`)}</p>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {[[t('history.used'), percent(cycle.lastUsedPercent)], [t('history.change'), cycle.observedUsedPercent === null ? '—' : percent(cycle.observedUsedPercent)]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 font-medium tabular-nums">{value}</dd></div>)}
          </dl>
          <ChartContainer config={{ usedPercent: { label: t('history.used'), color: 'var(--accent)' } }} className="h-44 w-full">
            <LineChart data={chartRows} accessibilityLayer><CartesianGrid vertical={false} /><XAxis dataKey="at" type="number" domain={bounds ? [bounds.from, bounds.to] : ['dataMin', 'dataMax']} tickFormatter={value => date(Number(value))} minTickGap={40} tickLine={false} axisLine={false} /><YAxis domain={[0, 100]} tickFormatter={value => `${value}%`} width={40} tickLine={false} axisLine={false} /><ChartTooltip content={<ChartTooltipContent labelFormatter={(_value, payload) => date(Number(payload[0]?.payload?.at))} formatter={(value, name) => <><span className="min-w-0 break-words text-muted">{String(name)}</span><span className="ml-auto tabular-nums">{percent(Number(value))}</span></>} />} />{segments.map(segment => <Line key={segment.key} dataKey={segment.key} name={quotaHistoryWindowLabel(data.windows.find(window => window.id === segment.windowId)!, providerType, (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale)} type="linear" connectNulls stroke={segment.windowIndex ? 'var(--foreground)' : 'var(--color-usedPercent)'} strokeDasharray={segment.windowIndex ? '5 4' : undefined} strokeWidth={2} dot={segment.samples.length < 3} isAnimationActive={false} />)}</LineChart>
          </ChartContainer>
          {!segments.length && <p role="status" className="text-sm text-muted">{t('experience.noSamples')}</p>}
          <details className="text-xs text-muted"><summary className="cursor-pointer focus-visible:outline-2 focus-visible:outline-accent">{t('history.observed')} · {t('insights.samples', { count: cycle.sampleCount })}</summary><dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">{[[t('history.started'), cycle.startedAt === null ? t('history.unverified') : date(cycle.startedAt)], [t('history.reset'), cycle.resetsAt === null ? t('history.unverified') : date(cycle.resetsAt)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mt-1 tabular-nums text-foreground">{value}</dd></div>)}</dl><p className="mt-2 tabular-nums">{date(cycle.firstObservedAt)} – {date(cycle.lastObservedAt)}</p></details>
          {cycle.discontinuous && <p role="status" className="text-sm text-warning">{t('history.discontinuous')}</p>}
          {cycle.usage ? <dl className="grid grid-cols-1 gap-3 border-t border-separator pt-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted">{t('history.localTokens')}</dt><dd className="mt-1 font-medium tabular-nums">{formatTokens(cycle.usage.tokens)}</dd></div><div><dt className="text-xs text-muted">{t(cycle.usage.costComplete ? 'history.cost' : 'history.partialCost')}</dt><dd className="mt-1 font-medium tabular-nums">{formatUsd(cycle.usage.knownCostUsd, i18n.resolvedLanguage, { lowerBound: !cycle.usage.costComplete })}</dd></div>{cycle.usage.tokensPerPercent !== null && <div className="sm:col-span-2"><dt className="text-xs text-muted">{t('history.efficiency')}</dt><dd className="mt-1 font-medium tabular-nums">{formatTokens(cycle.usage.tokensPerPercent)}</dd></div>}</dl> : <p className="text-sm text-muted">{t('history.noUsage')}</p>}
        </>}
  </section>;
}
