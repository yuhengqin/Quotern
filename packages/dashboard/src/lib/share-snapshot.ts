import { emptyDashboardData, type DashboardMockData } from './dashboard-mock-data.ts';
import type { SharePosterDetails } from '../components/SharePosterArtwork';
import { buildDashboardDataFromDataset, projectDashboardForDate } from './dashboard-data.ts';
import type { UsageDataset } from './api.ts';
import { localDateNow } from './stats-timezone.ts';
import { sourceLabel } from './tokens.ts';
import { formatDashboardDateRange, type DashboardDateRange } from './dashboard-date-range.ts';
import { filterModelRowsBySources, filterTrendRowsBySources, normalizeSourceId, summarizeTrendRows } from './usage-filter.ts';
import { translate, type SupportedLocale } from 'quotern-i18n';

export interface ShareFilters {
  rangeDays: number;
  selectedDate: string | null;
  selectedSources: string[];
  dateRange?: DashboardDateRange | null;
}

/** Desktop omits comparison trends; sharing only needs the common usage fields. */
export type ShareDashboardData = Omit<DashboardMockData, 'metricTrends'>;

export function buildShareDataFromDataset(
  dataset: UsageDataset,
  rangeDays: number,
  convert: (dataset: UsageDataset, rangeDays: number, dateRange?: DashboardDateRange | null) => ShareDashboardData = buildDashboardDataFromDataset,
  dateRange?: DashboardDateRange | null,
): ShareDashboardData {
  // The browser converter's demo fallback must never fabricate an export.
  return dataset.dailyRows.length > 0 ? convert(dataset, rangeDays, dateRange) : emptyDashboardData;
}

export const SHARE_RANGE_OPTIONS = [
  { days: 1, key: 'share.range.today' },
  { days: 7, key: 'share.range.last7' },
  { days: 30, key: 'share.range.last30' },
  { days: 90, key: 'share.range.last90' },
] as const;

export function shareRangeLabel(days: number, locale: SupportedLocale, range?: DashboardDateRange | null): string {
  if (range?.fromTime) return translate(locale, 'usage.range.last24Hours');
  if (range) return formatDashboardDateRange(range);
  const option = SHARE_RANGE_OPTIONS.find((item) => item.days === days);
  return option ? translate(locale, option.key) : '';
}

/** Reuse the dashboard's date projection and Agent accounting for every export. */
export function buildShareSnapshot(data: ShareDashboardData, filters: ShareFilters, locale: SupportedLocale = 'zh-CN') {
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
  const hourlyDate = selectedDate ?? (hourly ? filters.dateRange?.end ?? localDateNow() : undefined);
  const rows = filterTrendRowsBySources({
    dailyRows: view.rangeDailyUsage,
    hourlyRows: view.todayHourlyUsage,
    hourlyApiRows: !selectedDate && data.rollingRange ? data.rangeHourlyApiRows ?? [] : data.hourlyApiRows,
    rollingRange: !selectedDate ? data.rollingRange : null,
    hourlyDate,
    heatmapDays: !selectedDate && data.rollingRange ? data.rangeDailyApiRows ?? [] : data.heatmapDays,
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
      .filter((row) => !hourly || (!selectedDate && data.rollingRange) || row.date === hourlyDate)
      .map((row) => ({ date: row.date, tokens: hourly && !data.rollingRange ? summary.totalTokens : row.totalTokens })),
    models: filterModelRowsBySources(view.modelRows, selectedSources),
  };
  return {
    summary,
    details,
    rangeLabel: selectedDate ?? shareRangeLabel(rangeDays, locale, data.rollingRange ?? filters.dateRange),
    toolLabel: selectedSources.length > 0 ? new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }).format(selectedSources.map(sourceLabel)) : translate(locale, 'share.allAgents'),
    tools: view.toolModelUsage,
  };
}
