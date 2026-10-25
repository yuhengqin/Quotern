import { useCallback } from 'react';
import { isDemoMode } from '../lib/demo-runtime';
import type { SessionActivitySnapshot } from 'quotern-core';
import { isCliBackend, request } from '@/lib/api';
import type { DashboardDateRange } from '@/lib/dashboard-date-range';
import { sessionActivityQuery } from '../lib/session-activity-query';
import { dashboardRangeScopeKey } from '@/lib/dashboard-range-scope';
import { useCachedRangeQuery } from './useCachedRangeQuery';

export function useSessionActivity(days: number, selectedDate: string | null, dateRange: DashboardDateRange | null, sources: readonly string[], enabled: boolean, target?: { source: string; sessionId: string; period?: 'selected' }, preview = false) {
  const start = selectedDate ?? dateRange?.start, end = selectedDate ?? dateRange?.end;
  const fromTime = selectedDate ? undefined : dateRange?.fromTime, toTime = selectedDate ? undefined : dateRange?.toTime;
  const sourceKey = [...sources].sort().join(',');
  const targetSource = target?.source, targetId = target?.sessionId, targetPeriod = target?.period;
  const usePreview = preview && isDemoMode() && !target;
  const targetKey = JSON.stringify([targetSource, targetId, targetPeriod, usePreview]);
  const key = `${days}|${start ?? ''}|${end ?? ''}|${fromTime ?? ''}|${toTime ?? ''}|${sourceKey}|${targetKey}`;
  const scopeKey = `${dashboardRangeScopeKey(days, start && end ? { start, end, fromTime, toTime } : null)}|${sourceKey}|${targetKey}`;
  const load = useCallback(() => {
    const query = sessionActivityQuery(days, start && end ? { start, end, fromTime, toTime } : null, sourceKey, targetSource && targetId ? { source: targetSource, sessionId: targetId, period: targetPeriod } : undefined, usePreview);
    return request<SessionActivitySnapshot>(query, { signal: AbortSignal.timeout(30_000) });
  }, [days, start, end, fromTime, toTime, sourceKey, targetSource, targetId, targetPeriod, usePreview]);
  const state = useCachedRangeQuery(scopeKey, key, load, enabled && isCliBackend());
  return { ...state, scopeKey };
}
