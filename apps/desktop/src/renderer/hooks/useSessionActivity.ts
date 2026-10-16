import { useEffect, useState } from 'react';
import type { SessionActivitySnapshot } from 'quotern-core';
import { isCliBackend, request } from '@/lib/api';
import type { DashboardDateRange } from '@/lib/dashboard-date-range';
import { DATA_SYNCED_EVENT } from '@/lib/shell-events';

export function useSessionActivity(days: number, selectedDate: string | null, dateRange: DashboardDateRange | null, sources: readonly string[], enabled: boolean) {
  const start = selectedDate ?? dateRange?.start, end = selectedDate ?? dateRange?.end;
  const sourceKey = [...sources].sort().join(',');
  const key = `${days}|${start ?? ''}|${end ?? ''}|${sourceKey}`;
  const [state, setState] = useState<{ key: string; data: SessionActivitySnapshot | null; error: string | null }>({ key: '', data: null, error: null });
  useEffect(() => {
    if (!enabled || !isCliBackend()) return;
    let cancelled = false, pending = false;
    const controller = new AbortController();
    const load = async () => {
      if (cancelled || pending || document.hidden) return;
      pending = true;
      const query = new URLSearchParams({ days: String(days) });
      if (start && end) { query.set('fromDate', start); query.set('toDate', end); }
      if (sourceKey) query.set('sources', sourceKey);
      try {
        const data = await request<SessionActivitySnapshot>(`/functions/tud-session-activity?${query}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
        if (!cancelled) setState({ key, data, error: null });
      } catch {
        if (!cancelled) setState(previous => ({ key, data: previous.key === key ? previous.data : null, error: '会话读数暂未更新，请确认本地服务正在运行' }));
      } finally { pending = false; }
    };
    const refresh = () => { void load(); };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener(DATA_SYNCED_EVENT, refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer); window.removeEventListener(DATA_SYNCED_EVENT, refresh); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [days, start, end, sourceKey, key, enabled]);
  return state.key === key ? state : { data: null, error: null };
}
