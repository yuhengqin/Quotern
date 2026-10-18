import { useMemo, useState } from 'react';
import { Button, Card, Input, Label, Modal, Tabs, TextField, Tooltip } from '@heroui/react';
import { translate, type SupportedLocale } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';
import type { SessionActivity, SessionActivitySnapshot } from 'quotern-core';
import { useSessionActivity } from '@/hooks/useSessionActivity';
import { sourceLabel } from '@/lib/tokens';
import { isCliBackend } from '@/lib/api';
import type { DashboardDateRange } from '@/lib/dashboard-date-range';
import { ProviderIcon } from './ProviderIcon';
import { filterSessionActivity, sessionActivityFacets, sessionActivityPage, sortSessionActivity, type SessionSort } from '../lib/session-activity';

const number = (value: number, locale: SupportedLocale) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const serviceLabel = (value: string, locale: SupportedLocale) => {
  const key = ({ unknown: 'usage.activity.attributionUnknown', mixed: 'usage.activity.multipleChannels' } as Record<string, string>)[value];
  return key ? translate(locale, key) : ({ openai: 'OpenAI', anthropic: 'Anthropic', xai: 'xAI', opencode: 'OpenCode' } as Record<string, string>)[value] ?? value;
};
const modeLabel = (value: string, locale: SupportedLocale) => value === 'api' ? 'API'
  : translate(locale, value === 'subscription' ? 'usage.activity.subscription' : 'usage.activity.billingUnknown');
const costLabel = (value: string, locale: SupportedLocale) => translate(locale, ({
  recorded: 'usage.activity.sourceRecorded', estimated: 'usage.activity.priceEstimate',
  mixed: 'usage.activity.costMixed', unknown: 'usage.activity.amountUnknown',
} as Record<string, string>)[value] ?? 'usage.activity.amountUnknown');
function age(stamp: string, locale: SupportedLocale) {
  const seconds = Math.max(0, (Date.now() - Date.parse(stamp)) / 1000);
  return seconds < 60 ? translate(locale, 'usage.activity.justNow')
    : seconds < 3600 ? translate(locale, 'usage.activity.minutesAgo', { count: Math.floor(seconds / 60) })
      : seconds < 86400 ? translate(locale, 'usage.activity.hoursAgo', { count: Math.floor(seconds / 3600) })
        : new Date(stamp).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' });
}
function money(row: Pick<SessionActivity, 'costUsd' | 'costKind'>, locale: SupportedLocale) {
  return row.costUsd === null ? translate(locale, 'usage.activity.amountUnknown')
    : `$${row.costUsd.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} · ${costLabel(row.costKind, locale)}`;
}

export function SessionActivityPanel(props: { days: number; selectedDate: string | null; dateRange: DashboardDateRange | null; sources: readonly string[]; enabled: boolean }) {
  const { t } = useTranslation();
  const { data, error } = useSessionActivity(props.days, props.selectedDate, props.dateRange, props.sources, props.enabled);
  if (!isCliBackend()) return null;
  return <Card className="mt-4 min-w-0 overflow-hidden" aria-label={t('usage.activity.aria')}>
    <Card.Header className="pb-0"><Card.Title>{t('usage.activity.heading')}</Card.Title></Card.Header>
    <Card.Content>
      {error && <p role="status" className="mb-3 text-xs text-warning">{t('usage.activity.readError')} {data ? t('usage.activity.staleReading') : ''}</p>}
      {!data ? <p role="status" className="py-4 text-sm text-muted">{error ? t('usage.activity.unavailable') : t('usage.activity.loading')}</p> : <SessionActivityViews snapshot={data} />}
    </Card.Content>
  </Card>;
}

export function SessionActivityViews({ snapshot }: { snapshot: SessionActivitySnapshot }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  const recent = useMemo(() => [...snapshot.sessions].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)), [snapshot.sessions]);
  return <Tabs defaultSelectedKey="recent" variant="secondary" className="min-w-0">
    <Tabs.ListContainer><Tabs.List aria-label={t('usage.activity.views')}>
      <Tabs.Tab id="recent">{t('usage.activity.recent')}<Tabs.Indicator /></Tabs.Tab>
      <Tabs.Tab id="contribution">{t('usage.activity.contribution')}<Tabs.Indicator /></Tabs.Tab>
      <Tabs.Tab id="billing">{t('usage.activity.billing')}<Tabs.Indicator /></Tabs.Tab>
    </Tabs.List></Tabs.ListContainer>
    <Tabs.Panel id="recent" className="pt-3"><SessionList rows={recent} contribution={false} /></Tabs.Panel>
    <Tabs.Panel id="contribution" className="pt-3">
      <p className="mb-3 text-xs text-muted">{t('usage.activity.contributionSummary', { tokens: number(snapshot.totalTokens, locale) })}</p>
      <SessionList rows={snapshot.sessions} contribution />
      {snapshot.otherTokens > 0 && <div className="mt-2 flex justify-between gap-3 rounded-xl bg-surface-secondary px-3 py-2 text-xs text-muted"><span>{t('usage.activity.unattributed')}</span><span className="tabular-nums">{number(snapshot.otherTokens, locale)} · {(snapshot.otherTokens / snapshot.totalTokens * 100).toFixed(1)}%</span></div>}
      <p className="mt-3 text-[11px] text-muted">{t('usage.activity.contributionNote')}</p>
    </Tabs.Panel>
    <Tabs.Panel id="billing" className="pt-3">
      <div className="flex flex-col divide-y divide-separator">
        {snapshot.billing.map(row => <div key={`${row.service}|${row.mode}|${row.accountRef ?? ''}`} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
          <div className="min-w-0"><p className="text-sm font-medium">{serviceLabel(row.service, locale)}</p><p className="text-xs text-muted">{[row.mode !== 'unknown' ? modeLabel(row.mode, locale) : '', row.accountLabel ?? (row.accountRef ? t('usage.activity.accountRef', { ref: row.accountRef.slice(0, 6) }) : '')].filter(Boolean).join(' · ')}</p></div>
          <div className="text-right text-xs tabular-nums"><p>{number(row.tokens, locale)} Token</p><p className="text-muted">{money(row, locale)}</p></div>
        </div>)}
        {!snapshot.billing.length && <p className="py-4 text-sm text-muted">{t('usage.activity.noBilling')}</p>}
      </div>
      <p className="mt-3 text-[11px] text-muted">{t('usage.activity.billingNote')}</p>
    </Tabs.Panel>
    {(snapshot.missingSources.length > 0 || snapshot.tokenTotalMismatch) && <p className="mt-3 text-[11px] text-muted">{snapshot.missingSources.length ? t('usage.activity.missingCoverage', { sources: new Intl.ListFormat(locale).format(snapshot.missingSources.map(sourceLabel)) }) : ''} {snapshot.tokenTotalMismatch ? t('usage.activity.totalMismatch') : ''}</p>}
  </Tabs>;
}

function SessionList({ rows, contribution }: { rows: SessionActivity[]; contribution: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!rows.length) return <p className="py-4 text-sm text-muted">{t('usage.activity.noSessions')}</p>;
  return <>
    <SessionRows rows={rows.slice(0, 6)} contribution={contribution} />
    <Button className="mt-2 h-7 text-xs" size="sm" variant="ghost" aria-haspopup="dialog" aria-expanded={open} onPress={() => setOpen(true)}>{t('usage.activity.viewAllSessions', { count: rows.length })}</Button>
    <SessionBrowser rows={rows} contribution={contribution} open={open} onOpenChange={setOpen} />
  </>;
}

function SessionBrowser({ rows, contribution, open, onOpenChange }: { rows: SessionActivity[]; contribution: boolean; open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(''), [source, setSource] = useState('all'), [page, setPage] = useState(1);
  const [project, setProject] = useState(''), [sort, setSort] = useState<SessionSort>(contribution ? 'tokens' : 'recent');
  const facets = useMemo(() => sessionActivityFacets(rows, query, source, project), [rows, query, source, project]);
  const filtered = useMemo(() => sortSessionActivity(filterSessionActivity(rows, query, source, project), sort), [rows, query, source, project, sort]);
  const result = sessionActivityPage(filtered, page);
  return <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}><Modal.Container placement="center" scroll="inside"><Modal.Dialog aria-label={t('usage.activity.allSessions')} className="w-full max-w-4xl">
    <Modal.CloseTrigger aria-label={t('usage.activity.closeAllSessions')} /><Modal.Header><Modal.Heading>{t('usage.activity.allSessions')}</Modal.Heading><p className="text-xs text-muted">{t('usage.explorer.windowNote')}</p></Modal.Header>
    <Modal.Body className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <TextField className="min-w-40 flex-1" value={query} onChange={value => { setQuery(value); setPage(1); }}><Label>{t('usage.activity.search')}</Label><Input placeholder={t('usage.activity.searchPlaceholder')} type="search" /></TextField>
        <label className="flex flex-col gap-1 text-xs">Agent<select value={source} onChange={event => { setSource(event.target.value); setPage(1); }} className="rounded-xl border border-separator bg-surface-secondary px-3 py-2 text-sm outline-offset-2 focus-visible:outline-accent"><option value="all">{t('usage.filter.allAgents')}</option>{facets.sources.map(({ value, count }) => <option key={value} value={value}>{sourceLabel(value)} ({count})</option>)}</select></label>
        <label className="flex min-w-32 flex-col gap-1 text-xs">{t('usage.explorer.project')}<select value={project} onChange={event => { setProject(event.target.value); setPage(1); }} className="max-w-56 rounded-xl border border-separator bg-surface-secondary px-3 py-2 text-sm focus-visible:outline-accent"><option value="">{t('usage.explorer.allProjects')}</option>{facets.projects.map(({ value, count }) => <option key={value} value={value}>{value} ({count})</option>)}</select></label>
        <label className="flex flex-col gap-1 text-xs">{t('usage.explorer.sort')}<select value={sort} onChange={event => { setSort(event.target.value as SessionSort); setPage(1); }} className="rounded-xl border border-separator bg-surface-secondary px-3 py-2 text-sm focus-visible:outline-accent">{(['recent', 'tokens', 'cost', 'duration'] as const).map(value => <option key={value} value={value}>{t(`usage.explorer.${{ recent: 'sortRecent', tokens: 'sortTokens', cost: 'sortCost', duration: 'sortDuration' }[value]}`)}</option>)}</select></label>
      </div>
      <p role="status" className="text-xs text-muted">{t('usage.activity.sessionCount', { count: filtered.length })}</p>
      {filtered.length ? <SessionRows rows={result.rows} contribution={contribution} /> : <p className="py-8 text-center text-sm text-muted">{t('usage.activity.noMatches')}</p>}
    </Modal.Body>
    <Modal.Footer className="items-center justify-between gap-3"><p className="text-xs tabular-nums text-muted">{t('usage.activity.page', { page: result.page, pages: result.pages })}</p><div className="flex gap-2"><Button size="sm" variant="secondary" isDisabled={result.page <= 1} onPress={() => setPage(result.page - 1)}>{t('usage.activity.previousPage')}</Button><Button size="sm" variant="secondary" isDisabled={result.page >= result.pages} onPress={() => setPage(result.page + 1)}>{t('usage.activity.nextPage')}</Button></div></Modal.Footer>
  </Modal.Dialog></Modal.Container></Modal.Backdrop>;
}

function SessionRows({ rows, contribution }: { rows: SessionActivity[]; contribution: boolean }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  return <div className="divide-y divide-separator">
      {rows.map(row => <details key={`${row.source}:${row.sessionId}`} className="group py-1">
        <summary className="grid min-w-0 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-2 outline-offset-2 hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent">
          <div className="flex min-w-0 items-center gap-2.5"><ProviderIcon provider={row.source} size={20} /><div className="min-w-0"><p className="truncate text-sm font-medium" title={row.sessionTitle ?? `${sourceLabel(row.source)} · ${row.sessionId}`}>{row.sessionTitle ?? `${sourceLabel(row.source)} · ${row.sessionId.slice(-8)}`}</p><p className="truncate text-[11px] text-muted" title={row.projectLabel}>{row.projectLabel} · {row.model === 'unknown' ? t('usage.activity.modelNotRecorded') : row.model} · {age(row.lastActivityAt, locale)}</p></div></div>
          <div className="shrink-0 text-right text-xs tabular-nums"><p>{row.tokens === null ? t('usage.activity.usageNotRecorded') : `${number(row.tokens, locale)} Token`}</p><div className="text-[11px] text-muted"><Tooltip delay={200}>
            <Tooltip.Trigger<'span'> render={props => <span {...props} />} className="cursor-help rounded outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent">
              {row.costUsd === null ? t('usage.activity.amountUnknown') : `$${row.costUsd.toLocaleString(locale, { maximumFractionDigits: 4 })}`}{contribution && row.sharePercent !== null ? ` · ${row.sharePercent.toFixed(1)}%` : ''}
            </Tooltip.Trigger>
            <Tooltip.Content placement="top">{costLabel(row.costKind, locale)}</Tooltip.Content>
          </Tooltip></div></div>
        </summary>
        <div className="ml-2 flex flex-col gap-2 border-l-2 border-separator py-2 pl-3 text-xs text-muted sm:ml-9">
          <p>{serviceLabel(row.billing.service, locale)} · {modeLabel(row.billing.mode, locale)}{row.billing.accountLabel ? ` · ${row.billing.accountLabel}` : row.billing.accountRef ? ` · ${t('usage.activity.accountRef', { ref: row.billing.accountRef.slice(0, 6) })}` : ''}</p>
          {row.billing.mode === 'unknown' && <p>{t('usage.activity.insufficientBillingEvidence')}</p>}
          {!row.models?.length && row.taskSeconds != null && <p><TaskTime row={row} /></p>}
          {!row.detailsComplete && <p>{t('usage.explorer.missingDetails')}</p>}
          {!!row.models?.length && <div className="min-w-0 max-w-full rounded-lg border border-separator">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-2 py-1 text-[11px]">
              <span className="font-medium">{t('usage.explorer.modelDetails')} · {t('usage.explorer.range')}</span>
              <TaskTime row={row} />
            </div>
            <div className="overflow-x-auto"><table className="w-full text-left text-[11px]"><caption className="sr-only">{t('usage.explorer.modelDetails')} · {t('usage.explorer.range')}</caption><thead className="sticky top-0 bg-surface-secondary"><tr>{[t('usage.explorer.modelDetails'), t('usage.common.input'), t('usage.common.output'), t('usage.common.cache'), t('usage.distribution.cacheWrite'), t('usage.explorer.requests'), t('usage.common.cost')].map((label, i) => <th scope="col" key={i} className="whitespace-nowrap px-2 py-1 font-medium">{label}</th>)}</tr></thead><tbody>{row.models.map(model => <tr key={model.model} className="border-t border-separator"><th scope="row" className="max-w-48 truncate px-2 py-2 font-normal" title={model.model}>{model.model}<span className="block text-muted">{model.serviceTiers.filter(tier => tier !== 'unknown').join(' / ')}</span></th>{[model.input_tokens, model.output_tokens === null || model.reasoning_output_tokens === null ? null : model.output_tokens + model.reasoning_output_tokens, model.cached_input_tokens, model.cache_creation_input_tokens, model.requests].map((value, i) => <td key={i} className="whitespace-nowrap px-2 py-2 tabular-nums">{value === null ? '—' : number(value, locale)}</td>)}<td className="whitespace-nowrap px-2 py-2 tabular-nums" title={costLabel(model.costKind, locale)}>{model.costUsd === null ? `${t('usage.explorer.knownSubtotal')} $${model.knownCostUsd.toLocaleString(locale, { maximumFractionDigits: 4 })}` : `$${model.costUsd.toLocaleString(locale, { maximumFractionDigits: 4 })}`}</td></tr>)}</tbody></table></div>
          </div>}
          {row.unallocatedCostUsd != null && <p>{t('usage.explorer.unallocatedCost')}</p>}
          <p>{t('usage.activity.recentDetails', { date: new Date(row.lastActivityAt).toLocaleString(locale), id: row.sessionId })}</p>
        </div>
      </details>)}
    </div>;
}

function TaskTime({ row }: { row: SessionActivity }) {
  const { t, i18n } = useTranslation();
  if (row.taskSeconds == null) return null;
  return <span className="tabular-nums">{t('usage.explorer.taskTime')}: {(row.taskSeconds / 60).toLocaleString(i18n.resolvedLanguage ?? 'zh-CN', { maximumFractionDigits: 1 })} min · {t(row.taskTimingKind === 'recorded' ? 'usage.session.recordedTime' : row.taskTimingKind === 'mixed' ? 'usage.session.includesEstimate' : 'usage.session.estimate')}</span>;
}
