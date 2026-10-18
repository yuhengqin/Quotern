import { useCallback, useEffect, useMemo, useState } from 'react';
import { Xmark } from '@gravity-ui/icons';
import { Button, Chip } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import type { SupportedLocale } from 'quotern-i18n';
import {
  DASHBOARD_RANGE_DAYS,
  DashboardFilter,
  type DashboardRange,
} from '@/components/DashboardFilter';
import { DashboardLoadingSkeleton } from '@/components/DashboardLoadingSkeleton';
import { DashboardOverviewCard } from '@/components/DashboardOverviewCard';
import { SessionActivityPanel } from '@/components/SessionActivityPanel';
import { DashboardRangeSyncOverlay } from '@/components/DashboardRangeSyncOverlay';
import { UsageTrendExplorer } from '@/components/UsageTrendExplorer';
// 分时热力图：暂时注释，保留组件便于以后恢复
// import { HourlyActivityHeatmap } from '@/components/HourlyActivityHeatmap';
import { StatusBanner } from '@/components/StatusBanner';
import { ProjectUsagePanel } from '@/components/ProjectUsagePanel';
import { ToolModelUsagePanel } from '@/components/ToolModelUsagePanel';
import { UsageDistributionCard } from '@/components/UsageDistributionCard';
import { SubscriptionUsageGrid } from '@/components/SubscriptionUsageGrid';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useRollingDayRange } from '@/hooks/useRollingDayRange';
import { useCostExplanation } from '@/hooks/useCostExplanation';
import { useSessionMetrics } from '@/hooks/useSessionMetrics';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { projectDashboardForDate } from '@/lib/dashboard-data';
import { scheduleAfterPaint } from '@/lib/schedule-after-paint';
import { DATA_SYNCED_EVENT } from '@/lib/shell-events';
import { getDashboardReturnState, rememberDashboardScroll, useDashboardReturnState } from '../../../../../packages/dashboard/src/lib/dashboard-return-state';
import { localDateNow } from '@/lib/stats-timezone';
import { dateRangeDays, formatDashboardDateRange, isDashboardDateRange, type DashboardDateRange } from '@/lib/dashboard-date-range';
import { sourceLabel } from '@/lib/tokens';
import { usageErrorDescription, usageErrorTitle } from '@/lib/usage-error';
import { useShareSnapshot } from '../../../../../packages/dashboard/src/hooks/ShareSnapshotContext';
import {
  buildVisibleMetricTrends,
  buildToolModelDistributions,
  filterHeatmapDaysBySources,
  filterModelRowsBySources,
  filterProjectRowsBySources,
  filterTrendRowsBySources,
  summarizeTrendRows,
} from '@/lib/usage-filter';
import { isCliBackend, LOCAL_RUNTIME_RECOVERING_HINT } from '@/lib/api';
import {
  DEFAULT_DASHBOARD_RANGE,
  isDashboardRange,
} from '../../shared/dashboard-range';

/**
 * Tabs `range` updates immediately; data fetch waits until after paint so
 * selected background + label colors can commit without contending with I/O.
 */
function useDeferredDashboardRange(range: DashboardRange): DashboardRange {
  const [dataRange, setDataRange] = useState(range);

  useEffect(() => {
    if (dataRange === range) return;
    return scheduleAfterPaint(() => {
      setDataRange(range);
    });
  }, [range, dataRange]);

  return dataRange;
}

/** HeroUI dashboard backed by the same usage dataset as the root route. */
export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  const [range, setRange] = useLocalStorage<DashboardRange>(
    'tud.dashboardRange',
    DEFAULT_DASHBOARD_RANGE,
    isDashboardRange,
  );
  useEffect(() => {
    void window.tud.setDashboardRange(range);
  }, [range]);
  const [selectedDate, setSelectedDate] = useState<string | null>(() => getDashboardReturnState()?.selectedDate ?? null);
  const [customRange, setCustomRange] = useLocalStorage<DashboardDateRange | null>(
    'tud.dashboardCustomRange', null,
    (value): value is DashboardDateRange | null => value === null || isDashboardDateRange(value),
  );
  const [selectedTools, setSelectedTools] = useState<string[]>(() => getDashboardReturnState()?.selectedTools ?? []);

  useEffect(
    () =>
      window.tud.onDashboardRange((nextRange) => {
        setCustomRange(null);
        setSelectedDate(null);
        setRange(nextRange);
      }),
    [setRange, setCustomRange],
  );
  const { publishSnapshot } = useShareSnapshot();
  const dataRange = useDeferredDashboardRange(range);
  const rangeDays = customRange ? dateRangeDays(customRange) : DASHBOARD_RANGE_DAYS[dataRange];
  const rollingRange = useRollingDayRange(!customRange && dataRange === 'last-24-hours');
  const queryRange = rollingRange ?? customRange;
  const { data, error, loading, refreshing, reload } =
    useDashboardData(rangeDays, selectedDate, queryRange);
  useDashboardReturnState(selectedDate, selectedTools, loading);
  const { metrics: sessionMetrics, loading: sessionMetricsLoading, error: sessionMetricsError } = useSessionMetrics(rangeDays, selectedDate, queryRange, selectedTools, !loading && !refreshing);
  const costExplanation = useCostExplanation(rangeDays, selectedDate, queryRange, selectedTools, !loading && !refreshing && range === dataRange, data);
  const view = useMemo(
    () => (selectedDate ? projectDashboardForDate(data, selectedDate) : data),
    [data, selectedDate],
  );
  const dayScoped = selectedDate != null || Boolean(customRange && rangeDays === 1 && customRange.end !== localDateNow());
  const isHourly = dayScoped || rangeDays === 1;
  const shareRangeLabel = selectedDate
    ? formatFilterDayLabel(selectedDate, locale)
    : customRange ? formatDashboardDateRange(customRange)
      : range === 'today' ? t('usage.range.today')
        : range === 'last-24-hours' ? t('usage.range.last24Hours')
        : t('usage.range.lastDays', { count: DASHBOARD_RANGE_DAYS[range] });
  const shareToolLabel = selectedTools.length > 0
    ? new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }).format(selectedTools.map(sourceLabel))
    : t('usage.filter.allAgents');

  useEffect(() => {
    if (loading) return;
    const available = new Set(view.toolModelUsage.map((row) => row.source));
    setSelectedTools((current) => {
      const next = current.filter((source) => available.has(source));
      return next.length === current.length ? current : next;
    });
  }, [loading, view.toolModelUsage]);

  useEffect(() => {
    let timer = 0;
    const onSynced = () => {
      // Hidden window: skip — the hook's focus/visibility probe catches up.
      if (document.visibilityState === 'hidden') return;
      // Coalesce bursts of sync events into a single reload.
      window.clearTimeout(timer);
      timer = window.setTimeout(() => reload(), 250);
    };
    window.addEventListener(DATA_SYNCED_EVENT, onSynced);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(DATA_SYNCED_EVENT, onSynced);
    };
  }, [reload]);

  const handleRangeChange = (next: DashboardRange) => {
    if (next === range && !customRange && !selectedDate) return;
    setCustomRange(null);
    setSelectedDate(null);
    setRange(next);
  };

  const visibleToolRows = useMemo(
    () => {
      if (selectedTools.length === 0) return view.toolModelUsage;
      const selected = new Set(selectedTools);
      return view.toolModelUsage.filter((row) => selected.has(row.source));
    },
    [selectedTools, view.toolModelUsage],
  );
  const visibleDistributions = useMemo(
    () => buildToolModelDistributions(visibleToolRows),
    [visibleToolRows],
  );
  const visibleTrendRows = useMemo(
    () =>
      filterTrendRowsBySources({
        dailyRows: view.rangeDailyUsage,
        hourlyRows: view.todayHourlyUsage,
        hourlyApiRows: rollingRange && !selectedDate ? data.rangeHourlyApiRows ?? [] : data.hourlyApiRows,
        rollingRange: !selectedDate ? rollingRange : null,
        hourlyDate: selectedDate ?? (isHourly ? customRange?.end ?? localDateNow() : undefined),
        heatmapDays: rollingRange && !selectedDate ? data.rangeDailyApiRows ?? [] : data.heatmapDays,
        modelRows: view.modelRows,
        toolRows: view.toolModelUsage,
        selectedSources: selectedTools,
      }),
    [
      data.heatmapDays,
      data.hourlyApiRows,
      isHourly,
      selectedDate,
      selectedTools,
      customRange,
      rollingRange,
      data.rangeHourlyApiRows,
      data.rangeDailyApiRows,
      view.modelRows,
      view.rangeDailyUsage,
      view.todayHourlyUsage,
      view.toolModelUsage,
    ],
  );
  const metricTrendRows = isHourly
    ? visibleTrendRows.hourlyRows
    : visibleTrendRows.dailyRows;
  const metricTrendPeriodLabel = isHourly
    ? rollingRange && !selectedDate ? t('usage.range.last24Hours') : dayScoped
      ? t('usage.range.dayHours')
      : t('usage.range.todayHours')
    : customRange ? formatDashboardDateRange(customRange) : t('usage.range.lastDaysShort', { count: rangeDays });
  const visibleProjectRows = useMemo(
    () => filterProjectRowsBySources(view.projectModelUsage, selectedTools),
    [selectedTools, view.projectModelUsage],
  );
  const visibleSummary = useMemo(
    () =>
      summarizeTrendRows({
        dailyRows: visibleTrendRows.dailyRows,
        hourlyRows: visibleTrendRows.hourlyRows,
        hourly: isHourly,
      }),
    [isHourly, visibleTrendRows],
  );
  const visibleMetricTrends = useMemo(
    () =>
      buildVisibleMetricTrends({
        currentDailyRows: visibleTrendRows.dailyRows,
        currentHourlyRows: visibleTrendRows.hourlyRows,
        heatmapDailyRows: data.heatmapDailyUsage,
        heatmapDays: data.heatmapDays,
        hourlyApiRows: data.hourlyApiRows,
        modelRows: data.modelRows,
        toolRows: view.toolModelUsage,
        selectedSources: selectedTools,
        rangeDays: dayScoped ? 1 : rangeDays,
        hourly: isHourly,
        currentDate: selectedDate ?? customRange?.end,
        availableFromDate: data.availableFromDate,
        rollingRange: !selectedDate ? rollingRange : null,
        previousHourlyApiRows: data.previousHourlyApiRows,
        availableFromTime: data.availableFromTime,
      }),
    [
      data.heatmapDailyUsage,
      data.availableFromDate,
      data.previousHourlyApiRows,
      data.availableFromTime,
      rollingRange,
      data.heatmapDays,
      data.hourlyApiRows,
      data.modelRows,
      dayScoped,
      isHourly,
      rangeDays,
      selectedDate,
      customRange,
      selectedTools,
      view.toolModelUsage,
      visibleTrendRows,
    ],
  );
  const visibleHeatmapDays = useMemo(
    () =>
      filterHeatmapDaysBySources(
        data.heatmapDays,
        selectedTools,
        data.modelRows,
      ),
    [data.heatmapDays, data.modelRows, selectedTools],
  );
  const visibleModelRows = useMemo(
    () => filterModelRowsBySources(data.modelRows, selectedTools),
    [data.modelRows, selectedTools],
  );

  useEffect(() => {
    publishSnapshot({
      data,
      filters: { rangeDays, selectedDate, selectedSources: selectedTools, dateRange: queryRange },
      loading: loading || refreshing || range !== dataRange,
      error,
      details: {
        sources: selectedTools.length > 0
          ? selectedTools
          : view.toolModelUsage.filter((row) => row.tokens > 0).map((row) => row.source),
        days: visibleTrendRows.dailyRows
          .filter((row) => !isHourly || (!selectedDate && rollingRange) || row.date === (selectedDate ?? customRange?.end ?? localDateNow()))
          .map((row) => ({ date: row.date, tokens: isHourly && !rollingRange ? visibleSummary.totalTokens : row.totalTokens })),
        models: filterModelRowsBySources(view.modelRows, selectedTools),
      },
      rangeLabel: shareRangeLabel,
      summary: visibleSummary,
      toolLabel: shareToolLabel,
    });
  }, [
    data,
    dataRange,
    range,
    rangeDays,
    customRange,
    queryRange,
    rollingRange,
    error,
    loading,
    publishSnapshot,
    refreshing,
    shareRangeLabel,
    shareToolLabel,
    visibleSummary,
    visibleTrendRows.dailyRows,
    view.modelRows,
    view.toolModelUsage,
    selectedTools,
    selectedDate,
    isHourly,
  ]);
  // Stable identity so the memoized overview card / heatmap skip re-renders.
  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate((current) => (current === date ? null : date));
  }, []);

  return (
    <div
      aria-busy={loading || refreshing}
      className="dashboard-page flex w-full flex-col"
      onClickCapture={(event) => {
        const href = (event.target as Element).closest('a[href]')?.getAttribute('href');
        if (href && /\/(pricing|achievements)(?:[?#]|$)/.test(href)) rememberDashboardScroll(selectedDate, selectedTools);
      }}
    >
      <DashboardFilter
        customRange={customRange}
        onCustomRangeChange={(next) => { setSelectedDate(null); setCustomRange(next); }}
        selectedTools={selectedTools}
        tools={view.toolModelUsage}
        value={range}
        onChange={handleRangeChange}
        onToolsChange={setSelectedTools}
      />

      {selectedDate && (
        <div className="mb-4">
          <Chip className="gap-1.5" size="sm" variant="soft">
            <Chip.Label>{t('usage.page.filteredDate', { date: formatFilterDayLabel(selectedDate, locale) })}</Chip.Label>
            <Button
              aria-label={t('usage.page.clearDate')}
              className="h-5 min-w-0 gap-0.5 px-1.5 text-xs"
              size="sm"
              variant="ghost"
              onPress={() => setSelectedDate(null)}
            >
              <Xmark className="size-3.5" />
              {t('usage.page.clear')}
            </Button>
          </Chip>
        </div>
      )}

      {error && !loading && (
        <div className="mb-4">
          <StatusBanner
            description={
              error === LOCAL_RUNTIME_RECOVERING_HINT ? undefined : usageErrorDescription(error, locale)
            }
            title={
              usageErrorTitle(error, locale)
            }
            tone="warn"
          />
        </div>
      )}

      {loading ? (
        <div className="relative isolate min-h-48">
          <DashboardRangeSyncOverlay visible />
          <DashboardLoadingSkeleton />
        </div>
      ) : (
        <div className="relative isolate min-h-48">
          <DashboardRangeSyncOverlay visible={refreshing} />
          <DashboardOverviewCard
            costReport={costExplanation.report}
            costExplanationLoading={costExplanation.loading}
            costExplanationError={costExplanation.error}
            belowMetrics={
              <SubscriptionUsageGrid className="mt-4 grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4" />
            }
            heatmapDays={visibleHeatmapDays}
            metricTrendPeriodLabel={metricTrendPeriodLabel}
            metricTrendRows={metricTrendRows}
            metricTrends={visibleMetricTrends}
            modelRows={visibleModelRows}
            onSelectDate={handleSelectDate}
            selectedDate={selectedDate}
            showLocalMetrics={isCliBackend()}
            summary={visibleSummary}
            sessionMetrics={sessionMetrics}
            sessionMetricsLoading={sessionMetricsLoading}
            sessionMetricsError={sessionMetricsError}
          />
          <SessionActivityPanel days={rangeDays} selectedDate={selectedDate} dateRange={queryRange} sources={selectedTools} enabled={!loading && !refreshing} />

          <section
            aria-label={t('usage.page.charts')}
            className="mt-4 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2"
          >
            <UsageTrendExplorer days={rangeDays} selectedDate={selectedDate} dateRange={queryRange} sources={selectedTools} enabled={!loading && !refreshing} dailyRows={visibleTrendRows.dailyRows} dayScoped={dayScoped} hourly={isHourly} hourlyRows={visibleTrendRows.hourlyRows} rangeLabel={customRange ? formatDashboardDateRange(customRange) : undefined} />
            {/* 分时活跃热力图：按天热力图已并入概览大卡片，此处注释便于以后恢复
            <HourlyActivityHeatmap rows={data.hourlyUsage} />
            */}
            <ToolModelUsagePanel rows={visibleToolRows} />
            <ProjectUsagePanel rows={visibleProjectRows} />
            {/* 终端分布：暂无真实 API，先隐藏 mock 占位
            <UsageDistributionCard
              description="按编辑器与终端来源查看用量占比"
              rows={distributions.terminals}
              title="终端分布"
            />
            */}
            <UsageDistributionCard
              description={t('usage.page.agentDistributionDesc')}
              rows={visibleDistributions.tools}
              title={t('usage.page.agentDistribution')}
            />
            <UsageDistributionCard
              description={t('usage.page.modelDistributionDesc')}
              rows={visibleDistributions.models}
              title={t('usage.page.modelDistribution')}
            />
          </section>
        </div>
      )}
    </div>
  );
}

/** `YYYY-MM-DD` → `X月X日` (UTC calendar parts, same as heatmap cells). */
function formatFilterDayLabel(date: string, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date.slice(0, 10)}T00:00:00Z`),
  );
}
