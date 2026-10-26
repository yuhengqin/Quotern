import { useEffect, useRef, useState } from 'react';
import { Button, Card, Label, ListBox, Select } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { registerMessages } from 'quotern-i18n';
import type { BillingReport } from 'quotern-core/billing/types';
import { BackToUsageLink } from '../components/BackToUsageLink';
import { FilterSelectPopover } from '../components/FilterMenu';
import { HelpPopover } from '../components/HelpPopover';
import { StatusBanner } from '../components/StatusBanner';
import { fetchBillingReport } from '../lib/api';
import { formatMoney, formatUsd } from '../lib/format';
import { billingMessages } from '../i18n/billing-messages';
import { billingStatusMessage } from '../lib/billing-status';
registerMessages(billingMessages);
const summaryCardClass = '@container min-w-0 p-5';
const summaryValueClass = 'whitespace-nowrap text-[clamp(1rem,7cqi,1.875rem)] font-semibold tabular-nums';

export function BillingPage({ loadReport = fetchBillingReport }: { loadReport?: typeof fetchBillingReport }) {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState(30), [data, setData] = useState<BillingReport | null>(null), [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false), [error, setError] = useState(false);
  const generation = useRef(0);
  const read = async (refresh = false) => {
    const current = ++generation.current; setBusy(true); setRefreshing(refresh); setError(false);
    try { const next = await loadReport(days, refresh); if (generation.current === current) setData(next); }
    catch { if (generation.current === current) setError(true); }
    finally { if (generation.current === current) setBusy(false); }
  };
  useEffect(() => { setData(null); void read(); return () => { generation.current++; }; }, [days, loadReport]);
  const p = data?.platform;
  const status = p ? billingStatusMessage(p.status, p.code) : null;
  const time = (seconds: number) => new Date(seconds * 1000).toLocaleString(i18n.language, { timeZone: 'UTC' });
  return <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6" aria-busy={busy}>
    <BackToUsageLink />
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-2"><h1 className="text-2xl font-semibold">{t('billing.title')}</h1><HelpPopover title={t('billing.scope')}>
        <p>{t('billing.scopeHelp')}</p><p>{t('billing.timeHelp')}</p><p>{t('billing.setupHelp')}</p><p>{t('billing.balanceHelp')}</p>
      </HelpPopover></div>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={t('billing.period')} value={String(days)} onChange={key => { const n = Number(key); if ([7, 30, 90].includes(n)) setDays(n); }} className="w-40" variant="secondary">
          <Label className="sr-only">{t('billing.period')}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
          <FilterSelectPopover><ListBox>{[7, 30, 90].map(n => <ListBox.Item key={n} id={String(n)} textValue={t('billing.days', { count: n })}>{t('billing.days', { count: n })}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></FilterSelectPopover>
        </Select>
        <Button variant="secondary" isDisabled={busy || !p || p.status === 'not-configured'} onPress={() => { void read(true); }}>{t('billing.refresh')}</Button>
      </div>
    </header>
    {error && <div className="space-y-2" role="alert"><StatusBanner tone="error" title={t('billing.error')} /><Button size="sm" onPress={() => { void read(); }}>{t('billing.retry')}</Button></div>}
    {busy && <p role="status" className="text-sm text-muted">{t(refreshing ? 'billing.refreshing' : 'billing.loading')}</p>}
    {p && data && <>
      <p className="text-sm text-muted">{time(p.startTime)} – {time(p.endTime)} UTC</p>
      {status && <StatusBanner tone={status === 'limited' ? 'warn' : status === 'unavailable' || status === 'denied' ? 'error' : 'info'} title={t(`billing.${status}`)} />}
      <section className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-4">
        <Card className={summaryCardClass}><Card.Header><Card.Title>{t('billing.local')}</Card.Title></Card.Header><Card.Content className="min-w-0 space-y-2">
          <p className={summaryValueClass}>{formatUsd(data.local.costUsd ?? data.local.knownCostUsd, i18n.language, { lowerBound: data.local.costUsd === null })}</p>
          {(data.local.costUsd === null || data.local.coverage.limited) && <p className="text-sm text-warning">{t('billing.partial')}</p>}
          <HelpPopover title={t('billing.scope')}><p>{t('billing.scopeHelp')}</p><p>{t('billing.estimated')}: {formatUsd(data.local.estimatedCostUsd, i18n.language)}; {t('billing.reported')}: {formatUsd(data.local.reportedCostUsd, i18n.language)}</p><p>{t('billing.collectSince')}: {new Date(data.local.coverage.collectSince).toLocaleString(i18n.language)}</p></HelpPopover>
        </Card.Content></Card>
        <Card className={summaryCardClass}><Card.Header><Card.Title>{t('billing.platform')}</Card.Title></Card.Header><Card.Content className="min-w-0 space-y-2">
          {p.totals.length ? p.totals.map(value => <p key={value.currency} className={summaryValueClass}>{formatMoney(value.amount, value.currency, i18n.language)}</p>) : <p className={summaryValueClass}>—</p>}
          {p.status === 'partial' && <p className="text-sm text-warning">{t('billing.partial')}</p>}
          {data.stale && <p className="text-sm text-warning">{t('billing.stale')}</p>}
          <p className="text-sm text-muted [overflow-wrap:anywhere]">{p.projects.length ? `${t('billing.projects')}: ${p.projects.join(', ')}` : t('billing.organization')}</p>
          {p.fetchedAt && <p className="text-xs text-muted">{t('billing.updated', { time: `${time(p.fetchedAt)} UTC` })}</p>}
        </Card.Content></Card>
        <Card className={summaryCardClass}><Card.Header><Card.Title>{t('billing.balance')}</Card.Title></Card.Header><Card.Content className="min-w-0 space-y-2">
          <p className={summaryValueClass}>{formatMoney(data.deepseek.remaining, data.deepseek.currency, i18n.language)}</p>
          {data.deepseek.stale && data.deepseek.fetchedAt !== null && <p className="text-sm text-muted">{t('billing.stale')}</p>}
        </Card.Content></Card>
      </section>
      {p.rows.length > 0 && <details className="rounded-xl border border-default p-4"><summary className="cursor-pointer text-sm font-medium">{t('billing.details')}</summary>
        <div role="region" aria-label={t('billing.details')} tabIndex={0} className="mt-4 max-h-96 overflow-auto">
          <table className="w-full min-w-[38rem] text-left text-sm"><thead className="sticky top-0 bg-surface"><tr>{['date', 'project', 'item', 'amount'].map(key => <th key={key} scope="col" className="p-2">{t(`billing.${key}`)}</th>)}</tr></thead>
            <tbody>{p.rows.map((row, i) => <tr key={i} className="border-t border-default"><th scope="row" className="p-2 font-normal">{new Date(row.startTime * 1000).toISOString().slice(0, 10)}</th><td className="p-2">{row.projectId ?? '—'}</td><td className="p-2">{row.lineItem ?? '—'}</td><td className="whitespace-nowrap p-2 tabular-nums">{formatMoney(row.amount, row.currency, i18n.language)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>}
    </>}
  </main>;
}
