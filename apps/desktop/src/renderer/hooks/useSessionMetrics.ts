import { useCallback } from 'react';
import { fetchSessionMetrics, isCliBackend } from '@/lib/api';
import { dashboardRangeCacheKey, type DashboardDateRange } from '@/lib/dashboard-date-range';
import { useCachedRangeQuery } from './useCachedRangeQuery';

/** Session metadata has its own refresh path: it can change without tokens. */
export function useSessionMetrics(days: number, selectedDate: string | null, dateRange: DashboardDateRange | null, sources: readonly string[], enabled: boolean) {
  const start = selectedDate ?? dateRange?.start;
  const end = selectedDate ?? dateRange?.end;
  const fromTime = selectedDate ? undefined : dateRange?.fromTime, toTime = selectedDate ? undefined : dateRange?.toTime;
  const sourceKey = [...sources].sort().join(',');
  const key = `${days}|${start ?? ''}|${end ?? ''}|${fromTime ?? ''}|${toTime ?? ''}|${sourceKey}`;
  const cacheKey = `${dashboardRangeCacheKey(days, start && end ? { start, end, fromTime, toTime } : null)}|${sourceKey}`;
  const load = useCallback(() => fetchSessionMetrics(days, start && end ? { start, end, fromTime, toTime } : undefined, sourceKey ? sourceKey.split(',') : []), [days, start, end, fromTime, toTime, sourceKey]);
  const state = useCachedRangeQuery(cacheKey, key, load, enabled && isCliBackend());
  return { metrics: state.data, loading: isCliBackend() && state.loading, error: state.error };
}
