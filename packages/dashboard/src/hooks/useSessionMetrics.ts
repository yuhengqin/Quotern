import { useEffect, useState } from 'react';
import type { SessionMetrics } from 'quotern-core';
import { fetchSessionMetrics, isCliBackend } from '@/lib/api';
import type { DashboardDateRange } from '@/lib/dashboard-date-range';
import { DATA_SYNCED_EVENT } from '@/lib/shell-events';

/** Session metadata has its own refresh path: it can change without tokens. */
export function useSessionMetrics(days: number, selectedDate: string | null, dateRange: DashboardDateRange | null, sources: readonly string[], enabled: boolean) {
  const start = selectedDate ?? dateRange?.start;
  const end = selectedDate ?? dateRange?.end;
  const sourceKey = [...sources].sort().join(',');
  const key = `${days}|${start ?? ''}|${end ?? ''}|${sourceKey}`;
  const [state, setState] = useState<{ key: string; metrics: SessionMetrics | null }>({ key: '', metrics: null });
  useEffect(() => {
    if (!enabled || !isCliBackend()) return;
    let cancelled = false, pending = false;
    const refresh = async () => {
      if (pending || cancelled || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const metrics = await fetchSessionMetrics(days, start && end ? { start, end } : undefined, sourceKey ? sourceKey.split(',') : []);
        if (!cancelled) setState({ key, metrics });
      } catch {
        if (!cancelled) setState({ key, metrics: null });
      } finally { pending = false; }
    };
    void refresh();
    const onRefresh = () => { void refresh(); };
    const timer = window.setInterval(onRefresh, 10_000);
    window.addEventListener(DATA_SYNCED_EVENT, onRefresh);
    window.addEventListener('focus', onRefresh);
    document.addEventListener('visibilitychange', onRefresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(DATA_SYNCED_EVENT, onRefresh);
      window.removeEventListener('focus', onRefresh);
      document.removeEventListener('visibilitychange', onRefresh);
    };
  }, [days, start, end, sourceKey, key, enabled]);
  return state.key === key ? state.metrics : null;
}
