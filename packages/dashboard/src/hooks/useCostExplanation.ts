import { useCallback } from 'react';
import { fetchUsageReport, isCliBackend } from '@/lib/api';
import { dashboardRangeCacheKey, type DashboardDateRange } from '@/lib/dashboard-date-range';
import { useCachedRangeQuery } from './useCachedRangeQuery';

export function useCostExplanation(days: number, selectedDate: string | null, dateRange: DashboardDateRange | null, sources: readonly string[], enabled: boolean, snapshot: object) {
  const start = selectedDate ?? dateRange?.start;
  const end = selectedDate ?? dateRange?.end;
  const fromTime = selectedDate ? undefined : dateRange?.fromTime, toTime = selectedDate ? undefined : dateRange?.toTime;
  const sourceKey = [...sources].sort().join(',');
  const key = `${days}|${start ?? ''}|${end ?? ''}|${fromTime ?? ''}|${toTime ?? ''}|${sourceKey}`;
  const cacheKey = `${dashboardRangeCacheKey(days, start && end ? { start, end, fromTime, toTime } : null)}|${sourceKey}`;
  const load = useCallback(() => fetchUsageReport(days, start && end ? { start, end, fromTime, toTime } : undefined, sourceKey ? sourceKey.split(',') : []), [days, start, end, fromTime, toTime, sourceKey]);
  const state = useCachedRangeQuery(cacheKey, key, load, enabled && isCliBackend(), snapshot);
  return { report: state.data, error: state.error, loading: state.loading };
}
