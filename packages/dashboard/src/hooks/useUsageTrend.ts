import { useEffect, useState } from 'react';
import type { TrendGranularity, UsageTrend } from 'quotern-core';
import { request } from '@/lib/api';
import type { DashboardDateRange } from '@/lib/dashboard-date-range';
import { DATA_SYNCED_EVENT } from '@/lib/shell-events';

export function useUsageTrend(days: number, selectedDate: string | null, dateRange: DashboardDateRange | null, sources: readonly string[], granularity: TrendGranularity, enabled: boolean) {
  const start = selectedDate ?? dateRange?.start, end = selectedDate ?? dateRange?.end;
  const sourceKey = [...sources].sort().join(',');
  const key = `${days}|${start ?? ''}|${end ?? ''}|${sourceKey}|${granularity}`;
  const [state, setState] = useState<{ key: string; data: UsageTrend | null; error: boolean }>({ key: '', data: null, error: false });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false, pending = false, queued = false;
    const controller = new AbortController();
    const load = async () => {
      if (cancelled || document.hidden) return;
      if (pending) { queued = true; return; }
      pending = true;
      const params = new URLSearchParams({ granularity });
      if (start && end) { params.set('fromDate', start); params.set('toDate', end); } else params.set('days', String(days));
      if (sourceKey) params.set('sources', sourceKey);
      try {
        const data = await request<UsageTrend>(`/functions/tud-usage-trend?${params}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
        if (!cancelled) setState({ key, data, error: false });
      } catch { if (!cancelled) setState(previous => ({ key, data: previous.key === key ? previous.data : null, error: true })); }
      finally { pending = false; if (queued && !cancelled) { queued = false; void load(); } }
    };
    const refresh = () => { void load(); };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener(DATA_SYNCED_EVENT, refresh); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer); window.removeEventListener(DATA_SYNCED_EVENT, refresh); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [key, days, start, end, sourceKey, granularity, enabled]);
  return state.key === key ? state : { data: null, error: false };
}
