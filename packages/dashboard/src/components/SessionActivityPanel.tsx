import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Card, Label, ListBox, Modal, SearchField, Select, Tabs, Tooltip } from '@heroui/react';
import { ArrowDownUp, X } from 'lucide-react';
import { translate, type SupportedLocale } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';
import type { SessionActivity, SessionActivitySnapshot } from 'quotern-core';
import { useSessionActivity } from '@/hooks/useSessionActivity';
import { sourceLabel } from '@/lib/tokens';
import { isCliBackend } from '@/lib/api';
import type { DashboardDateRange } from '@/lib/dashboard-date-range';
import { ProviderIcon } from './ProviderIcon';
import { filterSessionActivity, relatedSessionActivity, sessionActivityFacets, sessionActivityPage, sortSessionActivity, type SessionSort } from '../lib/session-activity';

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
const attributionKey = (row: SessionActivitySnapshot['billing'][number]) => JSON.stringify([row.service, row.mode, row.accountRef]);
type SessionUsage = Pick<SessionActivitySnapshot, 'totalTokens' | 'otherTokens' | 'tokenTotalMismatch'>;
function accountLabel(row: Pick<SessionActivity['billing'], 'accountRef' | 'accountLabel'>, locale: SupportedLocale, unknownKey = 'usage.activity.accountUnknown') {
  return row.accountRef ? [row.accountLabel, translate(locale, 'usage.activity.accountRef', { ref: row.accountRef.slice(0, 8) })].filter(Boolean).join(' · ')
    : translate(locale, unknownKey);
}

export function SessionActivityPanel(props: { days: number; selectedDate: string | null; dateRange: DashboardDateRange | null; sources: readonly string[]; enabled: boolean }) {
  const { t } = useTranslation();
  const { data, error, scopeKey } = useSessionActivity(props.days, props.selectedDate, props.dateRange, props.sources, props.enabled);
  if (!isCliBackend()) return null;
  return <Card className="mt-4 min-w-0 overflow-hidden" aria-label={t('usage.activity.aria')}>
    <Card.Header className="pb-0"><Card.Title>{t('usage.activity.heading')}</Card.Title></Card.Header>
    <Card.Content>
      {error && <p role="status" className="mb-3 text-xs text-warning">{t('usage.activity.readError')} {data ? t('usage.activity.staleReading') : ''}</p>}
      {!data ? <p role="status" className="py-4 text-sm text-muted">{error ? t('usage.activity.unavailable') : t('usage.activity.loading')}</p> : <SessionActivityViews key={scopeKey} snapshot={data} />}
    </Card.Content>
  </Card>;
}

export function SessionActivityViews({ snapshot }: { snapshot: SessionActivitySnapshot }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  const recent = useMemo(() => [...snapshot.sessions].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)), [snapshot.sessions]);
  return <Tabs defaultSelectedKey="sessions" variant="secondary" className="min-w-0">
    <Tabs.ListContainer><Tabs.List aria-label={t('usage.activity.views')}>
      <Tabs.Tab id="sessions">{t('usage.activity.sessions')}<Tabs.Indicator /></Tabs.Tab>
      <Tabs.Tab id="billing">{t('usage.activity.billing')}<Tabs.Indicator /></Tabs.Tab>
    </Tabs.List></Tabs.ListContainer>
    <Tabs.Panel id="sessions" className="pt-3"><SessionList rows={recent} usage={snapshot} /></Tabs.Panel>
    <Tabs.Panel id="billing" className="pt-3">
      <UsageAttribution snapshot={snapshot} />
      <p className="mt-3 text-[11px] text-muted">{t('usage.activity.billingNote')}</p>
    </Tabs.Panel>
    {(snapshot.missingSources.length > 0 || snapshot.tokenTotalMismatch) && <p className="mt-3 text-[11px] text-muted">{snapshot.missingSources.length ? t('usage.activity.missingCoverage', { sources: new Intl.ListFormat(locale).format(snapshot.missingSources.map(sourceLabel)) }) : ''} {snapshot.tokenTotalMismatch ? t('usage.activity.totalMismatch') : ''}</p>}
  </Tabs>;
}

function UsageAttribution({ snapshot }: { snapshot: SessionActivitySnapshot }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  const [selected, setSelected] = useState<SessionActivitySnapshot['billing'][number] | null>(null);
  const selectedKey = selected ? attributionKey(selected) : null;
  const groups = useMemo(() => snapshot.billing.map(row => ({ row, sessions: relatedSessionActivity(snapshot.sessions, row) })), [snapshot]);
  // A refreshed range may no longer contain this group; keep its browser open with empty results.
  const active = selected ? groups.find(({ row }) => attributionKey(row) === selectedKey) ?? { row: selected, sessions: [] } : null;
  return <>
    <p className="mb-1 text-xs text-muted">{t('usage.activity.attributionSummary')}</p>
    {groups.some(({ row }) => !row.sessionRefs) && <p role="status" className="mt-2 text-xs text-muted">{t('usage.activity.sessionLinksUnavailable')}</p>}
    <div className="flex flex-col divide-y divide-separator">
      {groups.map(({ row, sessions }) => <div key={attributionKey(row)} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{serviceLabel(row.service, locale)}</p><span className={`rounded-md px-2 py-0.5 text-[11px] ${row.mode === 'unknown' ? 'bg-warning/10 text-warning' : 'bg-surface-secondary text-muted'}`}>{modeLabel(row.mode, locale)}</span></div>
          <p className="mt-1 break-words text-xs text-muted" title={row.accountRef ? t('usage.activity.accountRef', { ref: row.accountRef }) : undefined}>{accountLabel(row, locale)}</p>
          {row.service === 'unknown' && row.mode === 'unknown' && !row.accountRef && snapshot.otherTokens > 0 && <p className="mt-1 text-[11px] text-muted">{t('usage.activity.unlinkedTokens', { tokens: number(snapshot.otherTokens, locale) })}</p>}
        </div>
        <div className="shrink-0 text-right text-xs tabular-nums"><p>{number(row.tokens, locale)} Token</p><p className="text-muted">{money(row, locale)}</p></div>
        <Button size="sm" variant="secondary" className="!h-7 !min-h-7 text-xs" isDisabled={!sessions.length} aria-haspopup="dialog" aria-expanded={selectedKey === attributionKey(row)} aria-label={`${row.sessionRefs ? t('usage.activity.viewRelatedSessions', { count: sessions.length }) : t('usage.activity.viewRelatedSessionsAction')} · ${serviceLabel(row.service, locale)} · ${modeLabel(row.mode, locale)} · ${accountLabel(row, locale)}`} onPress={() => setSelected(row)}>{row.sessionRefs ? t('usage.activity.viewRelatedSessions', { count: sessions.length }) : t('usage.activity.viewRelatedSessionsAction')}</Button>
      </div>)}
      {!groups.length && <p className="py-4 text-sm text-muted">{t('usage.activity.noBilling')}</p>}
    </div>
    {active && <SessionBrowser key={selectedKey} rows={active.sessions} open onOpenChange={open => { if (!open) setSelected(null); }} title={t('usage.activity.relatedSessions')} closeLabel={t('usage.activity.closeRelatedSessions')} description={<>
      <p>{serviceLabel(active.row.service, locale)} · {modeLabel(active.row.mode, locale)} · {accountLabel(active.row, locale)}</p>
      <p className="mt-1">{t('usage.activity.relatedSessionNote')}</p>
    </>} />}
  </>;
}

function SessionList({ rows, usage }: { rows: SessionActivity[]; usage: SessionUsage }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <>
    {rows.length ? <SessionRows rows={rows.slice(0, 6)} contribution={false} /> : <p className="py-4 text-sm text-muted">{t('usage.activity.noSessions')}</p>}
    <Button className="mt-2 h-7 text-xs" size="sm" variant="ghost" aria-haspopup="dialog" aria-expanded={open} onPress={() => setOpen(true)}>{t('usage.activity.viewAllSessions', { count: rows.length })}</Button>
    <SessionBrowser rows={rows} usage={usage} open={open} onOpenChange={setOpen} />
  </>;
}

function SessionBrowser({ rows, usage, open, onOpenChange, title, closeLabel, description }: { rows: SessionActivity[]; usage?: SessionUsage; open: boolean; onOpenChange(open: boolean): void; title?: string; closeLabel?: string; description?: ReactNode }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(''), [sources, setSources] = useState<string[]>([]), [page, setPage] = useState(1);
  const [project, setProject] = useState(''), [sort, setSort] = useState<SessionSort>('recent');
  const searchInput = useRef<HTMLInputElement>(null), sourceTrigger = useRef<HTMLButtonElement>(null), projectTrigger = useRef<HTMLButtonElement>(null);
  const facets = useMemo(() => sessionActivityFacets(rows, query, sources, project), [rows, query, sources, project]);
  const filtered = useMemo(() => sortSessionActivity(filterSessionActivity(rows, query, sources, project), sort), [rows, query, sources, project, sort]);
  const result = sessionActivityPage(filtered, page);
  const hasFilters = Boolean(query.trim() || sources.length || project);
  return <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}><Modal.Container placement="center" scroll="inside"><Modal.Dialog aria-label={title ?? t('usage.activity.allSessions')} className="w-full max-w-4xl">
    <Modal.CloseTrigger aria-label={closeLabel ?? t('usage.activity.closeAllSessions')} /><Modal.Header><Modal.Heading>{title ?? t('usage.activity.allSessions')}</Modal.Heading><div className="text-xs text-muted">{description ?? t('usage.explorer.windowNote')}</div></Modal.Header>
    <Modal.Body className="flex flex-col gap-3">
      <div role="group" aria-label={t('usage.activity.filters')} className="flex min-w-0 flex-wrap items-center gap-2">
        <SearchField aria-label={t('usage.activity.search')} variant="secondary" className="min-w-0 flex-1 basis-full sm:basis-auto" value={query} onChange={value => { setQuery(value); setPage(1); }}>
          <Label className="sr-only">{t('usage.activity.search')}</Label>
          <SearchField.Group className="!h-8 !min-h-8"><SearchField.SearchIcon /><SearchField.Input ref={searchInput} className="!text-xs" placeholder={t('usage.activity.searchPlaceholder')} /><SearchField.ClearButton /></SearchField.Group>
        </SearchField>
        <Select aria-label="Agent" selectionMode="multiple" value={sources.length ? sources : ['all']} onChange={keys => {
          const next = Array.isArray(keys) ? keys.map(String) : keys == null ? [] : [String(keys)];
          setSources(next.includes('all') && sources.length ? [] : next.filter(value => value !== 'all'));
          setPage(1);
        }} variant="secondary" className="min-w-0 max-w-52">
          <Label className="sr-only">Agent</Label>
          <Select.Trigger ref={sourceTrigger} className="!h-8 !min-h-8 !w-fit max-w-full !text-xs"><Select.Value className="min-w-0 truncate">{sources.length === 0 ? t('usage.filter.allAgents') : sources.length > 1 ? t('usage.filter.selectedAgents', { count: sources.length }) : <span className="flex min-w-0 items-center gap-1.5"><ProviderIcon provider={sources[0]} size={18} /><span className="truncate">{sourceLabel(sources[0])}</span></span>}</Select.Value><Select.Indicator /></Select.Trigger>
          <Select.Popover className="w-64 max-w-[calc(100vw-2rem)]"><ListBox aria-label="Agent" selectionMode="multiple">
            <ListBox.Item id="all" textValue={t('usage.filter.allAgents')} className="text-xs">{t('usage.filter.allAgents')}<ListBox.ItemIndicator /></ListBox.Item>
            {facets.sources.map(({ value, count }) => <ListBox.Item id={value} key={value} textValue={sourceLabel(value)} className="gap-2 pe-8! text-xs"><span className="flex size-6 shrink-0 items-center justify-center"><ProviderIcon provider={value} size={18} /></span><span className="min-w-0 flex-1 truncate" title={sourceLabel(value)}>{sourceLabel(value)}</span><span className="shrink-0 text-[11px] tabular-nums text-muted">{t('usage.activity.sessionCount', { count })}</span><ListBox.ItemIndicator /></ListBox.Item>)}
          </ListBox></Select.Popover>
        </Select>
        <Select aria-label={t('usage.explorer.project')} value={project ? `project:${project}` : 'all'} onChange={key => { if (typeof key === 'string') { setProject(key === 'all' ? '' : key.slice('project:'.length)); setPage(1); } }} variant="secondary" className="min-w-0 max-w-56">
          <Label className="sr-only">{t('usage.explorer.project')}</Label>
          <Select.Trigger ref={projectTrigger} className="!h-8 !min-h-8 !w-fit max-w-full !text-xs"><Select.Value className="truncate">{project || t('usage.explorer.allProjects')}</Select.Value><Select.Indicator /></Select.Trigger>
          <Select.Popover className="w-64 max-w-[calc(100vw-2rem)]"><ListBox aria-label={t('usage.explorer.project')}>
            <ListBox.Item id="all" textValue={t('usage.explorer.allProjects')} className="text-xs">{t('usage.explorer.allProjects')}<ListBox.ItemIndicator /></ListBox.Item>
            {facets.projects.map(({ value, count }) => <ListBox.Item id={`project:${value}`} key={value} textValue={value} className="text-xs"><span className="min-w-0 truncate" title={value}>{value}</span><span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted">{t('usage.activity.sessionCount', { count })}</span><ListBox.ItemIndicator /></ListBox.Item>)}
          </ListBox></Select.Popover>
        </Select>
        <Select aria-label={t('usage.explorer.sort')} value={sort} onChange={key => { if (typeof key === 'string') { setSort(key as SessionSort); setPage(1); } }} variant="secondary" className="min-w-0 max-w-52">
          <Label className="sr-only">{t('usage.explorer.sort')}</Label>
          <Select.Trigger className="!h-8 !min-h-8 !w-fit max-w-full !text-xs"><ArrowDownUp className="size-3.5 shrink-0" aria-hidden /><Select.Value className="truncate" /><Select.Indicator /></Select.Trigger>
          <Select.Popover className="w-52 max-w-[calc(100vw-2rem)]"><ListBox aria-label={t('usage.explorer.sort')}>
            {(['recent', 'tokens', 'cost', 'duration'] as const).map(value => <ListBox.Item id={value} key={value} textValue={t(`usage.explorer.${{ recent: 'sortRecent', tokens: 'sortTokens', cost: 'sortCost', duration: 'sortDuration' }[value]}`)} className="text-xs">{t(`usage.explorer.${{ recent: 'sortRecent', tokens: 'sortTokens', cost: 'sortCost', duration: 'sortDuration' }[value]}`)}<ListBox.ItemIndicator /></ListBox.Item>)}
          </ListBox></Select.Popover>
        </Select>
      </div>
      {hasFilters && <div role="group" aria-label={t('usage.activity.selectedFilters')} className="flex min-w-0 flex-wrap items-center gap-1">
        {query.trim() && <SessionFilterChip label={t('usage.activity.searchFilter', { query: query.trim() })} onRemove={() => { setQuery(''); setPage(1); searchInput.current?.focus(); }} />}
        {sources.map(source => <SessionFilterChip key={source} label={`Agent: ${sourceLabel(source)}`} onRemove={() => { setSources(previous => previous.filter(value => value !== source)); setPage(1); sourceTrigger.current?.focus(); }} />)}
        {project && <SessionFilterChip label={`${t('usage.explorer.project')}: ${project}`} onRemove={() => { setProject(''); setPage(1); projectTrigger.current?.focus(); }} />}
        <Button variant="tertiary" size="sm" className="!h-6 !min-h-6 !px-2 !text-[11px]" onPress={() => { setQuery(''); setSources([]); setProject(''); setPage(1); searchInput.current?.focus(); }}>{t('usage.activity.clearFilters')}</Button>
      </div>}
      <p role="status" className="text-xs text-muted">{t('usage.activity.sessionCount', { count: filtered.length })}</p>
      {filtered.length ? <SessionRows rows={result.rows} contribution={Boolean(usage)} /> : <p className="py-8 text-center text-sm text-muted">{t('usage.activity.noMatches')}</p>}
      {usage && <p className="text-[11px] text-muted">{t('usage.activity.contributionNote')}</p>}
    </Modal.Body>
    <Modal.Footer className="items-center justify-between gap-3"><p className="text-xs tabular-nums text-muted">{t('usage.activity.page', { page: result.page, pages: result.pages })}</p><div className="flex gap-2"><Button size="sm" variant="secondary" isDisabled={result.page <= 1} onPress={() => setPage(result.page - 1)}>{t('usage.activity.previousPage')}</Button><Button size="sm" variant="secondary" isDisabled={result.page >= result.pages} onPress={() => setPage(result.page + 1)}>{t('usage.activity.nextPage')}</Button></div></Modal.Footer>
  </Modal.Dialog></Modal.Container></Modal.Backdrop>;
}

function SessionFilterChip({ label, onRemove }: { label: string; onRemove(): void }) {
  const { t } = useTranslation();
  return <Button className="!h-6 !min-h-6 max-w-full !gap-1 !px-2 !text-[11px]" variant="tertiary" size="sm" onPress={onRemove} aria-label={t('usage.activity.removeFilter', { label })}>
    <span className="min-w-0 truncate" title={label}>{label}</span><X className="size-3 shrink-0" aria-hidden />
  </Button>;
}

function SessionRows({ rows, contribution }: { rows: SessionActivity[]; contribution: boolean }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  return <div className="@container/session-list divide-y divide-separator">
      {rows.map(row => <details key={`${row.source}:${row.sessionId}`} className="group py-1">
        <summary className="grid min-w-0 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-2 outline-offset-2 hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent @3xl/session-list:gap-x-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <ProviderIcon provider={row.source} size={20} />
            <div className="min-w-0 flex-1 @3xl/session-list:grid @3xl/session-list:grid-cols-[minmax(0,1fr)_minmax(0,8rem)_5rem] @3xl/session-list:items-center @3xl/session-list:gap-x-4">
              <p className="truncate text-sm font-medium" title={row.sessionTitle ?? `${sourceLabel(row.source)} · ${row.sessionId}`}>{row.sessionTitle ?? `${sourceLabel(row.source)} · ${row.sessionId.slice(-8)}`}</p>
              <p className="flex min-w-0 items-center gap-1 text-[11px] text-muted @3xl/session-list:contents">
                <span className="truncate" title={row.projectLabel}>{row.projectLabel}</span>
                <span aria-hidden className="shrink-0 @3xl/session-list:hidden">·</span>
                <time className="shrink-0 whitespace-nowrap" dateTime={row.lastActivityAt} title={new Date(row.lastActivityAt).toLocaleString(locale)}>{age(row.lastActivityAt, locale)}</time>
              </p>
            </div>
          </div>
          <div className={`shrink-0 text-right text-xs tabular-nums @3xl/session-list:grid @3xl/session-list:items-center @3xl/session-list:gap-x-4 ${contribution ? '@3xl/session-list:grid-cols-[7.5rem_9.5rem]' : '@3xl/session-list:grid-cols-[7.5rem_7rem]'}`}><p className="whitespace-nowrap">{row.tokens === null ? t('usage.activity.usageNotRecorded') : `${number(row.tokens, locale)} Token`}</p><div className="whitespace-nowrap text-[11px] text-muted"><Tooltip delay={200}>
            <Tooltip.Trigger<'span'> render={props => <span {...props} />} className="cursor-help rounded outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent">
              {row.costUsd === null ? t('usage.activity.amountUnknown') : `$${row.costUsd.toLocaleString(locale, { maximumFractionDigits: 4 })}`}{contribution && row.sharePercent !== null ? ` · ${row.sharePercent.toFixed(1)}%` : ''}
            </Tooltip.Trigger>
            <Tooltip.Content placement="top">{costLabel(row.costKind, locale)}</Tooltip.Content>
          </Tooltip></div></div>
        </summary>
        <div className="ml-2 flex flex-col gap-2 border-l-2 border-separator py-2 pl-3 text-xs text-muted sm:ml-9">
          <p>{serviceLabel(row.billing.service, locale)} · {modeLabel(row.billing.mode, locale)} · {accountLabel(row.billing, locale, 'usage.activity.sessionAccountUnknown')}</p>
          {row.billing.mode === 'unknown' && <p>{t('usage.activity.insufficientBillingEvidence')}</p>}
          {!row.models?.length && <p>{row.model === 'unknown' ? t('usage.activity.modelNotRecorded') : row.model}</p>}
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
