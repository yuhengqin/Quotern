import { useCallback } from 'react';
import type { SessionActivitySnapshot } from 'quotern-core';
import { isCliBackend, request } from '@/lib/api';
import { appendDashboardRangeQuery, type DashboardDateRange } from '@/lib/dashboard-date-range';
import { dashboardRangeScopeKey } from '@/lib/dashboard-range-scope';
import { useCachedRangeQuery } from './useCachedRangeQuery';

export function useSessionActivity(days: number, selectedDate: string | null, dateRange: DashboardDateRange | null, sources: readonly string[], enabled: boolean) {
  const start = selectedDate ?? dateRange?.start, end = selectedDate ?? dateRange?.end;
  const fromTime = selectedDate ? undefined : dateRange?.fromTime, toTime = selectedDate ? undefined : dateRange?.toTime;
  const sourceKey = [...sources].sort().join(',');
  const key = `${days}|${start ?? ''}|${end ?? ''}|${fromTime ?? ''}|${toTime ?? ''}|${sourceKey}`;
  const scopeKey = `${dashboardRangeScopeKey(days, start && end ? { start, end, fromTime, toTime } : null)}|${sourceKey}`;
  const load = useCallback(() => {
    const query = new URLSearchParams({ days: String(days) });
    if (start && end) appendDashboardRangeQuery(query, { start, end, fromTime, toTime });
    if (sourceKey) query.set('sources', sourceKey);
    return request<SessionActivitySnapshot>(`/functions/tud-session-activity?${query}`, { signal: AbortSignal.timeout(30_000) });
  }, [days, start, end, fromTime, toTime, sourceKey]);
  const state = useCachedRangeQuery(scopeKey, key, load, enabled && isCliBackend());
  return { ...state, scopeKey };
}
