import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { RangeQueryCache } from '@/lib/range-query-cache';
import { DATA_SYNCED_EVENT } from '@/lib/shell-events';
import { DASHBOARD_POLL_MS } from '@/lib/dashboard-refresh';

/** Cache display scopes separately from exact request identities (e.g. rolling 1D). */
export function useCachedRangeQuery<T>(cacheKey: string, requestKey: string, load: () => Promise<T>, enabled: boolean, snapshot?: object) {
  const [cache] = useState(() => new RangeQueryCache<T>());
  const token = useMemo(() => ({ requestKey, snapshot }), [requestKey, snapshot]);
  const getSnapshot = useCallback(() => cache.getSnapshot(cacheKey), [cache, cacheKey]);
  const state = useSyncExternalStore(cache.subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (!document.hidden) void cache.refresh(cacheKey, token, load);
    };
    const revalidate = () => {
      if (!document.hidden) void cache.refresh(cacheKey, token, load, true);
    };
    refresh();
    const timer = window.setInterval(refresh, DASHBOARD_POLL_MS);
    window.addEventListener(DATA_SYNCED_EVENT, revalidate);
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(DATA_SYNCED_EVENT, revalidate);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [cache, cacheKey, token, load, enabled]);

  return state;
}
