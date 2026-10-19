import type { DashboardDateRange } from './dashboard-date-range.js';

/** Exact bounds identify requests; a display scope survives background clock advances. */
export function dashboardRangeKey(days: number, range?: DashboardDateRange | null): string {
  return range?.fromTime ? `rolling:${range.fromTime}:${range.toTime}` : range ? `${range.start}:${range.end}` : `last:${days}`;
}

export function dashboardRangeScopeKey(days: number, range?: DashboardDateRange | null): string {
  const rollingDay = range?.fromTime && range.toTime && Date.parse(range.toTime) - Date.parse(range.fromTime) === 86_400_000;
  return rollingDay ? 'rolling:24h' : dashboardRangeKey(days, range);
}
