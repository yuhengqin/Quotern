import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { dashboardNow } from '../lib/demo-runtime';
import { Link } from '@tanstack/react-router';
import { Button, Card, Label, ListBox, SearchField, Select, Table, Tabs, Tooltip } from '@heroui/react';
import { ArrowDown, ArrowDownUp, ArrowUp, ChevronUp, X } from 'lucide-react';
import { translate, type SupportedLocale } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';
import type { SessionActivity, SessionActivitySnapshot, SessionListPage } from 'quotern-core';
import { useSessionActivity } from '@/hooks/useSessionActivity';
import { sourceLabel } from '@/lib/tokens';
import { isCliBackend } from '@/lib/api';
import type { DashboardDateRange } from '@/lib/dashboard-date-range';
import { ProviderIcon } from './ProviderIcon';
import { filterSessionActivity, relatedSessionActivity, sessionActivityFacets, sessionActivityPage, sortSessionActivity, type SessionSort } from '../lib/session-activity';
import { FilterSelectPopover } from './FilterMenu';
import { createSessionPageSearch, sessionAttributionKey, type SessionPageSearch, type SessionScope } from '../lib/session-page';
import { getDashboardReturnState, rememberDashboardSessionView } from '../lib/dashboard-return-state';
import { sessionThreads, sessionGroups, sessionIdentity, sessionCsv, sessionBranchRows, filterSessionBranches } from '../lib/session-insights';
import { SessionInsightDetails, ContextAuditButton } from './SessionInsightDetails';
import { formatSessionTokens, formatSessionUsd } from '@/lib/session-metric-format';
import { accountLabel, costLabel, modeLabel, serviceLabel } from '../lib/session-labels';
import type { DetailRange } from '../lib/session-detail';
import { SessionPagination } from './SessionPagination';

const sessionColumns = 'min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 @3xl/session-list:grid-cols-[minmax(0,2fr)_minmax(14.5rem,1fr)] @3xl/session-list:gap-x-5';
const sessionIdentityColumns = 'min-w-0 flex-1 @3xl/session-list:grid @3xl/session-list:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7.5rem] @3xl/session-list:items-center @3xl/session-list:gap-x-4';
const sessionSortLabels = { recent: 'usage.activity.recent', tokens: 'usage.common.totalTokens', cost: 'usage.common.cost', duration: 'usage.explorer.taskTime' } as const;
type SessionSorting = Pick<SessionPageSearch, 'sort' | 'direction'> & { onSort(sort: SessionSort): void };
function age(stamp: string, locale: SupportedLocale) {
  const seconds = Math.max(0, (dashboardNow().getTime() - Date.parse(stamp)) / 1000);
  return seconds < 60 ? translate(locale, 'usage.activity.justNow')
    : seconds < 3600 ? translate(locale, 'usage.activity.minutesAgo', { count: Math.floor(seconds / 60) })
      : seconds < 86400 ? translate(locale, 'usage.activity.hoursAgo', { count: Math.floor(seconds / 3600) })
        : new Date(stamp).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' });
}
function money(row: Pick<SessionActivity, 'costUsd' | 'costKind'>, locale: SupportedLocale) {
  return row.costUsd === null ? translate(locale, 'usage.activity.amountUnknown')
    : `${formatSessionUsd(row.costUsd, locale)} · ${costLabel(row.costKind, locale)}`;
}
type SessionUsage = Pick<SessionActivitySnapshot, 'totalTokens' | 'otherTokens' | 'tokenTotalMismatch'>;

export function SessionActivityPanel(props: { days: number; selectedDate: string | null; dateRange: DashboardDateRange | null; sources: readonly string[]; enabled: boolean }) {
  const { t } = useTranslation();
  const { data, error, scopeKey } = useSessionActivity(props.days, props.selectedDate, props.dateRange, props.sources, props.enabled, undefined, true);
  if (!isCliBackend()) return null;
  return <Card className="mt-4 min-w-0 overflow-hidden" aria-label={t('usage.activity.aria')}>
    <Card.Header className="pb-0"><Card.Title>{t('usage.activity.heading')}</Card.Title></Card.Header>
    <Card.Content>
      {error && <p role="status" className="mb-3 text-xs text-warning">{t('usage.activity.readError')} {data ? t('usage.activity.staleReading') : ''}</p>}
    {!data ? <p role="status" className="py-4 text-sm text-muted">{error ? t('usage.activity.unavailable') : t('usage.activity.loading')}</p> : <SessionActivityViews key={scopeKey} snapshot={data} scope={props} />}
    </Card.Content>
  </Card>;
}

export function SessionActivityViews({ snapshot, scope }: { snapshot: SessionActivitySnapshot; scope: SessionScope }) {
  const { t } = useTranslation();
  const recent = useMemo(() => [...snapshot.sessions].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)), [snapshot.sessions]);
  return <Tabs defaultSelectedKey={getDashboardReturnState()?.sessionView ?? 'sessions'} onSelectionChange={key => { if (key === 'sessions' || key === 'billing') rememberDashboardSessionView(key); }} variant="secondary" className="min-w-0">
    <Tabs.ListContainer><Tabs.List aria-label={t('usage.activity.views')}>
      <Tabs.Tab id="sessions">{t('usage.activity.sessions')}<Tabs.Indicator /></Tabs.Tab>
      <Tabs.Tab id="billing">{t('usage.activity.billing')}<Tabs.Indicator /></Tabs.Tab>
    </Tabs.List></Tabs.ListContainer>
    <Tabs.Panel id="sessions" className="pt-3"><SessionList rows={recent} total={snapshot.sessionCount ?? recent.length} scope={scope} range={snapshot.range} /></Tabs.Panel>
    <Tabs.Panel id="billing" className="pt-3">
      <UsageAttribution snapshot={snapshot} scope={scope} />
      <p className="mt-3 text-[11px] text-muted">{t('usage.activity.billingNote')}</p>
    </Tabs.Panel>
    <SessionCoverageNote snapshot={snapshot} />
  </Tabs>;
}

export function SessionCoverageNote({ snapshot }: { snapshot: SessionActivitySnapshot }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  return (snapshot.missingSources.length > 0 || snapshot.tokenTotalMismatch) && <p className="mt-3 text-[11px] text-muted">{snapshot.missingSources.length ? t('usage.activity.missingCoverage', { sources: new Intl.ListFormat(locale).format(snapshot.missingSources.map(sourceLabel)) }) : ''} {snapshot.tokenTotalMismatch ? t('usage.activity.totalMismatch') : ''}</p>;
}

export function SessionAttributionSummary({ row }: { row: SessionActivitySnapshot['billing'][number] }) {
  const { i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  return <span>{serviceLabel(row.service, locale)} · {modeLabel(row.mode, locale)} · {accountLabel(row, locale)}</span>;
}

function UsageAttribution({ snapshot, scope }: { snapshot: SessionActivitySnapshot; scope: SessionScope }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  const groups = useMemo(() => snapshot.billing.map(row => ({ row, count: row.sessionCount ?? relatedSessionActivity(snapshot.sessions, row).length })), [snapshot]);
  return <>
    <p className="mb-1 text-xs text-muted">{t('usage.activity.attributionSummary')}</p>
    {groups.some(({ row }) => !row.sessionRefs && row.sessionCount === undefined) && <p role="status" className="mt-2 text-xs text-muted">{t('usage.activity.sessionLinksUnavailable')}</p>}
    <div className="flex flex-col divide-y divide-separator">
      {groups.map(({ row, count }) => <div key={sessionAttributionKey(row)} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{serviceLabel(row.service, locale)}</p><span className={`rounded-md px-2 py-0.5 text-[11px] ${row.mode === 'unknown' ? 'bg-warning/10 text-warning' : 'bg-surface-secondary text-muted'}`}>{modeLabel(row.mode, locale)}</span></div>
          <p className="mt-1 break-words text-xs text-muted" title={row.accountRef ? t('usage.activity.accountRef', { ref: row.accountRef }) : undefined}>{accountLabel(row, locale)}</p>
          {row.service === 'unknown' && row.mode === 'unknown' && !row.accountRef && snapshot.otherTokens > 0 && <p className="mt-1 text-[11px] text-muted">{t('usage.activity.unlinkedTokens', { tokens: formatSessionTokens(snapshot.otherTokens) })}</p>}
        </div>
        <div className="shrink-0 text-right text-xs tabular-nums"><p>{formatSessionTokens(row.tokens)} Token</p><p className="text-muted">{money(row, locale)}</p></div>
        {count ? <Link to="/sessions" search={{ ...createSessionPageSearch(scope), group: sessionAttributionKey(row) }} className="button button--sm button--secondary !h-7 !min-h-7 text-xs" aria-label={`${t('usage.activity.viewRelatedSessions', { count })} · ${serviceLabel(row.service, locale)} · ${modeLabel(row.mode, locale)} · ${accountLabel(row, locale)}`}>{t('usage.activity.viewRelatedSessions', { count })}</Link>
          : <Button size="sm" variant="secondary" className="!h-7 !min-h-7 text-xs" isDisabled>{row.sessionRefs || row.sessionCount !== undefined ? t('usage.activity.viewRelatedSessions', { count: 0 }) : t('usage.activity.viewRelatedSessionsAction')}</Button>}
      </div>)}
      {!groups.length && <p className="py-4 text-sm text-muted">{t('usage.activity.noBilling')}</p>}
    </div>
  </>;
}

function SessionList({ rows, total, scope, range }: { rows: SessionActivity[]; total: number; scope: SessionScope; range?: DetailRange }) {
  const { t } = useTranslation();
  return <>
    {rows.length ? <SessionRows rows={rows.slice(0, 6)} availableSessions={rows} showTokenShare={false} range={range} /> : <p className="py-4 text-sm text-muted">{t('usage.activity.noSessions')}</p>}
    <Link to="/sessions" search={createSessionPageSearch(scope)} className="button button--sm button--ghost mt-2 h-7 text-xs">{t('usage.activity.viewAllSessions', { count: total })}</Link>
  </>;
}

export function SessionBrowser({ rows, availableSessions = rows, usage, value, onChange, range, pageData, loading = false, onExport, onNormalizePage }: { rows: SessionActivity[]; availableSessions?: SessionActivity[]; usage?: SessionUsage; value: SessionPageSearch; onChange(patch: Partial<SessionPageSearch>): void; range?: DetailRange; pageData?: SessionListPage; loading?: boolean; onExport?(): Promise<string>; onNormalizePage?(page: number): void }) {
  const { t, i18n } = useTranslation();
  const { q: query, sources, page, project, sort, direction } = value;
  const searchInput = useRef<HTMLInputElement>(null), sourceTrigger = useRef<HTMLButtonElement>(null), projectTrigger = useRef<HTMLButtonElement>(null);
  const facets = useMemo(() => pageData?.facets ?? sessionActivityFacets(rows, query, sources, project), [pageData, rows, query, sources, project]);
  const filtered = useMemo(() => pageData ? rows : sortSessionActivity(filterSessionActivity(rows, query, sources, project).filter(row=>!value.model||row.model===value.model||row.models?.some(model=>model.model===value.model)), sort, direction), [pageData, rows, query, sources, project, sort, direction,value.model]);
  const models=useMemo(()=>pageData?.facets.models??[...new Set(rows.flatMap(row=>row.modelNames??row.models?.map(model=>model.model)??[row.model]))].filter(model=>model!=='unknown').sort(),[pageData,rows]);
  const threads=useMemo(()=>sessionThreads(filtered),[filtered]);
  const result = pageData ? { ...pageData.pagination, rows: threads.roots } : sessionActivityPage(threads.roots, page, value.pageSize);
  const groups=sessionGroups(result.rows,value.groupBy??'none',i18n.resolvedLanguage??'zh-CN');
  const hasFilters = Boolean(query.trim() || sources.length || project || value.model);
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState(false);
  const resultTop = useRef<HTMLDivElement>(null), previousPage = useRef(`${result.page}:${value.pageSize}`);
  useEffect(() => {
    if (!loading && result.page !== value.page) onNormalizePage?.(result.page);
  }, [loading, result.page, value.page, onNormalizePage]);
  useLayoutEffect(() => {
    const next = `${result.page}:${value.pageSize}`;
    if (loading || previousPage.current === next) return;
    previousPage.current = next;
    resultTop.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [loading, result.page, value.pageSize]);
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true); setExportError(false);
    try {
      const csv = onExport ? await onExport() : sessionCsv(filtered);
      const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'quotern-sessions.csv'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setExportError(true); }
    finally { setExporting(false); }
  };
  return <section aria-label={t('usage.activity.allSessions')} aria-busy={loading} className="min-w-0 rounded-2xl border border-separator bg-surface p-4 sm:p-5">
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={t('usage.activity.filters')} className="flex min-w-0 flex-wrap items-center gap-2">
        <SearchField aria-label={t('usage.activity.search')} variant="secondary" className="min-w-0 flex-1 basis-full sm:basis-auto" value={query} onChange={q => onChange({ q })}>
          <Label className="sr-only">{t('usage.activity.search')}</Label>
          <SearchField.Group className="!h-8 !min-h-8"><SearchField.SearchIcon /><SearchField.Input ref={searchInput} className="!text-xs" placeholder={t('usage.activity.searchPlaceholder')} /><SearchField.ClearButton /></SearchField.Group>
        </SearchField>
        <Select aria-label="Agent" selectionMode="multiple" value={sources.length ? sources : ['all']} onChange={keys => {
          const next = Array.isArray(keys) ? keys.map(String) : keys == null ? [] : [String(keys)];
          onChange({ sources: next.includes('all') && sources.length ? [] : next.filter(value => value !== 'all') });
        }} variant="secondary" className="min-w-0 max-w-52">
          <Label className="sr-only">Agent</Label>
          <Select.Trigger ref={sourceTrigger} className="!h-8 !min-h-8 !w-fit max-w-full !text-xs"><Select.Value className="min-w-0 truncate">{sources.length === 0 ? t('usage.filter.allAgents') : sources.length > 1 ? t('usage.filter.selectedAgents', { count: sources.length }) : <span className="flex min-w-0 items-center gap-1.5"><ProviderIcon provider={sources[0]} size={18} /><span className="truncate">{sourceLabel(sources[0])}</span></span>}</Select.Value><Select.Indicator /></Select.Trigger>
          <FilterSelectPopover className="w-64 max-w-[calc(100vw-2rem)]"><ListBox aria-label="Agent" selectionMode="multiple">
            <ListBox.Item id="all" textValue={t('usage.filter.allAgents')} className="text-xs">{t('usage.filter.allAgents')}<ListBox.ItemIndicator /></ListBox.Item>
            {facets.sources.map(({ value, count }) => <ListBox.Item id={value} key={value} textValue={sourceLabel(value)} className="gap-2 pe-8! text-xs"><span className="flex size-6 shrink-0 items-center justify-center"><ProviderIcon provider={value} size={18} /></span><span className="min-w-0 flex-1 truncate" title={sourceLabel(value)}>{sourceLabel(value)}</span><span className="shrink-0 text-[11px] tabular-nums text-muted">{t('usage.activity.sessionCount', { count })}</span><ListBox.ItemIndicator /></ListBox.Item>)}
          </ListBox></FilterSelectPopover>
        </Select>
        <Select aria-label={t('usage.explorer.project')} value={project ? `project:${project}` : 'all'} onChange={key => { if (typeof key === 'string') onChange({ project: key === 'all' ? '' : key.slice('project:'.length) }); }} variant="secondary" className="min-w-0 max-w-56">
          <Label className="sr-only">{t('usage.explorer.project')}</Label>
          <Select.Trigger ref={projectTrigger} className="!h-8 !min-h-8 !w-fit max-w-full !text-xs"><Select.Value className="truncate">{project || t('usage.explorer.allProjects')}</Select.Value><Select.Indicator /></Select.Trigger>
          <FilterSelectPopover className="w-64 max-w-[calc(100vw-2rem)]"><ListBox aria-label={t('usage.explorer.project')}>
            <ListBox.Item id="all" textValue={t('usage.explorer.allProjects')} className="text-xs">{t('usage.explorer.allProjects')}<ListBox.ItemIndicator /></ListBox.Item>
            {facets.projects.map(({ value, count }) => <ListBox.Item id={`project:${value}`} key={value} textValue={value} className="text-xs"><span className="min-w-0 truncate" title={value}>{value}</span><span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted">{t('usage.activity.sessionCount', { count })}</span><ListBox.ItemIndicator /></ListBox.Item>)}
          </ListBox></FilterSelectPopover>
        </Select>
        <Select aria-label={t('usage.explorer.sort')} value={sort} onChange={key => { if (typeof key === 'string') onChange({ sort: key as SessionSort, direction: 'descending' }); }} variant="secondary" className="min-w-0 max-w-52">
          <Label className="sr-only">{t('usage.explorer.sort')}</Label>
          <Select.Trigger className="!h-8 !min-h-8 !w-fit max-w-full !text-xs"><ArrowDownUp className="size-3.5 shrink-0" aria-hidden /><Select.Value className="truncate" /><Select.Indicator /></Select.Trigger>
          <FilterSelectPopover className="w-52 max-w-[calc(100vw-2rem)]"><ListBox aria-label={t('usage.explorer.sort')}>
            {(['recent', 'tokens', 'cost', 'duration'] as const).map(value => <ListBox.Item id={value} key={value} textValue={t(sessionSortLabels[value])} className="text-xs">{t(sessionSortLabels[value])}<ListBox.ItemIndicator /></ListBox.Item>)}
          </ListBox></FilterSelectPopover>
        </Select>
        <Button size="sm" variant="tertiary" isIconOnly className="!size-8 !min-h-8 !min-w-8" aria-label={t(direction === 'ascending' ? 'usage.activity.sortDescending' : 'usage.activity.sortAscending')} onPress={() => onChange({ direction: direction === 'ascending' ? 'descending' : 'ascending' })}>
          {direction === 'ascending' ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />}
        </Button>
      </div>
      {hasFilters && <div role="group" aria-label={t('usage.activity.selectedFilters')} className="flex min-w-0 flex-wrap items-center gap-1">
        {query.trim() && <SessionFilterChip label={t('usage.activity.searchFilter', { query: query.trim() })} onRemove={() => { onChange({ q: '' }); searchInput.current?.focus(); }} />}
        {sources.map(source => <SessionFilterChip key={source} label={`Agent: ${sourceLabel(source)}`} onRemove={() => { onChange({ sources: sources.filter(value => value !== source) }); sourceTrigger.current?.focus(); }} />)}
        {project && <SessionFilterChip label={`${t('usage.explorer.project')}: ${project}`} onRemove={() => { onChange({ project: '' }); projectTrigger.current?.focus(); }} />}
        {value.model&&<SessionFilterChip label={value.model} onRemove={()=>onChange({model:undefined})}/>}
        <Button variant="tertiary" size="sm" className="!h-6 !min-h-6 !px-2 !text-[11px]" onPress={() => { onChange({ q: '', sources: [], project: '', model: undefined }); searchInput.current?.focus(); }}>{t('usage.activity.clearFilters')}</Button>
      </div>}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Select aria-label={t('usage.common.model')} value={value.model??'all'} onChange={key=>onChange({model:key==='all'?undefined:String(key)})} variant="secondary" className="max-w-60"><Label className="sr-only">{t('usage.common.model')}</Label><Select.Trigger className="!h-8 !min-h-8 !text-xs"><Select.Value/><Select.Indicator/></Select.Trigger><FilterSelectPopover><ListBox><ListBox.Item id="all" textValue={t('usage.insights.modelAll')}>{t('usage.insights.modelAll')}<ListBox.ItemIndicator/></ListBox.Item>{models.map(model=><ListBox.Item key={model} id={model} textValue={model}><span className="truncate" title={model}>{model}</span><ListBox.ItemIndicator/></ListBox.Item>)}</ListBox></FilterSelectPopover></Select>
        <Select aria-label={t('usage.insights.groupLabel')} value={value.groupBy??'none'} onChange={key=>onChange({groupBy:key as 'none'|'date'|'project'})} variant="secondary" className="max-w-44"><Label className="sr-only">{t('usage.insights.groupLabel')}</Label><Select.Trigger className="!h-8 !min-h-8 !text-xs"><Select.Value/><Select.Indicator/></Select.Trigger><FilterSelectPopover><ListBox>{(['none','date','project'] as const).map(mode=><ListBox.Item key={mode} id={mode} textValue={t(`usage.insights.${mode==='none'?'groupNone':mode==='date'?'groupDate':'groupProject'}`)}>{t(`usage.insights.${mode==='none'?'groupNone':mode==='date'?'groupDate':'groupProject'}`)}<ListBox.ItemIndicator/></ListBox.Item>)}</ListBox></FilterSelectPopover></Select>
        <Button size="sm" variant="tertiary" onPress={() => { void exportCsv(); }} isDisabled={exporting || loading}>{t('usage.insights.exportCsv')}</Button><ContextAuditButton/>
      </div>
      {exportError && <p role="status" className="text-xs text-warning">{t('usage.activity.exportFailed')}</p>}
      <div ref={resultTop} className="scroll-mt-4"><p role="status" className="text-xs text-muted">{loading ? t('usage.activity.loading') : t('usage.activity.sessionCount', { count: pageData?.pagination.totalSessions ?? filtered.length })}</p></div>
      {filtered.length ? groups.map(group=><section key={group.label}>{group.label&&<h2 className="my-3 break-words text-sm font-medium">{group.label}</h2>}<SessionRows rows={group.sessions} availableSessions={availableSessions} childrenByParent={threads.children} showTokenShare={Boolean(usage)} range={range} sorting={{ sort, direction, onSort: next => onChange({ sort: next, direction: next === sort && direction === 'descending' ? 'ascending' : 'descending' }) }} /></section>) : <p className="py-8 text-center text-sm text-muted">{t('usage.activity.noMatches')}</p>}
    </div>
    <SessionPagination page={result.page} pages={result.pages} pageSize={value.pageSize} totalRoots={pageData?.pagination.totalRoots ?? threads.roots.length} loading={loading} onChange={onChange} />
  </section>;
}

/** A notification is an exact identity lookup, independent of list filters and pagination. */
export function FocusedSession({ rows, source, sessionId, focusKey, range }: { rows: SessionActivity[]; source: string; sessionId: string; focusKey?: string; range?: DetailRange }) {
  const { t } = useTranslation();
  const row = rows.find(value => value.source === source && value.sessionId === sessionId);
  return <div className="rounded-2xl border border-separator bg-surface p-4">
    {row ? <SessionRows rows={[row]} availableSessions={rows} showTokenShare={false} range={range} autoOpenKey={`${source}:${sessionId}:${focusKey ?? ''}`} /> : <p role="status" className="py-6 text-sm text-muted">{t('usage.activity.notificationMissing')}</p>}
  </div>;
}

function SessionFilterChip({ label, onRemove }: { label: string; onRemove(): void }) {
  const { t } = useTranslation();
  return <Button className="!h-6 !min-h-6 max-w-full !gap-1 !px-2 !text-[11px]" variant="tertiary" size="sm" onPress={onRemove} aria-label={t('usage.activity.removeFilter', { label })}>
    <span className="min-w-0 truncate" title={label}>{label}</span><X className="size-3 shrink-0" aria-hidden />
  </Button>;
}

function SessionSortButton({ label, column, sorting }: { label: string; column: SessionSort; sorting: SessionSorting }) {
  const { t } = useTranslation();
  const active = sorting.sort === column;
  const nextDirection = active && sorting.direction === 'descending' ? 'ascending' : 'descending';
  return <Button size="sm" variant="tertiary" className={`!h-7 !min-h-7 !min-w-0 !gap-1 !rounded-md !px-1 !text-[11px] !font-medium ${active ? 'text-foreground' : 'text-muted'}`} aria-pressed={active} aria-label={`${label} · ${t(nextDirection === 'ascending' ? 'usage.activity.sortAscending' : 'usage.activity.sortDescending')}`} onPress={() => sorting.onSort(column)}>
    <Table.SortableColumnHeader className="table__sortable-column-header !gap-1" sortDirection={active ? sorting.direction : undefined} indicator={<ChevronUp className="table__sortable-column-indicator !size-3" aria-hidden />}>{label}</Table.SortableColumnHeader>
  </Button>;
}

function SessionRows({ rows, availableSessions = rows, showTokenShare, sorting, childrenByParent, range, autoOpenKey, depth=0 }: { rows: SessionActivity[]; availableSessions?: SessionActivity[]; showTokenShare: boolean; sorting?: SessionSorting; childrenByParent?: Map<string,SessionActivity[]>; range?: DetailRange; autoOpenKey?: string; depth?:number }) {
  const { t, i18n } = useTranslation();
  const [selected,setSelected]=useState<Pick<SessionActivity,'source'|'sessionId'>|null>(null);
  const detailRow=rows.find(row=>selected&&row.source===selected.source&&row.sessionId===selected.sessionId);
  const container = useRef<HTMLDivElement>(null);
  const targetSource = rows[0]?.source, targetId = rows[0]?.sessionId;
  useLayoutEffect(() => {
    if (!autoOpenKey || !targetSource || !targetId) return;
    container.current?.querySelector<HTMLButtonElement>('[data-session-trigger]')?.focus({ preventScroll: true });
    setSelected({ source: targetSource, sessionId: targetId });
  }, [autoOpenKey, targetSource, targetId]);
  useEffect(()=>{if(selected&&!detailRow)setSelected(null);},[selected,detailRow]);
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  return <div ref={container} className="@container/session-list divide-y divide-separator">
      {sorting && <div role="group" aria-label={t('usage.explorer.sort')} className={`hidden rounded-lg bg-surface-secondary py-1 text-[11px] font-medium text-muted @3xl/session-list:grid ${sessionColumns}`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="w-5 shrink-0" aria-hidden />
          <div className={sessionIdentityColumns}>
            <span>{t('usage.activity.sessionColumn')}</span><span>{t('usage.explorer.project')}</span>
            <div className="-ml-1"><SessionSortButton label={t('usage.activity.recent')} column="recent" sorting={sorting} /></div>
          </div>
        </div>
        <div className="grid grid-cols-[minmax(7.5rem,1.2fr)_minmax(6.5rem,1fr)] items-center gap-x-4">
          <div className="flex justify-end"><SessionSortButton label="Token" column="tokens" sorting={sorting} /></div>
          <div className="flex justify-end"><SessionSortButton label={t('usage.common.cost')} column="cost" sorting={sorting} /></div>
        </div>
      </div>}
      {rows.map(row => <div key={`${row.source}:${row.sessionId}`} className="py-1">
        <button type="button" data-session-trigger aria-haspopup="dialog" onClick={()=>setSelected(row)} className={`grid w-full cursor-pointer rounded-xl py-2 text-left outline-offset-2 hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent ${sessionColumns}`}>
          <div className="flex min-w-0 items-center gap-2.5">
            <ProviderIcon provider={row.source} size={20} />
            <div className={sessionIdentityColumns}>
              <p className="truncate text-sm font-medium" title={row.sessionTitle ?? `${sourceLabel(row.source)} · ${row.sessionId}`}>{row.sessionTitle ?? `${sourceLabel(row.source)} · ${row.sessionId.slice(-8)}`}</p>
              <p className="flex min-w-0 items-center gap-1 text-[11px] text-muted @3xl/session-list:contents">
                <span className="truncate" title={row.projectLabel}>{row.projectLabel}</span>
                <span aria-hidden className="shrink-0 @3xl/session-list:hidden">·</span>
                <time className="shrink-0 whitespace-nowrap" dateTime={row.lastActivityAt} title={new Date(row.lastActivityAt).toLocaleString(locale)}>{age(row.lastActivityAt, locale)}</time>
              </p>
            </div>
          </div>
          <div className="min-w-0 text-right text-xs tabular-nums @3xl/session-list:grid @3xl/session-list:grid-cols-[minmax(7.5rem,1.2fr)_minmax(6.5rem,1fr)] @3xl/session-list:items-center @3xl/session-list:gap-x-4"><p className="whitespace-nowrap">{row.tokens === null ? t('usage.activity.usageNotRecorded') : `${formatSessionTokens(row.tokens)} Token`}</p><div className="whitespace-nowrap text-[11px] text-muted"><Tooltip delay={200}>
            <Tooltip.Trigger<'span'> render={props => <span {...props} />} className="cursor-help rounded outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent">
              {row.costUsd === null ? t('usage.activity.amountUnknown') : formatSessionUsd(row.costUsd,locale)}
            </Tooltip.Trigger>
            <Tooltip.Content placement="top">{costLabel(row.costKind, locale)}</Tooltip.Content>
          </Tooltip></div></div>
        </button>
        {childrenByParent?.has(sessionIdentity(row))&&<SessionChildren rows={childrenByParent.get(sessionIdentity(row))!} availableSessions={availableSessions} childrenByParent={childrenByParent} showTokenShare={showTokenShare} range={range} depth={depth+1}/>}
      </div>)}
      {detailRow && <SessionInsightDetails key={sessionIdentity(detailRow)} row={detailRow} sessions={availableSessions} showTokenShare={showTokenShare} range={range} onClose={() => setSelected(null)} />}
    </div>;
}

function SessionChildren({rows,availableSessions,childrenByParent,showTokenShare,depth,range}:{rows:SessionActivity[];availableSessions:SessionActivity[];childrenByParent:Map<string,SessionActivity[]>;showTokenShare:boolean;depth:number;range?:DetailRange}){
  const {t}=useTranslation();const [open,setOpen]=useState(false),[model,setModel]=useState('all');
  const models=[...new Set(sessionBranchRows(rows,childrenByParent).flatMap(row=>row.modelNames??row.models?.map(m=>m.model)??[row.model]))].sort();
  const visible=filterSessionBranches(rows,childrenByParent,model);
  return <div className="mb-2 ml-6 border-l border-separator pl-3"><Button variant="tertiary" size="sm" aria-expanded={open} onPress={()=>setOpen(!open)}>{t(open?'usage.insights.collapse':'usage.insights.expand')} · {rows.length}</Button>
    {open&&<><Select aria-label={t('usage.common.model')} value={model} onChange={key=>setModel(String(key))} variant="secondary" className="my-2 max-w-56"><Label className="sr-only">{t('usage.common.model')}</Label><Select.Trigger className="!h-8 !min-h-8 !text-xs"><Select.Value/><Select.Indicator/></Select.Trigger><FilterSelectPopover><ListBox><ListBox.Item id="all" textValue={t('usage.insights.modelAll')}>{t('usage.insights.modelAll')}<ListBox.ItemIndicator/></ListBox.Item>{models.map(value=><ListBox.Item id={value} key={value} textValue={value}><span className="truncate">{value}</span><ListBox.ItemIndicator/></ListBox.Item>)}</ListBox></FilterSelectPopover></Select>
    <SessionRows rows={visible} availableSessions={availableSessions} showTokenShare={showTokenShare} childrenByParent={childrenByParent} depth={depth} range={range}/></>}
  </div>;
}
