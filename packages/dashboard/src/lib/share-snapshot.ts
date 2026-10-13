import { emptyDashboardData, type DashboardMockData } from './dashboard-mock-data.ts';
import type { SharePosterDetails } from '../components/SharePosterArtwork';
import { buildDashboardDataFromDataset, projectDashboardForDate } from './dashboard-data.ts';
import type { UsageDataset } from './api.ts';
import { localDateNow } from './stats-timezone.ts';
import { sourceLabel } from './tokens.ts';
import { filterModelRowsBySources, filterTrendRowsBySources, normalizeSourceId, summarizeTrendRows } from './usage-filter.ts';

export interface ShareFilters {
  rangeDays: number;
  selectedDate: string | null;
  selectedSources: string[];
}

/** Desktop omits comparison trends; sharing only needs the common usage fields. */
export type ShareDashboardData = Omit<DashboardMockData, 'metricTrends'>;

export function buildShareDataFromDataset(
  dataset: UsageDataset,
  rangeDays: number,
  convert: (dataset: UsageDataset, rangeDays: number) => ShareDashboardData = buildDashboardDataFromDataset,
): ShareDashboardData {
  // The browser converter's demo fallback must never fabricate an export.
  return dataset.dailyRows.length > 0 ? convert(dataset, rangeDays) : emptyDashboardData;
}

export const SHARE_RANGE_OPTIONS = [
  { days: 1, label: '今天' },
  { days: 7, label: '近 7 天' },
  { days: 30, label: '近 30 天' },
  { days: 90, label: '近 90 天' },
] as const;

/** Reuse the dashboard's date projection and Agent accounting for every export. */
export function buildShareSnapshot(data: ShareDashboardData, filters: ShareFilters) {
  const { rangeDays, selectedDate } = filters;
  const view = selectedDate ? projectDashboardForDate({
    ...data,
    metricTrends: { inputTokens: null, outputTokens: null, totalTokens: null, totalCostUsd: null },
  }, selectedDate) : data;
  const sourceKeys = new Map(view.toolModelUsage.map((tool) => [normalizeSourceId(tool.source), tool.source]));
  const selectedSources = [...new Set(filters.selectedSources.map((source) => (
    sourceKeys.get(normalizeSourceId(source)) ?? normalizeSourceId(source)
  )))];
  const hourly = selectedDate != null || rangeDays === 1;
  const hourlyDate = selectedDate ?? (hourly ? localDateNow() : undefined);
  const rows = filterTrendRowsBySources({
    dailyRows: view.rangeDailyUsage,
    hourlyRows: view.todayHourlyUsage,
    hourlyApiRows: data.hourlyApiRows,
    hourlyDate,
    heatmapDays: data.heatmapDays,
    modelRows: view.modelRows,
    toolRows: view.toolModelUsage,
    selectedSources,
  });
  const summary = summarizeTrendRows({ ...rows, hourly });
  const details: SharePosterDetails = {
    sources: selectedSources.length > 0
      ? [...selectedSources]
      : view.toolModelUsage.filter((tool) => tool.tokens > 0).map((tool) => tool.source),
    days: rows.dailyRows
      .filter((row) => !hourly || row.date === hourlyDate)
      .map((row) => ({ date: row.date, tokens: hourly ? summary.totalTokens : row.totalTokens })),
    models: filterModelRowsBySources(view.modelRows, selectedSources),
  };
  return {
    summary,
    details,
    rangeLabel: selectedDate ?? SHARE_RANGE_OPTIONS.find((option) => option.days === rangeDays)?.label ?? '',
    toolLabel: selectedSources.length > 0 ? selectedSources.map(sourceLabel).join('、') : '全部工具',
    tools: view.toolModelUsage,
  };
}
