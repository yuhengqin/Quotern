import { useCallback } from 'react';
import type { TrendGranularity, UsageTrend } from 'quotern-core';
import { request } from '@/lib/api';
import { appendDashboardRangeQuery, type DashboardDateRange } from '@/lib/dashboard-date-range';
import { dashboardRangeScopeKey } from '@/lib/dashboard-range-scope';
import { useCachedRangeQuery } from './useCachedRangeQuery';

export function useUsageTrend(days: number, selectedDate: string | null, dateRange: DashboardDateRange | null, sources: readonly string[], granularity: TrendGranularity, enabled: boolean) {
  const start = selectedDate ?? dateRange?.start, end = selectedDate ?? dateRange?.end;
  const fromTime = selectedDate ? undefined : dateRange?.fromTime, toTime = selectedDate ? undefined : dateRange?.toTime;
  const sourceKey = [...sources].sort().join(',');
  const key = `${days}|${start ?? ''}|${end ?? ''}|${fromTime ?? ''}|${toTime ?? ''}|${sourceKey}|${granularity}`;
  const scopeKey = `${dashboardRangeScopeKey(days, start && end ? { start, end, fromTime, toTime } : null)}|${sourceKey}|${granularity}`;
  const load = useCallback(() => {
    const params = new URLSearchParams({ granularity });
    if (start && end) appendDashboardRangeQuery(params, { start, end, fromTime, toTime }); else params.set('days', String(days));
    if (sourceKey) params.set('sources', sourceKey);
    return request<UsageTrend>(`/functions/tud-usage-trend?${params}`, { signal: AbortSignal.timeout(30_000) });
  }, [days, start, end, fromTime, toTime, sourceKey, granularity]);
  return useCachedRangeQuery(scopeKey, key, load, enabled);
}
