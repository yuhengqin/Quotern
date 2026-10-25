import { useLayoutEffect, useMemo } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Button } from '@heroui/react';
import { History as RotateCcwClock } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import { BackToUsageLink } from '../components/BackToUsageLink';
import { DashboardTimeRangeControl } from '../components/DashboardTimeRangeControl';
import { FocusedSession, SessionAttributionSummary, SessionBrowser, SessionCoverageNote } from '../components/SessionActivityPanel';
import { useSessionActivity } from '@/hooks/useSessionActivity';
import { useSessionList } from '@/hooks/useSessionList';
import { useRollingDayRange } from '@/hooks/useRollingDayRange';
import type { SessionListPage } from 'quotern-core';
import { isCliBackend } from '@/lib/api';
import { sourceLabel } from '@/lib/tokens';
import type { DashboardDateRange } from '../lib/dashboard-date-range';
import { parseSessionPageSearch, selectSessionPageRange, sessionAttributionKey, sessionPageRows, sessionTimeRangeControl, updateSessionPageSearch, type SessionPageSearch } from '../lib/session-page';
import type { DashboardRange } from '../lib/dashboard-range';

export function SessionsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const rawSearch = useSearch({ strict: false });
  const search = useMemo(() => parseSessionPageSearch(rawSearch), [rawSearch]);
  const rollingRange = useRollingDayRange(search.range === 'last-24-hours');
  const dateRange = useMemo<DashboardDateRange | null>(() => rollingRange ?? (search.start && search.end ? {
    start: search.start, end: search.end, fromTime: search.fromTime, toTime: search.toTime,
  } : null), [rollingRange, search.start, search.end, search.fromTime, search.toTime]);
  const timeControl = sessionTimeRangeControl(search);
  const local = isCliBackend();
  const target = search.sessionSource && search.sessionId ? { source: search.sessionSource, sessionId: search.sessionId, period: search.sessionPeriod } : undefined;
  const focused = useSessionActivity(search.days, null, dateRange, search.scopeSources, local && Boolean(target), target);
  const list = useSessionList(search, dateRange, local && !target);
  const { data, error } = target ? focused : list;
  const pageData = data && 'pagination' in data && 'facets' in data ? data as SessionListPage : undefined;
  const rows = useMemo(() => data ? pageData ? data.sessions : sessionPageRows(data, search.group) : [], [data, pageData, search.group]);
  const group = data?.billing.find(row => sessionAttributionKey(row) === search.group);
  const update = (patch: Partial<SessionPageSearch>) => {
    void navigate({ to: '/sessions', search: previous => updateSessionPageSearch(parseSessionPageSearch(previous), patch), replace: !('page' in patch), resetScroll: false });
  };
  const changeTimeRange = (next: DashboardRange | DashboardDateRange) => {
    void navigate({ to: '/sessions', search: previous => selectSessionPageRange(parseSessionPageSearch(previous), next), resetScroll: false });
  };

  useLayoutEffect(() => {
    const container = document.querySelector<HTMLElement>('[data-dashboard-scroll-container]');
    (container ?? window).scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  return <div className="session-page min-w-0 pb-6">
    <header className="mb-5 min-w-0">
      <BackToUsageLink />
      <div className="flex items-center gap-2"><RotateCcwClock className="size-6 text-accent" aria-hidden /><h1 className="text-2xl font-semibold tracking-tight">{t('usage.activity.pageTitle')}</h1></div>
      {search.scopeSources.length > 0 && <p className="mt-2 text-xs text-muted">{t('usage.activity.overviewScope', { sources: new Intl.ListFormat(i18n.resolvedLanguage).format(search.scopeSources.map(sourceLabel)) })}</p>}
    </header>
    {target ? <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted">{t(target.period ? 'usage.detail.selectedRange' : 'usage.activity.notificationTarget')} · {sourceLabel(target.source)}</p>
      <Button size="sm" variant="tertiary" onPress={() => update({ sessionSource: undefined, sessionId: undefined })}>{t('usage.activity.allSessions')}</Button>
    </div> : <div className="mb-4">
      <DashboardTimeRangeControl value={timeControl.value} customRange={timeControl.customRange} onChange={changeTimeRange} onCustomRangeChange={changeTimeRange} />
    </div>}
    {!local ? <p role="status" className="py-8 text-sm text-muted">{t('usage.activity.localOnly')}</p> : <>
      {error && <div className="mb-4 flex flex-wrap items-center gap-2"><p role="status" className="text-xs text-warning">{t('usage.activity.readError')} {data ? t('usage.activity.staleReading') : t('usage.activity.unavailable')}</p>{!target && <Button size="sm" variant="secondary" onPress={list.retry}>{t('usage.detail.retry')}</Button>}</div>}
      {search.group && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-secondary px-4 py-3 text-xs">
        <div className="min-w-0"><p className="font-medium">{t('usage.activity.relatedSessions')}{group && <> · <SessionAttributionSummary row={group} /></>}</p><p className="mt-1 text-muted">{t('usage.activity.relatedSessionNote')}</p></div>
        <Button size="sm" variant="tertiary" onPress={() => update({ group: undefined })}>{t('usage.activity.allSessions')}</Button>
      </div>}
      {!data ? <p role="status" className="py-12 text-center text-sm text-muted">{t(error ? 'usage.activity.unavailable' : 'usage.activity.loading')}</p> : <>
        {target ? <FocusedSession rows={rows} source={target.source} sessionId={target.sessionId} focusKey={search.sessionFocus} range={data.range} /> : <SessionBrowser rows={rows} availableSessions={data.sessions} usage={search.group ? undefined : data} value={search} onChange={update} range={data.range} pageData={pageData} loading={list.loading} onExport={list.exportCsv} onNormalizePage={list.currentData ? page => { void navigate({ to: '/sessions', search: previous => ({ ...parseSessionPageSearch(previous), page }), replace: true, resetScroll: false }); } : undefined} />}
        <SessionCoverageNote snapshot={data} />
      </>}
    </>}
  </div>;
}
