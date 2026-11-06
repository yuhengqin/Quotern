import { useEffect, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { useTranslation } from 'quotern-i18n/react';
import type { QuotaHistoryReport } from 'quotern-core';
import { request } from '@/lib/api';
import { formatTokens, formatUsd } from '@/lib/format';
import { HelpPopover } from './HelpPopover';
import { InsightSelect } from './InsightSelect';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from './ChartPrimitives';
import '../i18n/insights-messages';
import '../i18n/data-management-messages';

export function QuotaHistoryPanel({ providerId }: { providerId: string }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<QuotaHistoryReport | null>(null);
  const [error, setError] = useState(false), [retry, setRetry] = useState(0);
  const [windowId, setWindowId] = useState(''), [cycleId, setCycleId] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(false);
    void request<QuotaHistoryReport>(`/functions/tud-quota-history?provider=${encodeURIComponent(providerId)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [providerId, retry]);
  const selectedWindow = data?.windows.find(window => window.id === windowId) ?? data?.windows[0];
  const cycle = selectedWindow?.cycles.find(row => row.id === cycleId) ?? selectedWindow?.cycles[0];
  const date = (at: number) => new Date(at * 1000).toLocaleString(i18n.resolvedLanguage, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const percent = (value: number) => `${value.toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 1 })}%`;
  return <section className="min-w-0 space-y-4">
    <div className="flex items-center gap-2"><h2 className="text-lg font-semibold">{t('history.title')}</h2><HelpPopover title={t('insights.basis')}><p>{t('history.help')}</p></HelpPopover></div>
    {error ? <div className="space-y-2" role="status"><p className="text-sm text-danger">{t('insights.error')}</p><Button size="sm" variant="secondary" onPress={() => setRetry(value => value + 1)}>{t('insights.retry')}</Button></div>
      : !data ? <p role="status" className="text-sm text-muted">{t('insights.loading')}</p>
        : !cycle ? <p role="status" className="text-sm text-muted">{t('history.empty')}</p> : <>
          <div className="flex flex-wrap gap-3"><InsightSelect label={t('history.window')} value={selectedWindow!.id} options={data.windows.map(window => ({ id: window.id, label: [window.groupLabel, window.label].filter(Boolean).join(' · ') }))} onChange={id => { setWindowId(id); setCycleId(''); }} /><InsightSelect label={t('history.cycle')} value={cycle.id} options={selectedWindow!.cycles.map(row => ({ id: row.id, label: date(row.firstObservedAt) }))} onChange={setCycleId} /></div>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {[[t('history.used'), percent(cycle.lastUsedPercent)], [t('history.change'), cycle.observedUsedPercent === null ? '—' : percent(cycle.observedUsedPercent)], [t('history.started'), cycle.startedAt === null ? t('history.unverified') : date(cycle.startedAt)], [t('history.reset'), cycle.resetsAt === null ? t('history.unverified') : date(cycle.resetsAt)]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 font-medium tabular-nums">{value}</dd></div>)}
          </dl>
          <div><p className="text-xs text-muted">{t('history.observed')} · {t('insights.samples', { count: cycle.sampleCount })}</p><p className="mt-1 text-sm tabular-nums">{date(cycle.firstObservedAt)} – {date(cycle.lastObservedAt)}</p></div>
          <ChartContainer config={{ usedPercent: { label: t('history.used'), color: 'var(--accent)' } }} className="h-44 w-full">
            <LineChart data={cycle.samples} accessibilityLayer><CartesianGrid vertical={false} /><XAxis dataKey="at" type="number" domain={['dataMin', 'dataMax']} tickFormatter={value => date(Number(value))} minTickGap={40} tickLine={false} axisLine={false} /><YAxis domain={[0, 100]} tickFormatter={value => `${value}%`} width={40} tickLine={false} axisLine={false} /><ChartTooltip content={<ChartTooltipContent labelFormatter={(_value, payload) => date(Number(payload[0]?.payload?.at))} formatter={value => percent(Number(value))} />} /><Line dataKey="usedPercent" type="linear" stroke="var(--color-usedPercent)" strokeWidth={2} dot={cycle.samples.length < 3} isAnimationActive={false} /></LineChart>
          </ChartContainer>
          {cycle.discontinuous && <p role="status" className="text-sm text-warning">{t('history.discontinuous')}</p>}
          {cycle.usage ? <dl className="grid grid-cols-1 gap-3 border-t border-separator pt-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted">{t('history.localTokens')}</dt><dd className="mt-1 font-medium tabular-nums">{formatTokens(cycle.usage.tokens)}</dd></div><div><dt className="text-xs text-muted">{t(cycle.usage.costComplete ? 'history.cost' : 'history.partialCost')}</dt><dd className="mt-1 font-medium tabular-nums">{formatUsd(cycle.usage.knownCostUsd, i18n.resolvedLanguage, { lowerBound: !cycle.usage.costComplete })}</dd></div>{cycle.usage.tokensPerPercent !== null && <div className="sm:col-span-2"><dt className="text-xs text-muted">{t('history.efficiency')}</dt><dd className="mt-1 font-medium tabular-nums">{formatTokens(cycle.usage.tokensPerPercent)}</dd></div>}</dl> : <p className="text-sm text-muted">{t('history.noUsage')}</p>}
        </>}
  </section>;
}

export function QuotaHistoryButton({ providerId, identity }: { providerId: string; identity?: string }) {
  const { t } = useTranslation();
  return <Modal><Button size="sm" variant="secondary">{t('history.title')}</Button><Modal.Backdrop><Modal.Container placement="center" scroll="inside"><Modal.Dialog aria-label={t('history.title')} className="w-full max-w-xl"><Modal.CloseTrigger /><Modal.Body className="p-5 pt-10"><QuotaHistoryPanel key={`${providerId}:${identity ?? ''}`} providerId={providerId} /></Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>;
}
