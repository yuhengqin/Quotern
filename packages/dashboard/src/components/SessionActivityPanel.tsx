import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { dashboardNow } from '../lib/demo-runtime';
import { Link } from '@tanstack/react-router';
import { Autocomplete, Button, Card, Label, ListBox, SearchField, Select, Table, Tabs, Tooltip, useFilter } from '@heroui/react';
import { ArrowDown, ArrowUp, ChevronRight, ChevronUp, Download, X } from 'lucide-react';
import { translate, type SupportedLocale } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';
import type { SessionActivity, SessionActivitySnapshot, SessionListPage } from 'quotern-core';
import { useSessionActivity } from '@/hooks/useSessionActivity';
import { sourceLabel } from '@/lib/tokens';
import { isCliBackend } from '@/lib/api';
import type { DashboardDateRange } from '@/lib/dashboard-date-range';
import { ProviderIcon } from './ProviderIcon';
import { filterSessionActivity, relatedSessionActivity, sessionActivityFacets, sessionActivityPage, sortSessionActivity, type SessionSort } from '../lib/session-activity';
import { FilterAutocompletePopover, FilterSelectPopover } from './FilterMenu';
import { createSessionPageSearch, sessionAttributionKey, type SessionPageSearch, type SessionScope } from '../lib/session-page';
import { getDashboardReturnState, rememberDashboardSessionView } from '../lib/dashboard-return-state';
import { sessionThreads, sessionGroups, sessionIdentity, sessionCsv, sessionBranchRows, filterSessionBranches } from '../lib/session-insights';
import { SessionInsightDetails, ContextAuditButton } from './SessionInsightDetails';
import { formatSessionTokens, formatSessionUsd } from '@/lib/session-metric-format';
import { accountLabel, costLabel, modeLabel, serviceLabel } from '../lib/session-labels';
import type { DetailRange } from '../lib/session-detail';
import { SessionPagination } from './SessionPagination';
import { sessionDisplayIdentity, sessionDisplayTitle, sessionProjectDisplay } from '../lib/session-list-display';

const sessionColumns = 'min-w-0 items-center gap-2 px-1 @3xl/session-list:grid-cols-[minmax(0,2fr)_minmax(14.5rem,1fr)] @3xl/session-list:gap-x-5 @3xl/session-list:px-2';
const sessionIdentityColumns = 'min-w-0 flex-1 @3xl/session-list:grid @3xl/session-list:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_6rem] @3xl/session-list:items-center @3xl/session-list:gap-x-4';
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
  const searchInput = useRef<HTMLInputElement>(null), sourceTrigger = useRef<HTMLButtonElement>(null), projectTrigger = useRef<HTMLDivElement>(null);
  const { contains } = useFilter({ sensitivity: 'base' });
  const facets = useMemo(() => pageData?.facets ?? sessionActivityFacets(rows, query, sources, project), [pageData, rows, query, sources, project]);
  const filtered = useMemo(() => pageData ? rows : sortSessionActivity(filterSessionActivity(rows, query, sources, project).filter(row=>!value.model||row.model===value.model||row.models?.some(model=>model.model===value.model)), sort, direction), [pageData, rows, query, sources, project, sort, direction,value.model]);
  const models=useMemo(()=>pageData?.facets.models??[...new Set(rows.flatMap(row=>row.modelNames??row.models?.map(model=>model.model)??[row.model]))].filter(model=>model!=='unknown').sort(),[pageData,rows]);
  const threads=useMemo(()=>sessionThreads(filtered),[filtered]);
  const result = pageData ? { ...pageData.pagination, rows: threads.roots } : sessionActivityPage(threads.roots, page, value.pageSize);
  const totalRoots = pageData?.pagination.totalRoots ?? threads.roots.length;
  const totalSessions = pageData?.pagination.totalSessions ?? filtered.length;
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
  return <section aria-label={t('usage.activity.allSessions')} aria-busy={loading} className="@container/session-browser min-w-0 rounded-2xl border border-separator bg-surface p-4 sm:p-5">
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={t('usage.activity.filters')} className="flex min-w-0 flex-wrap items-center gap-2">
        <SearchField aria-label={t('usage.activity.search')} variant="secondary" className="min-w-0 flex-1 basis-full @3xl/session-browser:basis-56" value={query} onChange={q => onChange({ q })}>
          <Label className="sr-only">{t('usage.activity.search')}</Label>
          <SearchField.Group className="!h-8 !min-h-8"><SearchField.SearchIcon /><SearchField.Input ref={searchInput} className="!text-xs" placeholder={t('usage.activity.searchPlaceholder')} /><SearchField.ClearButton /></SearchField.Group>
        </SearchField>
        <Select aria-label="Agent" selectionMode="multiple" value={sources.length ? sources : ['all']} onChange={keys => {
          const next = Array.isArray(keys) ? keys.map(String) : keys == null ? [] : [String(keys)];
          onChange({ sources: next.includes('all') && sources.length ? [] : next.filter(value => value !== 'all') });
        }} variant="secondary" className="min-w-0 max-w-52">
          <Label className="sr-only">Agent</Label>
          <Select.Trigger ref={sourceTrigger} className="!h-8 !min-h-8 !w-fit max-w-full !items-center !py-0 !text-xs"><Select.Value className="min-w-0 truncate !text-xs !leading-4">{sources.length === 0 ? t('usage.filter.allAgents') : sources.length > 1 ? t('usage.filter.selectedAgents', { count: sources.length }) : <span className="flex min-w-0 items-center gap-1.5"><ProviderIcon provider={sources[0]} size={18} /><span className="truncate">{sourceLabel(sources[0])}</span></span>}</Select.Value><Select.Indicator /></Select.Trigger>
          <FilterSelectPopover className="w-64 max-w-[calc(100vw-2rem)]"><ListBox aria-label="Agent" selectionMode="multiple">
            <ListBox.Item id="all" textValue={t('usage.filter.allAgents')} className="text-xs">{t('usage.filter.allAgents')}<ListBox.ItemIndicator /></ListBox.Item>
            {facets.sources.map(({ value, count }) => <ListBox.Item id={value} key={value} textValue={sourceLabel(value)} className="gap-2 pe-8! text-xs"><span className="flex size-6 shrink-0 items-center justify-center"><ProviderIcon provider={value} size={18} /></span><span className="min-w-0 flex-1 truncate" title={sourceLabel(value)}>{sourceLabel(value)}</span><span className="shrink-0 text-[11px] tabular-nums text-muted">{t('usage.activity.sessionCount', { count })}</span><ListBox.ItemIndicator /></ListBox.Item>)}
          </ListBox></FilterSelectPopover>
        </Select>
        <Autocomplete aria-label={t('usage.explorer.project')} selectionMode="single" value={project ? `project:${project}` : 'all'} onChange={key => { if (typeof key === 'string') onChange({ project: key === 'all' ? '' : key.slice('project:'.length) }); }} variant="secondary" className="min-w-0 max-w-56">
          <Label className="sr-only">{t('usage.explorer.project')}</Label>
          <Autocomplete.Trigger ref={projectTrigger} className="!h-8 !min-h-8 !w-fit max-w-full !items-center !py-0 !text-xs [&>button]:absolute [&>button]:inset-0 [&>button]:w-full [&>button]:rounded-[inherit]"><Autocomplete.Value className="truncate !text-xs !leading-4">{() => <span title={project || undefined}>{project ? sessionProjectDisplay(project) : t('usage.explorer.allProjects')}</span>}</Autocomplete.Value><Autocomplete.Indicator /></Autocomplete.Trigger>
          <FilterAutocompletePopover className="w-72 max-w-[calc(100vw-2rem)]">
            <Autocomplete.Filter filter={contains}>
              <SearchField aria-label={t('usage.activity.searchProjects')} autoFocus variant="secondary"><SearchField.Group className="!h-8 !min-h-8"><SearchField.SearchIcon /><SearchField.Input className="!text-xs" placeholder={t('usage.activity.searchProjects')} /><SearchField.ClearButton /></SearchField.Group></SearchField>
              <ListBox aria-label={t('usage.explorer.project')} renderEmptyState={() => <p className="p-3 text-xs text-muted">{t('usage.activity.noMatchingProjects')}</p>}>
            <ListBox.Item id="all" textValue={t('usage.explorer.allProjects')} className="text-xs">{t('usage.explorer.allProjects')}<ListBox.ItemIndicator /></ListBox.Item>
            {facets.projects.map(({ value, count }) => <ListBox.Item id={`project:${value}`} key={value} textValue={value} className="text-xs"><span className="min-w-0 truncate" title={value}>{sessionProjectDisplay(value)}</span><span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted">{t('usage.activity.sessionCount', { count })}</span><ListBox.ItemIndicator /></ListBox.Item>)}
              </ListBox>
            </Autocomplete.Filter>
            {project && <Button slot={null} size="sm" variant="tertiary" className="mt-1 w-full shrink-0 !text-xs" onPress={() => onChange({ project: '' })}>{t('usage.activity.clearProject')}</Button>}
          </FilterAutocompletePopover>
        </Autocomplete>
        <Select aria-label={t('usage.common.model')} value={value.model??'all'} onChange={key=>onChange({model:key==='all'?undefined:String(key)})} variant="secondary" className="min-w-0 max-w-60"><Label className="sr-only">{t('usage.common.model')}</Label><Select.Trigger className="!h-8 !min-h-8 !items-center !py-0 !text-xs"><Select.Value className="truncate !text-xs !leading-4"/><Select.Indicator/></Select.Trigger><FilterSelectPopover><ListBox><ListBox.Item id="all" textValue={t('usage.insights.modelAll')}>{t('usage.insights.modelAll')}<ListBox.ItemIndicator/></ListBox.Item>{models.map(model=><ListBox.Item key={model} id={model} textValue={model}><span className="truncate" title={model}>{model}</span><ListBox.ItemIndicator/></ListBox.Item>)}</ListBox></FilterSelectPopover></Select>
      </div>
      {hasFilters && <div role="group" aria-label={t('usage.activity.selectedFilters')} className="flex min-w-0 flex-wrap items-center gap-1">
        {query.trim() && <SessionFilterChip label={t('usage.activity.searchFilter', { query: query.trim() })} onRemove={() => { onChange({ q: '' }); searchInput.current?.focus(); }} />}
        {sources.map(source => <SessionFilterChip key={source} label={`Agent: ${sourceLabel(source)}`} onRemove={() => { onChange({ sources: sources.filter(value => value !== source) }); sourceTrigger.current?.focus(); }} />)}
        {project && <SessionFilterChip label={`${t('usage.explorer.project')}: ${project}`} onRemove={() => { onChange({ project: '' }); projectTrigger.current?.querySelector<HTMLButtonElement>('button')?.focus(); }} />}
        {value.model&&<SessionFilterChip label={value.model} onRemove={()=>onChange({model:undefined})}/>}
        <Button variant="tertiary" size="sm" className="!h-6 !min-h-6 !px-2 !text-[11px]" onPress={() => { onChange({ q: '', sources: [], project: '', model: undefined }); searchInput.current?.focus(); }}>{t('usage.activity.clearFilters')}</Button>
      </div>}
      <div ref={resultTop} className="flex min-w-0 scroll-mt-4 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p role="status" data-session-count className="text-xs tabular-nums text-muted">
          {loading ? t('usage.activity.loading') : <>
            {t('usage.activity.rootSessionCount', { count: totalRoots })}
            {totalSessions > totalRoots && <> · {t('usage.activity.includingRelated', { count: totalSessions })}</>}
          </>}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <div role="group" aria-label={t('usage.activity.viewOptions')} className="flex min-w-0 flex-wrap items-center gap-2">
            <Select aria-label={t('usage.insights.groupLabel')} value={value.groupBy??'none'} onChange={key=>onChange({groupBy:key as 'none'|'date'|'project'})} variant="secondary" className="max-w-44"><Label className="sr-only">{t('usage.insights.groupLabel')}</Label><Select.Trigger className="!h-8 !min-h-8 !items-center !py-0 !text-xs"><Select.Value className="!text-xs !leading-4"/><Select.Indicator/></Select.Trigger><FilterSelectPopover><ListBox>{(['none','date','project'] as const).map(mode=><ListBox.Item key={mode} id={mode} textValue={t(`usage.insights.${mode==='none'?'groupNone':mode==='date'?'groupDate':'groupProject'}`)}>{t(`usage.insights.${mode==='none'?'groupNone':mode==='date'?'groupDate':'groupProject'}`)}<ListBox.ItemIndicator/></ListBox.Item>)}</ListBox></FilterSelectPopover></Select>
            <SessionSortControl sorting={{ sort, direction, onSort: next => onChange({ sort: next, direction: next === sort && direction === 'descending' ? 'ascending' : 'descending' }) }} onChange={onChange} />
          </div>
          <div role="group" aria-label={t('usage.activity.listActions')} className="flex items-center gap-1 border-l border-separator pl-3">
            <Button size="sm" variant="ghost" className="!h-8 !min-h-8 !gap-1.5 !px-2 !text-xs" onPress={() => { void exportCsv(); }} isDisabled={exporting || loading}><Download className="size-3.5" aria-hidden />{t('usage.insights.exportCsv')}</Button><ContextAuditButton/>
          </div>
        </div>
      </div>
      {exportError && <p role="status" className="text-xs text-warning">{t('usage.activity.exportFailed')}</p>}
      {filtered.length ? groups.map(group=><section key={group.label}>{group.label&&<h2 className="my-3 break-words text-sm font-medium">{group.label}</h2>}<SessionRows rows={group.sessions} availableSessions={availableSessions} childrenByParent={threads.children} showTokenShare={Boolean(usage)} range={range} sorting={{ sort, direction, onSort: next => onChange({ sort: next, direction: next === sort && direction === 'descending' ? 'ascending' : 'descending' }) }} /></section>) : <p className="py-8 text-center text-sm text-muted">{t('usage.activity.noMatches')}</p>}
    </div>
    <SessionPagination page={result.page} pages={result.pages} pageSize={value.pageSize} totalRoots={totalRoots} loading={loading} onChange={onChange} />
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

function SessionSortControl({ sorting, onChange }: { sorting: SessionSorting; onChange(patch: Partial<SessionPageSearch>): void }) {
  const { t } = useTranslation();
  return <>
    <Select aria-label={t('usage.explorer.sort')} value={`${sorting.sort}:${sorting.direction}`} onChange={key => {
      if (typeof key !== 'string') return;
      const [sort, direction] = key.split(':') as [SessionSort, SessionPageSearch['direction']];
      onChange({ sort, direction });
    }} variant="secondary" className="min-w-0 max-w-64 @3xl/session-browser:hidden">
      <Label className="sr-only">{t('usage.explorer.sort')}</Label>
      <Select.Trigger data-session-sort className="!h-8 !min-h-8 !w-fit max-w-full !items-center !gap-1.5 !py-0 !text-xs">
        {sorting.direction === 'ascending' ? <ArrowUp className="size-3.5 shrink-0" aria-hidden /> : <ArrowDown className="size-3.5 shrink-0" aria-hidden />}
        <Select.Value className="truncate !text-xs !leading-4" /><Select.Indicator />
      </Select.Trigger>
      <FilterSelectPopover className="w-64"><ListBox aria-label={t('usage.explorer.sort')}>
        {(['recent', 'tokens', 'cost', 'duration'] as const).flatMap(sort => (['descending', 'ascending'] as const).map(direction => {
          const label = `${t(sessionSortLabels[sort])} · ${t(direction === 'ascending' ? 'usage.activity.sortAscending' : 'usage.activity.sortDescending')}`;
          return <ListBox.Item key={`${sort}:${direction}`} id={`${sort}:${direction}`} textValue={label} className="text-xs">{label}<ListBox.ItemIndicator /></ListBox.Item>;
        }))}
      </ListBox></FilterSelectPopover>
    </Select>
    <div className="hidden @3xl/session-browser:block"><SessionSortButton label={t('usage.explorer.taskTime')} column="duration" sorting={sorting} /></div>
  </>;
}

function SessionSortButton({ label, column, sorting }: { label: string; column: SessionSort; sorting: SessionSorting }) {
  const { t } = useTranslation();
  const active = sorting.sort === column;
  const nextDirection = active && sorting.direction === 'descending' ? 'ascending' : 'descending';
  return <Button size="sm" variant="ghost" className={`!h-8 !min-h-8 !min-w-0 !gap-1 !rounded-md !px-1.5 !text-xs !font-medium ${active ? 'text-foreground' : 'text-muted'}`} aria-pressed={active} aria-label={`${label} · ${t(nextDirection === 'ascending' ? 'usage.activity.sortAscending' : 'usage.activity.sortDescending')}`} onPress={() => sorting.onSort(column)}>
    <Table.SortableColumnHeader className="table__sortable-column-header !gap-1" sortDirection={active ? sorting.direction : undefined} indicator={<ChevronUp className="table__sortable-column-indicator !size-3" aria-hidden />}>{label}</Table.SortableColumnHeader>
  </Button>;
}

function SessionRows({ rows, availableSessions = rows, showTokenShare, sorting, childrenByParent, range, autoOpenKey, depth=0, metricHeaders=false }: { rows: SessionActivity[]; availableSessions?: SessionActivity[]; showTokenShare: boolean; sorting?: SessionSorting; childrenByParent?: Map<string,SessionActivity[]>; range?: DetailRange; autoOpenKey?: string; depth?:number; metricHeaders?: boolean }) {
  const { t } = useTranslation();
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
  return <div ref={container} className={`${depth === 0 ? '@container/session-list ' : ''}divide-y divide-separator`}>
      {sorting && <div role="group" aria-label={t('usage.explorer.sort')} className="hidden grid-cols-[3rem_minmax(0,1fr)] rounded-lg bg-surface-secondary py-1 text-xs font-medium text-muted @3xl/session-list:grid">
        <span aria-hidden />
        <div className={`grid ${sessionColumns}`}><div className={sessionIdentityColumns}>
            <span className="pl-[1.875rem]">{t('usage.activity.sessionColumn')}</span><span>{t('usage.explorer.project')}</span>
            <div className="-ml-1"><SessionSortButton label={t('usage.activity.recent')} column="recent" sorting={sorting} /></div>
        </div>
        <div className="grid grid-cols-[minmax(7.5rem,1.2fr)_minmax(6.5rem,1fr)] items-center gap-x-4">
          <div className="flex justify-end"><SessionSortButton label="Token" column="tokens" sorting={sorting} /></div>
          <div className="flex justify-end"><SessionSortButton label={t('usage.common.cost')} column="cost" sorting={sorting} /></div>
        </div></div>
      </div>}
      {rows.map(row => <SessionRow key={sessionIdentity(row)} row={row} availableSessions={availableSessions} showTokenShare={showTokenShare} childrenByParent={childrenByParent} range={range} depth={depth} showMetricHeaders={Boolean(sorting) || metricHeaders} onOpen={() => setSelected(row)} />)}
      {detailRow && <SessionInsightDetails key={sessionIdentity(detailRow)} row={detailRow} sessions={availableSessions} showTokenShare={showTokenShare} range={range} onClose={() => setSelected(null)} />}
    </div>;
}

function SessionRow({ row, availableSessions, childrenByParent, showTokenShare, depth, range, showMetricHeaders, onOpen }: { row: SessionActivity; availableSessions: SessionActivity[]; childrenByParent?: Map<string, SessionActivity[]>; showTokenShare: boolean; depth: number; range?: DetailRange; showMetricHeaders: boolean; onOpen(): void }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  const [open, setOpen] = useState(false), [model, setModel] = useState('all');
  const childrenId = useId();
  const children = childrenByParent?.get(sessionIdentity(row)) ?? [];
  const models = [...new Set(sessionBranchRows(children, childrenByParent ?? new Map()).flatMap(child => child.modelNames ?? child.models?.map(usage => usage.model) ?? [child.model]))].sort();
  const visible = filterSessionBranches(children, childrenByParent ?? new Map(), model);
  const title = sessionDisplayTitle(row, t('usage.activity.untitledSession'));
  const identity = sessionDisplayIdentity(row, t('usage.activity.untitledSession'));
  return <div className="py-1 [--session-step:1rem] @3xl/session-list:[--session-step:1.5rem]" style={{ '--session-depth': Math.min(depth, 3), '--session-child-depth': Math.min(depth + 1, 3) } as CSSProperties} data-session-row data-session-depth={depth}>
    <div data-session-open-row={open} className={`relative grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-start rounded-lg @3xl/session-list:grid-cols-[3rem_minmax(0,1fr)] ${open ? 'bg-accent/5' : ''}`}>
      {open && <span data-session-expanded-mark aria-hidden className="pointer-events-none absolute inset-y-1 left-[calc(var(--session-depth)*var(--session-step))] w-0.5 rounded-full bg-accent" />}
      {children.length ? <Button data-session-disclosure size="sm" variant="ghost" className={`relative z-10 translate-x-[calc(var(--session-depth)*var(--session-step))] ${identity.shortId ? 'mt-2' : 'mt-1.5'} !h-8 !min-h-8 !w-full !min-w-0 !px-0 !text-xs tabular-nums @3xl/session-list:mt-2 ${open ? 'text-accent' : 'text-muted'}`} aria-expanded={open} aria-controls={childrenId} aria-label={`${t(open ? 'usage.insights.collapse' : 'usage.insights.expand')} · ${title} · ${children.length}`} onPress={() => setOpen(!open)}><span className="flex items-center gap-0.5" title={`${t(open ? 'usage.insights.collapse' : 'usage.insights.expand')} · ${children.length}`}><ChevronRight className={`size-3.5 shrink-0 ${open ? 'rotate-90' : ''}`} aria-hidden /><span>{children.length}</span></span></Button> : <span aria-hidden />}
      <button type="button" data-session-trigger aria-haspopup="dialog" onClick={onOpen} className={`grid min-h-12 w-full cursor-pointer rounded-lg py-1.5 text-left outline-offset-2 ${depth >= 2 ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_auto]'} ${open ? 'hover:bg-accent/10' : 'hover:bg-surface-secondary/60'} focus-visible:outline-2 focus-visible:outline-accent ${sessionColumns}`}>
        <div className={sessionIdentityColumns}>
            <div data-session-name className={`flex min-w-0 items-center gap-2 pl-[calc(var(--session-depth)*var(--session-step))] ${children.length ? 'min-h-8' : ''} @3xl/session-list:min-h-0 @3xl/session-list:gap-2.5`}>
              <ProviderIcon provider={row.source} size={20} />
              <div className="relative min-w-0 flex-1 overflow-hidden" title={`${title}${identity.role ? ` · ${t('usage.detail.agentRole')}: ${identity.role}` : ''} · ${sourceLabel(row.source)} · ${row.sessionId}`}>
                <div className="flex min-w-0 items-baseline gap-2">
                  <span data-session-title title={`${identity.name}${identity.role ? ` · ${t('usage.detail.agentRole')}: ${identity.role}` : ''}`} className={`min-w-0 truncate text-sm font-medium ${open ? 'text-accent' : ''}`}>{identity.name}</span>
                  {identity.role && <><span className="sr-only">{t('usage.detail.agentRole')}: {identity.role}</span><span data-session-role aria-hidden className="hidden min-w-0 max-w-[55%] truncate text-xs text-foreground/70 @3xl/session-list:inline" title={`${t('usage.detail.agentRole')}: ${identity.role}`}>{t('usage.detail.agentRole')}: {identity.role}</span></>}
                </div>
                {identity.shortId && <p className="relative flex min-w-0 items-baseline gap-1 text-xs leading-4 text-foreground/70"><span className="sr-only">ID</span><span aria-hidden className="hidden shrink-0 text-muted @3xl/session-list:inline">ID</span><span data-session-short-id className="min-w-0 truncate font-mono" title={row.sessionId}>{identity.shortId}</span></p>}
              </div>
            </div>
            <p className={`${depth >= 2 ? 'pl-[calc(var(--session-depth)*var(--session-step))] @3xl/session-list:pl-0' : ''} flex min-w-0 items-center gap-1 text-xs text-muted @3xl/session-list:contents`}>
              <SessionProjectLabel project={row.projectLabel} />
              <span aria-hidden className="shrink-0 @3xl/session-list:hidden">·</span>
              <time data-session-activity className="shrink-0 whitespace-nowrap" dateTime={row.lastActivityAt} title={new Date(row.lastActivityAt).toLocaleString(locale)}>{age(row.lastActivityAt, locale)}</time>
            </p>
        </div>
        <div className={`${depth >= 2 ? 'flex flex-wrap items-baseline justify-between gap-x-3 pl-[calc(var(--session-depth)*var(--session-step))] @3xl/session-list:pl-0' : ''} min-w-0 text-right text-sm tabular-nums @3xl/session-list:grid @3xl/session-list:grid-cols-[minmax(7.5rem,1.2fr)_minmax(6.5rem,1fr)] @3xl/session-list:items-center @3xl/session-list:gap-x-4`}>
          <p data-session-tokens className="whitespace-nowrap font-medium">{row.tokens === null ? t('usage.activity.usageNotRecorded') : <>{formatSessionTokens(row.tokens)}<span className={showMetricHeaders ? '@3xl/session-list:sr-only' : undefined}> Token</span></>}</p>
          <div data-session-cost className="whitespace-nowrap font-medium"><Tooltip delay={200}>
            <Tooltip.Trigger<'span'> render={props => <span {...props} />} className="cursor-help rounded outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent">{row.costUsd === null ? t('usage.activity.amountUnknown') : formatSessionUsd(row.costUsd, locale)}</Tooltip.Trigger>
            <Tooltip.Content placement="top">{costLabel(row.costKind, locale)}</Tooltip.Content>
          </Tooltip></div>
        </div>
      </button>
    </div>
    {children.length > 0 && <div id={childrenId} hidden={!open} data-session-related className="relative mb-1 min-w-0 bg-surface-secondary/30">
      <span data-session-tree-line aria-hidden className="pointer-events-none absolute inset-y-0 left-[calc(var(--session-child-depth)*var(--session-step))] border-l border-separator" />
      {open && <>
        <div data-related-toolbar role="group" aria-label={`${t('usage.activity.relatedSessions')} · ${title}`} className="relative flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-1.5 pl-[calc(2.75rem+var(--session-depth)*var(--session-step))] pr-1 @3xl/session-list:pl-[calc(3.5rem+var(--session-depth)*var(--session-step))] @3xl/session-list:pr-2">
          <p className="shrink-0 text-xs font-medium text-muted">{t('usage.activity.relatedSessions')}</p>
          {models.length > 1 || model !== 'all' ? <div className="flex min-w-0 max-w-60 flex-1 items-center gap-1.5 text-xs text-muted"><span className="shrink-0">{t('usage.common.model')}:</span><Select aria-label={t('usage.common.model')} value={model} onChange={key => setModel(String(key))} variant="secondary" className="min-w-0 max-w-full">
            <Label className="sr-only">{t('usage.common.model')}</Label>
            <Select.Trigger className="!h-7 !min-h-7 !w-fit max-w-full !items-center !py-0 !text-xs"><Select.Value className="min-w-0 truncate !text-xs !leading-4">{model === 'all' ? t('usage.common.all') : model}</Select.Value><Select.Indicator /></Select.Trigger>
            <FilterSelectPopover><ListBox><ListBox.Item id="all" textValue={t('usage.insights.modelAll')}>{t('usage.insights.modelAll')}<ListBox.ItemIndicator /></ListBox.Item>{models.map(value => <ListBox.Item id={value} key={value} textValue={value}><span className="truncate" title={value}>{value}</span><ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></FilterSelectPopover>
          </Select></div> : <span data-related-model className="flex h-7 min-w-0 max-w-full items-center gap-1.5 text-xs text-muted"><span className="shrink-0">{t('usage.common.model')}:</span><span className="truncate" title={models[0]}>{models[0] ?? '—'}</span></span>}
        </div>
        <SessionRows rows={visible} availableSessions={availableSessions} showTokenShare={showTokenShare} childrenByParent={childrenByParent} depth={depth + 1} metricHeaders={showMetricHeaders} range={range} />
        {!visible.length && <p className="py-3 pl-11 text-xs text-muted @3xl/session-list:pl-14">{t('usage.activity.noMatches')}</p>}
      </>}
    </div>}
  </div>;
}

function SessionProjectLabel({ project }: { project: string }) {
  const display = sessionProjectDisplay(project), split = display.lastIndexOf('…');
  return <span data-session-project className="relative flex min-w-0 overflow-hidden" title={project}>
    <span aria-hidden className={split < 0 ? 'truncate' : 'min-w-0 overflow-hidden whitespace-nowrap'}>{split < 0 ? display : display.slice(0, split)}</span>
    {split >= 0 && <span aria-hidden className="max-w-[60%] shrink-0 truncate">{display.slice(split)}</span>}
    <span className="sr-only">{project}</span>
  </span>;
}
