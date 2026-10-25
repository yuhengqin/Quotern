import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { RangeQueryCache } from '@/lib/range-query-cache';
import { DATA_SYNCED_EVENT } from '@/lib/shell-events';
import { subscribeAutomaticRefresh } from '@/lib/dashboard-refresh';
import { isDemoMode } from '../lib/demo-runtime';

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
    // Frozen demos have no visibility/poll retry, so even a background tab must load once.
    if (isDemoMode()) void cache.refresh(cacheKey, token, load);
    else refresh();
    const stopAutomatic = subscribeAutomaticRefresh(refresh, { readOnly: isDemoMode(), onFocus: revalidate });
    window.addEventListener(DATA_SYNCED_EVENT, revalidate);
    return () => {
      stopAutomatic();
      window.removeEventListener(DATA_SYNCED_EVENT, revalidate);
    };
  }, [cache, cacheKey, token, load, enabled]);

  return state;
}
