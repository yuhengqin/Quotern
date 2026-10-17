import { useEffect, useMemo, useState } from 'react';
import type { UsageReport } from 'quotern-core';
import { fetchUsageReport, isCliBackend } from '@/lib/api';
import type { DashboardDateRange } from '@/lib/dashboard-date-range';
import { DATA_SYNCED_EVENT } from '@/lib/shell-events';

export function useCostExplanation(days: number, selectedDate: string | null, dateRange: DashboardDateRange | null, sources: readonly string[], enabled: boolean, snapshot: object) {
  const start = selectedDate ?? dateRange?.start;
  const end = selectedDate ?? dateRange?.end;
  const sourceKey = [...sources].sort().join(',');
  const key = `${days}|${start ?? ''}|${end ?? ''}|${sourceKey}`;
  const context = useMemo(() => ({ key }), [key]);
  const [state, setState] = useState<{ context: object | null; report: UsageReport | null; error: boolean }>({ context: null, report: null, error: false });
  useEffect(() => {
    if (!enabled || !isCliBackend()) return;
    let cancelled = false, pending = false;
    const refresh = async () => {
      if (pending || cancelled || document.visibilityState === 'hidden') return;
      pending = true;
      setState((current) => ({ context, report: current.context === context ? current.report : null, error: false }));
      try {
        const report = await fetchUsageReport(days, start && end ? { start, end } : undefined, sourceKey ? sourceKey.split(',') : []);
        if (!cancelled) setState({ context, report, error: false });
      } catch {
        if (!cancelled) setState((current) => ({ context, report: current.context === context ? current.report : null, error: true }));
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
  }, [days, start, end, sourceKey, context, enabled, snapshot]);
  const current = enabled && state.context === context;
  return { report: current ? state.report : null, error: current && state.error, loading: !current || (!state.report && !state.error) };
}
