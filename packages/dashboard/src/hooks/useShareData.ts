import { useEffect, useRef, useState } from 'react';
import { ensureLocalRange, fetchUsageDataset, isCliBackend } from '@/lib/api';
import { buildDashboardDataFromDataset } from '@/lib/dashboard-data';
import { resolveDashboardFetchDays } from '@/lib/dashboard-fetch-days';
import { buildShareDataFromDataset, type ShareDashboardData } from '../lib/share-snapshot';
import type { ShareSnapshot } from './ShareSnapshotContext';

/** Fetch only for the share session; no dashboard state writes or extra polling. */
export function useShareData(initial: ShareSnapshot | null, rangeDays: number, selectedDate: string | null) {
  const key = `${rangeDays}:${selectedDate ?? ''}`;
  const cache = useRef(new Map<string, ShareDashboardData>());
  const ensuredDays = useRef(initial && !initial.loading && !initial.error ? initial.filters.rangeDays : 0);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState(() => {
    // A newly selected heatmap day may still need expanded hourly history.
    if (initial && !initial.loading && !initial.error && !initial.filters.selectedDate) {
      cache.current.set(`${initial.filters.rangeDays}:${initial.filters.selectedDate ?? ''}`, initial.data);
    }
    return { key, data: cache.current.get(key) ?? null, loading: !cache.current.has(key), error: null as string | null };
  });

  useEffect(() => {
    let cancelled = false;
    const cached = cache.current.get(key);
    if (cached) {
      setState({ key, data: cached, loading: false, error: null });
      return;
    }
    setState({ key, data: null, loading: true, error: null });
    void (async () => {
      try {
        if (isCliBackend() && rangeDays > ensuredDays.current) {
          await ensureLocalRange(rangeDays);
          if (cancelled) return;
          ensuredDays.current = Math.max(ensuredDays.current, rangeDays);
        }
        const dataset = await fetchUsageDataset(resolveDashboardFetchDays(rangeDays, selectedDate));
        if (cancelled) return;
        const data = buildShareDataFromDataset(dataset, rangeDays, buildDashboardDataFromDataset);
        cache.current.set(key, data);
        setState({ key, data, loading: false, error: null });
      } catch (error) {
        if (cancelled) return;
        setState({ key, data: null, loading: false, error: error instanceof Error ? error.message : '数据加载失败' });
      }
    })();
    return () => { cancelled = true; };
  }, [key, rangeDays, selectedDate, revision]);

  // A new selection must never expose the previous request's data, even before effects run.
  const cached = cache.current.get(key);
  const matches = state.key === key;
  return {
    data: cached ?? (matches ? state.data : null),
    loading: !cached && (!matches || state.loading),
    error: matches ? state.error : null,
    retry: () => setRevision((current) => current + 1),
  };
}
