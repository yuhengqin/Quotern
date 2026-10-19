import { useLayoutEffect, useMemo } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Button } from '@heroui/react';
import { History as RotateCcwClock, RefreshCw } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import { BackToUsageLink } from '../components/BackToUsageLink';
import { DashboardTimeRangeControl } from '../components/DashboardTimeRangeControl';
import { SessionAttributionSummary, SessionBrowser, SessionCoverageNote } from '../components/SessionActivityPanel';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useSessionActivity } from '@/hooks/useSessionActivity';
import { useRollingDayRange } from '@/hooks/useRollingDayRange';
import { isCliBackend } from '@/lib/api';
import { dispatchDataSynced } from '@/lib/shell-events';
import { sourceLabel } from '@/lib/tokens';
import { formatDashboardDateRange, type DashboardDateRange } from '../lib/dashboard-date-range';
import { DEFAULT_STATS_TIMEZONE, getStatsTimezoneLabel, localDateDaysAgo, localDateNow } from '../lib/stats-timezone';
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
  const { data, error } = useSessionActivity(search.days, null, dateRange, search.scopeSources, local);
  const rows = useMemo(() => data ? sessionPageRows(data, search.group) : [], [data, search.group]);
  const group = data?.billing.find(row => sessionAttributionKey(row) === search.group);
  const range = dateRange ?? { start: localDateDaysAgo(search.days), end: localDateNow() };
  const formatInstant = (stamp: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    timeZone: DEFAULT_STATS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(stamp));
  const rangeLabel = dateRange?.fromTime && dateRange.toTime
    ? `${formatInstant(dateRange.fromTime)} – ${formatInstant(dateRange.toTime)}` : formatDashboardDateRange(range);
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
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <BackToUsageLink />
        <div className="flex items-center gap-2"><RotateCcwClock className="size-6 text-accent" aria-hidden /><h1 className="text-2xl font-semibold tracking-tight">{t('usage.activity.pageTitle')}</h1></div>
        <p className="mt-2 text-xs text-muted">{t('usage.explorer.reportedPeriod', { range: rangeLabel })} · {getStatsTimezoneLabel()}</p>
        {search.scopeSources.length > 0 && <p className="mt-1 text-xs text-muted">{t('usage.activity.overviewScope', { sources: new Intl.ListFormat(i18n.resolvedLanguage).format(search.scopeSources.map(sourceLabel)) })}</p>}
        <p className="mt-1 text-xs text-muted">{t('usage.explorer.windowNote')}</p>
      </div>
      <div className="flex items-center gap-1 pt-1">
        {local && <Button size="sm" variant="tertiary" isIconOnly aria-label={t('usage.activity.refresh')} onPress={dispatchDataSynced}><RefreshCw className="size-4" aria-hidden /></Button>}
        <ThemeToggle />
      </div>
    </header>
    <div className="mb-4">
      <DashboardTimeRangeControl value={timeControl.value} customRange={timeControl.customRange} onChange={changeTimeRange} onCustomRangeChange={changeTimeRange} />
    </div>
    {!local ? <p role="status" className="py-8 text-sm text-muted">{t('usage.activity.localOnly')}</p> : <>
      {error && <p role="status" className="mb-4 text-xs text-warning">{t('usage.activity.readError')} {data ? t('usage.activity.staleReading') : t('usage.activity.unavailable')}</p>}
      {search.group && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-secondary px-4 py-3 text-xs">
        <div className="min-w-0"><p className="font-medium">{t('usage.activity.relatedSessions')}{group && <> · <SessionAttributionSummary row={group} /></>}</p><p className="mt-1 text-muted">{t('usage.activity.relatedSessionNote')}</p></div>
        <Button size="sm" variant="tertiary" onPress={() => update({ group: undefined })}>{t('usage.activity.allSessions')}</Button>
      </div>}
      {!data ? <p role="status" className="py-12 text-center text-sm text-muted">{t(error ? 'usage.activity.unavailable' : 'usage.activity.loading')}</p> : <>
        <SessionBrowser rows={rows} usage={search.group ? undefined : data} value={search} onChange={update} />
        <SessionCoverageNote snapshot={data} />
      </>}
    </>}
  </div>;
}
