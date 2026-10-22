import { useCallback } from 'react';
import { isDemoMode } from '../lib/demo-runtime';
import type { SessionActivitySnapshot } from 'quotern-core';
import { isCliBackend, request } from '@/lib/api';
import { appendDashboardRangeQuery, type DashboardDateRange } from '@/lib/dashboard-date-range';
import { dashboardRangeScopeKey } from '@/lib/dashboard-range-scope';
import { useCachedRangeQuery } from './useCachedRangeQuery';

export function useSessionActivity(days: number, selectedDate: string | null, dateRange: DashboardDateRange | null, sources: readonly string[], enabled: boolean, target?: { source: string; sessionId: string }, preview = false) {
  const start = selectedDate ?? dateRange?.start, end = selectedDate ?? dateRange?.end;
  const fromTime = selectedDate ? undefined : dateRange?.fromTime, toTime = selectedDate ? undefined : dateRange?.toTime;
  const sourceKey = [...sources].sort().join(',');
  const targetSource = target?.source, targetId = target?.sessionId;
  const usePreview = preview && isDemoMode() && !target;
  const targetKey = JSON.stringify([targetSource, targetId, usePreview]);
  const key = `${days}|${start ?? ''}|${end ?? ''}|${fromTime ?? ''}|${toTime ?? ''}|${sourceKey}|${targetKey}`;
  const scopeKey = `${dashboardRangeScopeKey(days, start && end ? { start, end, fromTime, toTime } : null)}|${sourceKey}|${targetKey}`;
  const load = useCallback(() => {
    const query = new URLSearchParams({ days: String(days) });
    if (start && end) appendDashboardRangeQuery(query, { start, end, fromTime, toTime });
    if (sourceKey) query.set('sources', sourceKey);
    if (usePreview) query.set('preview', '6');
    if (targetSource && targetId) { query.set('sessionSource', targetSource); query.set('sessionId', targetId); }
    return request<SessionActivitySnapshot>(`/functions/tud-session-activity?${query}`, { signal: AbortSignal.timeout(30_000) });
  }, [days, start, end, fromTime, toTime, sourceKey, targetSource, targetId, usePreview]);
  const state = useCachedRangeQuery(scopeKey, key, load, enabled && isCliBackend());
  return { ...state, scopeKey };
}
