import { dashboardNow, isDemoMode } from '../lib/demo-runtime.ts';
import { dashboardRangeCacheKey, dashboardRangeKey, dateRangeLookback, type DashboardDateRange } from '@/lib/dashboard-date-range';
import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import {
  ensureLocalRange,
  fetchUsageDataset,
  fetchUsageDatasetThin,
  isCliBackend,
  type UsageDataset,
} from '@/lib/api';
import {
  buildDashboardDataFromDataset,
  withClippedTodayHourly,
} from '@/lib/dashboard-data';
import { resolveDashboardFetchDays } from '@/lib/dashboard-fetch-days';
import {
  dashboardMockData,
  emptyDashboardData,
  type DashboardMockData,
} from '@/lib/dashboard-mock-data';
import { isMockDataEnabled } from '@/lib/env';
import { fingerprintUsageDataset } from '@/lib/usage-dataset-fingerprint';
import { rememberRangeValue } from '@/lib/range-query-cache';
import { subscribeAutomaticRefresh } from '@/lib/dashboard-refresh';

export type DashboardDataSource = 'api' | 'sample';

interface DashboardDataState {
  data: DashboardMockData;
  source: DashboardDataSource;
  loading: boolean;
  refreshing: boolean;
  /** Local ensure+resync for an expanded today/7D/30D/90D window. */
  syncingRange: boolean;
  error: string | null;
}

interface RangeCacheEntry {
  fingerprint: string | null;
  data: DashboardMockData;
  source: DashboardDataSource;
  error: string | null;
}

export { resolveDashboardFetchDays } from '@/lib/dashboard-fetch-days';

/**
 * Load the same usage snapshot as the root page.
 *
 * Reload/poll with an unchanged fingerprint keeps the previous `data`
 * reference so Recharts / heatmap do not rebuild.
 */
export function useDashboardData(
  rangeDays: number,
  selectedDate?: string | null,
  dateRange?: DashboardDateRange | null,
) {
  const rangeKey = dashboardRangeKey(rangeDays, dateRange);
  const cacheKey = dashboardRangeCacheKey(rangeDays, dateRange);
  const scopeKey = `${cacheKey}|${rangeKey}`;
  const collectDays = dateRange ? Math.min(365, dateRangeLookback(dateRange) + rangeDays) : rangeDays;
  const mockEnabled = isMockDataEnabled();
  const cliBackend = isCliBackend();
  const [revision, setRevision] = useState(0);
  const ensuredMaxDaysRef = useRef(0);
  const lastFetchedRangeKeyRef = useRef<string | null>(null);
  const lastRequestedScopeRef = useRef<string | null>(null);
  const lastRevisionRef = useRef<number | null>(null);
  const datasetCacheRef = useRef<UsageDataset | null>(null);
  const cachedDailyDaysRef = useRef(0);
  const cachedHourlyDaysRef = useRef(0);
  const rangeFetchInFlightRef = useRef(false);
  const lastFingerprintRef = useRef<string | null>(null);
  const rangeCacheRef = useRef(new Map<string, RangeCacheEntry>());
  const dataRef = useRef<DashboardMockData>(
    mockEnabled ? withClippedTodayHourly(dashboardMockData) : emptyDashboardData,
  );
  const [state, setState] = useState<DashboardDataState>(() => ({
    data: mockEnabled
      ? withClippedTodayHourly(dashboardMockData)
      : emptyDashboardData,
    source: mockEnabled ? 'sample' : 'api',
    loading: true,
    refreshing: false,
    syncingRange: false,
    error: null,
  }));

  const reload = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchDays = resolveDashboardFetchDays(rangeDays, selectedDate, dashboardNow(), dateRange);

    const needsEnsure = cliBackend && collectDays > ensuredMaxDaysRef.current;
    const isEmpty = (data: DashboardMockData) => data === emptyDashboardData;
    const isRangeDrivenRefresh =
      lastFetchedRangeKeyRef.current != null &&
      lastFetchedRangeKeyRef.current !== rangeKey;
    const revisionChanged = lastRevisionRef.current !== revision;
    lastRevisionRef.current = revision;
    const scopeChanged = lastRequestedScopeRef.current !== scopeKey;
    lastRequestedScopeRef.current = scopeKey;
    const hourlyAlreadyCovered =
      datasetCacheRef.current != null &&
      lastFetchedRangeKeyRef.current === rangeKey &&
      cachedHourlyDaysRef.current >= fetchDays.hourlyDays &&
      !needsEnsure;
    if (!revisionChanged && hourlyAlreadyCovered && !scopeChanged) {
      return () => {
        cancelled = true;
      };
    }
    const isHourlyExpansion =
      lastFetchedRangeKeyRef.current === rangeKey &&
      datasetCacheRef.current != null &&
      cachedDailyDaysRef.current >= fetchDays.dailyDays &&
      cachedHourlyDaysRef.current < fetchDays.hourlyDays &&
      !needsEnsure;
    const cachedEntry = rangeCacheRef.current.get(cacheKey);

    rangeFetchInFlightRef.current = true;

    if (cachedEntry && (isRangeDrivenRefresh || scopeChanged)) {
      lastFingerprintRef.current = cachedEntry.fingerprint;
      dataRef.current = cachedEntry.data;
      setState({ ...cachedEntry, loading: false, refreshing: false, syncingRange: false });
    } else setState((current) => {
      if (isEmpty(current.data)) {
        return {
          ...current,
          loading: true,
          refreshing: false,
          syncingRange: false,
          error: null,
        };
      }
      if (isRangeDrivenRefresh) {
        return {
          ...current,
          loading: false,
          refreshing: true,
          syncingRange: false,
          error: null,
        };
      }
      return current;
    });

    const applyResult = (next: DashboardDataState) => {
      startTransition(() => {
        if (cancelled) return;
        if (!next.error || next.error === '当前时间范围暂无用量记录') {
          rememberRangeValue(rangeCacheRef.current, cacheKey, { fingerprint: lastFingerprintRef.current, data: next.data, source: next.source, error: next.error });
        }
        lastFetchedRangeKeyRef.current = rangeKey;
        rangeFetchInFlightRef.current = false;
        dataRef.current = next.data;
        setState(next);
      });
    };

    const run = async () => {
      try {
        if (needsEnsure) {
          await ensureLocalRange(collectDays, Boolean(dateRange));
          if (cancelled) return;
          ensuredMaxDaysRef.current = Math.max(
            ensuredMaxDaysRef.current,
            collectDays,
          );
          datasetCacheRef.current = null;
          cachedDailyDaysRef.current = 0;
          cachedHourlyDaysRef.current = 0;
          lastFingerprintRef.current = null;
        }

        const canReuseDaily =
          !dateRange &&
          lastFetchedRangeKeyRef.current?.startsWith('last:') &&
          datasetCacheRef.current != null &&
          cachedDailyDaysRef.current >= fetchDays.dailyDays &&
          !needsEnsure &&
          (isRangeDrivenRefresh || isHourlyExpansion);

        const dataset = canReuseDaily
          ? await fetchUsageDatasetThin(
              datasetCacheRef.current!,
              fetchDays.breakdownDays,
              fetchDays.hourlyDays,
            )
          : await fetchUsageDataset(fetchDays);
        if (cancelled || !dataset) return;

        datasetCacheRef.current = dataset;
        cachedHourlyDaysRef.current = fetchDays.hourlyDays;
        if (!canReuseDaily) {
          cachedDailyDaysRef.current = fetchDays.dailyDays;
        }

        const hasUsageRows = dataset.dailyRows.length > 0;
        if (hasUsageRows) {
          const fingerprint = fingerprintUsageDataset(dataset, rangeDays, dateRange);
          const prior = dataRef.current;
          if (
            fingerprint === lastFingerprintRef.current &&
            prior !== emptyDashboardData
          ) {
            rememberRangeValue(rangeCacheRef.current, cacheKey, { fingerprint, data: prior, source: 'api', error: null });
            startTransition(() => {
              if (cancelled) return;
              lastFetchedRangeKeyRef.current = rangeKey;
              rangeFetchInFlightRef.current = false;
              setState((current) => {
                if (
                  !current.loading &&
                  !current.refreshing &&
                  !current.syncingRange &&
                  current.data === prior &&
                  current.error == null
                ) {
                  return current;
                }
                return {
                  data: prior,
                  source: 'api',
                  loading: false,
                  refreshing: false,
                  syncingRange: false,
                  error: null,
                };
              });
            });
            return;
          }
          lastFingerprintRef.current = fingerprint;
          applyResult({
            data: buildDashboardDataFromDataset(dataset, rangeDays, dateRange),
            source: 'api',
            loading: false,
            refreshing: false,
            syncingRange: false,
            error: null,
          });
          return;
        }

        const emptyMessage = '当前时间范围暂无用量记录';
        lastFingerprintRef.current = `empty|${rangeKey}`;
        if (mockEnabled) {
          applyResult({
            data: withClippedTodayHourly(dashboardMockData),
            source: 'sample',
            loading: false,
            refreshing: false,
            syncingRange: false,
            error: emptyMessage,
          });
          return;
        }

        applyResult({
          data: emptyDashboardData,
          source: 'api',
          loading: false,
          refreshing: false,
          syncingRange: false,
          error: emptyMessage,
        });
      } catch (error: unknown) {
        if (cancelled) return;
        rangeFetchInFlightRef.current = false;
        const message =
          error instanceof Error ? error.message : '数据加载失败';
        if (cachedEntry) {
          applyResult({ ...cachedEntry, loading: false, refreshing: false, syncingRange: false, error: message });
          return;
        }
        lastFingerprintRef.current = null;
        if (mockEnabled) {
          applyResult({
            data: withClippedTodayHourly(dashboardMockData),
            source: 'sample',
            loading: false,
            refreshing: false,
            syncingRange: false,
            error: message,
          });
          return;
        }

        applyResult({
          data: emptyDashboardData,
          source: 'api',
          loading: false,
          refreshing: false,
          syncingRange: false,
          error: message,
        });
      }
    };

    void run();

    return () => {
      cancelled = true;
      rangeFetchInFlightRef.current = false;
    };
  }, [rangeKey, cacheKey, scopeKey, rangeDays, selectedDate, dateRange, collectDays, revision, mockEnabled, cliBackend]);

  useEffect(() => {
    if (!isCliBackend()) return;

    const poll = () => {
      if (document.visibilityState === 'hidden') return;
      if (rangeFetchInFlightRef.current) return;
      reload();
    };
    return subscribeAutomaticRefresh(poll, { readOnly: isDemoMode() });
  }, [reload]);

  const rangeChanged = lastFetchedRangeKeyRef.current !== null && lastFetchedRangeKeyRef.current !== rangeKey;
  const cachedView = rangeCacheRef.current.get(cacheKey);
  return {
    ...state,
    ...(cachedView ? { data: cachedView.data, source: cachedView.source, error: lastRequestedScopeRef.current === scopeKey ? state.error : cachedView.error, loading: false } : {}),
    refreshing: cachedView ? false : state.refreshing || rangeChanged,
    reload,
  };
}
