import { localDateDaysAgo, localDateNow } from './stats-timezone.js';

export interface DashboardDateRange { start: string; end: string; fromTime?: string; toTime?: string }
export const CUSTOM_RANGE_LOOKBACK_DAYS = 365;

export function rollingDayRange(now = new Date()): DashboardDateRange {
  const from = new Date(now.getTime() - 86_400_000);
  return { start: localDateNow(undefined, from), end: localDateNow(undefined, now), fromTime: from.toISOString(), toTime: now.toISOString() };
}

export function previousRollingRange(range: DashboardDateRange): DashboardDateRange {
  const end = new Date(range.fromTime!);
  return rollingDayRange(end);
}

export function appendDashboardRangeQuery(query: URLSearchParams, range?: DashboardDateRange | null): void {
  if (range?.fromTime && range.toTime) {
    query.set('fromTime', range.fromTime); query.set('toTime', range.toTime);
  } else if (range) {
    query.set('fromDate', range.start); query.set('toDate', range.end);
  }
}

export function dateRangeDays(range: DashboardDateRange): number {
  return Math.round((Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86_400_000) + 1;
}

export function dateRangeLookback(range: DashboardDateRange, now = new Date()): number {
  return dateRangeDays({ start: range.start, end: localDateNow(undefined, now) });
}

export function isDashboardDateRange(value: unknown, now = new Date()): value is DashboardDateRange {
  if (!value || typeof value !== 'object') return false;
  // Instant windows are transient and must not become a saved custom date range.
  if ('fromTime' in value || 'toTime' in value) return false;
  const { start, end } = value as DashboardDateRange;
  const valid = (date: unknown): date is string => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const stamp = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date;
  };
  return valid(start) && valid(end) && start <= end && end <= localDateNow(undefined, now)
    && start >= localDateDaysAgo(CUSTOM_RANGE_LOOKBACK_DAYS, undefined, now);
}

export function formatDashboardDateRange(range: DashboardDateRange): string {
  return range.start === range.end ? range.start : `${range.start} – ${range.end}`;
}

export function dashboardRangeKey(days: number, range?: DashboardDateRange | null): string {
  return range?.fromTime ? `rolling:${range.fromTime}:${range.toTime}` : range ? `${range.start}:${range.end}` : `last:${days}`;
}
