import { useEffect, useRef, useState } from 'react';
import type { UsageReport } from 'quotern-core';
import { fetchUsageReport, isCliBackend } from '@/lib/api';
import type { ShareFilters } from '../lib/share-snapshot';

/** A share session freezes each filter scope; all exported figures come from one report. */
export function useShareReport(filters: ShareFilters, enabled: boolean) {
  const start = filters.selectedDate ?? filters.dateRange?.start;
  const end = filters.selectedDate ?? filters.dateRange?.end;
  const fromTime = filters.selectedDate ? undefined : filters.dateRange?.fromTime;
  const toTime = filters.selectedDate ? undefined : filters.dateRange?.toTime;
  const sources = [...filters.selectedSources].sort().join(',');
  const days = filters.rangeDays;
  const key = JSON.stringify([days, start, end, fromTime, toTime, sources]);
  const cache = useRef(new Map<string, UsageReport>());
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; loading: boolean; failed: boolean; report: UsageReport | null }>({ key: '', loading: false, failed: false, report: null });
  const available = enabled && isCliBackend();
  useEffect(() => {
    if (!available) return;
    const cached = cache.current.get(key);
    if (cached) { setState({ key, loading: false, failed: false, report: cached }); return; }
    let cancelled = false;
    setState({ key, loading: true, failed: false, report: null });
    void fetchUsageReport(days, start && end ? { start, end, fromTime, toTime } : undefined, sources ? sources.split(',') : []).then(report => {
      if (cancelled) return;
      cache.current.set(key, report);
      setState({ key, loading: false, failed: false, report });
    }).catch(() => { if (!cancelled) setState({ key, loading: false, failed: true, report: null }); });
    return () => { cancelled = true; };
  }, [available, key, days, start, end, fromTime, toTime, sources, revision]);
  return {
    report: available && state.key === key ? state.report : null,
    loading: available && (state.key !== key || state.loading),
    failed: available && state.key === key && state.failed,
    retry: () => setRevision((current) => current + 1),
  };
}
