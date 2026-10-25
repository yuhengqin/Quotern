import { useCallback, useEffect, useState } from 'react';
import type { SessionActivitySnapshot, SessionListPage } from 'quotern-core';
import { request } from '@/lib/api';
import { useCachedRangeQuery } from '@/hooks/useCachedRangeQuery';
import type { DashboardDateRange } from '../lib/dashboard-date-range';
import { sessionListQuery } from '../lib/session-list-query';
import { sessionActivityQuery } from '../lib/session-activity-query';
import { isMissingSessionEndpoint } from '../lib/session-detail-cache';
import { sessionPageRows, type SessionPageSearch } from '../lib/session-page';
import { filterSessionActivity, sortSessionActivity } from '../lib/session-activity';
import { sessionCsv } from '../lib/session-insights';

export function useSessionList(search: SessionPageSearch, range: DashboardDateRange | null, enabled: boolean) {
  const query = sessionListQuery(search, range);
  const fallbackQuery = sessionActivityQuery(search.days, range, [...search.scopeSources].sort().join(','));
  const load = useCallback(async (): Promise<SessionActivitySnapshot | SessionListPage> => {
    try { return await request<SessionListPage>(query, { signal: AbortSignal.timeout(30_000) }); }
    catch (error) {
      if (!isMissingSessionEndpoint(error)) throw error;
      return request<SessionActivitySnapshot>(fallbackQuery, { signal: AbortSignal.timeout(30_000) });
    }
  }, [query, fallbackQuery]);
  const [retryToken, setRetryToken] = useState(0);
  const state = useCachedRangeQuery(query, `${query}|retry:${retryToken}`, load, enabled);
  const [previous, setPrevious] = useState<SessionActivitySnapshot | SessionListPage | null>(null);
  useEffect(() => { if (state.data) setPrevious(state.data); }, [state.data]);
  const data = state.data ?? previous;
  const exportCsv = async () => {
    try {
      return (await request<{ csv: string }>(sessionListQuery(search, range, true), { signal: AbortSignal.timeout(30_000) })).csv;
    } catch (error) {
      if (!isMissingSessionEndpoint(error)) throw error;
      const snapshot = state.data && !('pagination' in state.data) ? state.data : await request<SessionActivitySnapshot>(fallbackQuery, { signal: AbortSignal.timeout(30_000) });
      const rows = filterSessionActivity(sessionPageRows(snapshot, search.group), search.q, search.sources, search.project)
        .filter(row => !search.model || row.model === search.model || row.models?.some(model => model.model === search.model));
      return sessionCsv(sortSessionActivity(rows, search.sort, search.direction));
    }
  };
  return { data, currentData: state.data, error: state.error, loading: state.loading, exportCsv, retry: () => setRetryToken(value => value + 1) };
}
