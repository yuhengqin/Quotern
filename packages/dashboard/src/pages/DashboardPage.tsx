import { useEffect, useMemo, useState } from 'react';
import { Xmark } from '@gravity-ui/icons';
import { Button, Chip } from '@heroui/react';
import {
  DASHBOARD_RANGE_DAYS,
  DashboardFilter,
  type DashboardRange,
} from '@/components/DashboardFilter';
import { DashboardLoadingSkeleton } from '@/components/DashboardLoadingSkeleton';
import { DashboardOverviewCard } from '@/components/DashboardOverviewCard';
import { DashboardRangeSyncOverlay } from '@/components/DashboardRangeSyncOverlay';
import { DailyUsageTrendCard } from '@/components/DailyUsageTrendCard';
import { TokenUsageTrendCard } from '@/components/TokenUsageTrendCard';
// 分时热力图：暂时注释，保留组件便于以后恢复
// import { HourlyActivityHeatmap } from '@/components/HourlyActivityHeatmap';
import { StatusBanner } from '@/components/StatusBanner';
import { SubscriptionUsageGrid } from '@/components/SubscriptionUsageGrid';
import { ProjectUsagePanel } from '@/components/ProjectUsagePanel';
import { ToolModelUsagePanel } from '@/components/ToolModelUsagePanel';
import { UsageDistributionCard } from '@/components/UsageDistributionCard';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useSessionMetrics } from '@/hooks/useSessionMetrics';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useShareSnapshot } from '@/hooks/ShareSnapshotContext';
import { isCliBackend } from '@/lib/api';
import { projectDashboardForDate } from '@/lib/dashboard-data';
import { scheduleAfterPaint } from '@/lib/schedule-after-paint';
import { DATA_SYNCED_EVENT } from '@/lib/shell-events';
import { localDateNow } from '@/lib/stats-timezone';
import { dateRangeDays, formatDashboardDateRange, isDashboardDateRange, type DashboardDateRange } from '@/lib/dashboard-date-range';
import { sourceLabel } from '@/lib/tokens';
import { usageErrorDescription, usageErrorTitle } from '@/lib/usage-error';
import {
  buildVisibleMetricTrends,
  buildToolModelDistributions,
  filterHeatmapDaysBySources,
  filterModelRowsBySources,
  filterProjectRowsBySources,
  filterTrendRowsBySources,
  summarizeTrendRows,
} from '@/lib/usage-filter';

const SHARE_RANGE_LABELS: Record<DashboardRange, string> = {
  today: '今天',
  'last-7-days': '近 7 天',
  'last-30-days': '近 30 天',
  'last-90-days': '近 90 天',
};

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
  const [range, setRange] = useLocalStorage<DashboardRange>(
    'tud.dashboardRange',
    'last-7-days',
    (value): value is DashboardRange =>
      typeof value === 'string' && value in DASHBOARD_RANGE_DAYS,
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [customRange, setCustomRange] = useLocalStorage<DashboardDateRange | null>(
    'tud.dashboardCustomRange', null,
    (value): value is DashboardDateRange | null => value === null || isDashboardDateRange(value),
  );
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const { publishSnapshot } = useShareSnapshot();
  const dataRange = useDeferredDashboardRange(range);
  const rangeDays = customRange ? dateRangeDays(customRange) : DASHBOARD_RANGE_DAYS[dataRange];
  const { data, error, loading, refreshing, reload, source } =
    useDashboardData(rangeDays, selectedDate, customRange);
  const sessionMetrics = useSessionMetrics(rangeDays, selectedDate, customRange, selectedTools, !loading && !refreshing);
  const view = useMemo(
    () => (selectedDate ? projectDashboardForDate(data, selectedDate) : data),
    [data, selectedDate],
  );
  const dayScoped = selectedDate != null || Boolean(customRange && rangeDays === 1 && customRange.end !== localDateNow());
  const isHourly = dayScoped || rangeDays === 1;
  const shareRangeLabel = selectedDate
    ? formatFilterDayLabel(selectedDate)
    : customRange ? formatDashboardDateRange(customRange) : SHARE_RANGE_LABELS[range];
  const shareToolLabel = selectedTools.length > 0
    ? selectedTools.map(sourceLabel).join('、')
    : '全部 Agent';
  const showProjectDistribution = isCliBackend();

  useEffect(() => {
    const available = new Set(view.toolModelUsage.map((row) => row.source));
    setSelectedTools((current) => {
      const next = current.filter((source) => available.has(source));
      return next.length === current.length ? current : next;
    });
  }, [view.toolModelUsage]);

  useEffect(() => {
    const onSynced = () => {
      void reload();
    };
    window.addEventListener(DATA_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(DATA_SYNCED_EVENT, onSynced);
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
        hourlyApiRows: data.hourlyApiRows,
        hourlyDate: selectedDate ?? (isHourly ? customRange?.end ?? localDateNow() : undefined),
        heatmapDays: data.heatmapDays,
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
    ? dayScoped
      ? '当日小时'
      : '今日小时'
    : customRange ? formatDashboardDateRange(customRange) : `近 ${rangeDays} 日`;
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
      }),
    [
      data.heatmapDailyUsage,
      data.availableFromDate,
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
      filters: { rangeDays, selectedDate, selectedSources: selectedTools, dateRange: customRange },
      loading: loading || refreshing || range !== dataRange,
      error,
      details: {
        sources: selectedTools.length > 0
          ? selectedTools
          : view.toolModelUsage.filter((row) => row.tokens > 0).map((row) => row.source),
        days: visibleTrendRows.dailyRows
          .filter((row) => !isHourly || row.date === (selectedDate ?? customRange?.end ?? localDateNow()))
          .map((row) => ({ date: row.date, tokens: isHourly ? visibleSummary.totalTokens : row.totalTokens })),
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
  const handleSelectDate = (date: string) => {
    setSelectedDate((current) => (current === date ? null : date));
  };

  return (
    <div
      aria-busy={loading || refreshing}
      className="dashboard-page flex w-full min-w-0 flex-col"
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
            <Chip.Label>当前筛选：{formatFilterDayLabel(selectedDate)}</Chip.Label>
            <Button
              aria-label="清除日期筛选"
              className="h-5 min-w-0 gap-0.5 px-1.5 text-xs"
              size="sm"
              variant="ghost"
              onPress={() => setSelectedDate(null)}
            >
              <Xmark className="size-3.5" />
              清除
            </Button>
          </Chip>
        </div>
      )}

      {source === 'api' && error && !loading && (
        <div className="mb-4">
          <StatusBanner description={usageErrorDescription(error)} title={usageErrorTitle(error)} tone="warn" />
        </div>
      )}

      {loading ? (
        <div className="relative min-h-48">
          <DashboardRangeSyncOverlay visible />
          <DashboardLoadingSkeleton />
        </div>
      ) : (
        <div className="relative min-h-48">
          <DashboardRangeSyncOverlay visible={refreshing} />
          <DashboardOverviewCard
            belowMetrics={<SubscriptionUsageGrid className="mt-4 grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4" />}
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
          />

          <section
            aria-label="用量图表"
            className="mt-4 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2"
          >
            <TokenUsageTrendCard
              dailyRows={visibleTrendRows.dailyRows}
              dayScoped={dayScoped}
              hourly={isHourly}
              hourlyRows={visibleTrendRows.hourlyRows}
            />
            <DailyUsageTrendCard
              rangeLabel={customRange ? formatDashboardDateRange(customRange) : undefined}
              dayScoped={dayScoped}
              hourly={isHourly}
              hourlyRows={visibleTrendRows.hourlyRows}
              rangeDays={rangeDays}
              rows={visibleTrendRows.dailyRows}
            />
            {/* 分时活跃热力图：按天热力图已并入概览大卡片，此处注释便于以后恢复
            <HourlyActivityHeatmap rows={data.hourlyUsage} />
            */}
            <ToolModelUsagePanel rows={visibleToolRows} />
            {showProjectDistribution && (
              <ProjectUsagePanel rows={visibleProjectRows} />
            )}
            {/* 终端分布：暂无真实 API，先隐藏 mock 占位
            <UsageDistributionCard
              description="按编辑器与终端来源查看用量占比"
              rows={distributions.terminals}
              title="终端分布"
            />
            */}
            <UsageDistributionCard
              description="按 Agent 查看用量占比"
              rows={visibleDistributions.tools}
              title="Agent 分布"
            />
            <UsageDistributionCard
              description="按模型查看 Token 与费用占比"
              rows={visibleDistributions.models}
              title="模型分布"
            />
          </section>
        </div>
      )}
    </div>
  );
}

/** `YYYY-MM-DD` → `X月X日` (UTC calendar parts, same as heatmap cells). */
function formatFilterDayLabel(date: string): string {
  const [, month = '1', day = '1'] = date.slice(0, 10).split('-');
  return `${Number(month)}月${Number(day)}日`;
}
