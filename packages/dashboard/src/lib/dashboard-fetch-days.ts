import { HEATMAP_LOOKBACK_DAYS } from './dashboard-mock-data.ts';
import { localDateNow } from './stats-timezone.ts';
import { addLocalDays } from 'quotern-core/timezone';
import { dateRangeDays, dateRangeLookback, type DashboardDateRange } from './dashboard-date-range.ts';

function calendarDate(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  return match?.[1] ?? '';
}

/** Shanghai-calendar span from the day before `date` through today. */
export function hourlyDaysForSelectedDate(
  selectedDate: string | null | undefined,
  now = new Date(),
): number {
  const date = calendarDate(selectedDate ?? '');
  if (!date) return 1;
  const today = localDateNow(undefined, now);
  const start = Date.parse(`${date}T00:00:00.000Z`);
  const end = Date.parse(`${today}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1;
  return Math.max(2, Math.round((end - start) / 86_400_000) + 2);
}

/** Daily lookback for heatmap vs model/tool breakdown / hourly for the selected range. */
export function resolveDashboardFetchDays(
  rangeDays: number,
  selectedDate?: string | null,
  now = new Date(),
  dateRange?: DashboardDateRange | null,
): {
  dailyDays: number;
  breakdownDays: number;
  /**
   * Hourly follows the selected range. Heatmap drill-down expands just enough
   * to include that calendar day and its comparison day.
   */
  hourlyDays: number;
  dailyRange?: DashboardDateRange;
  hourlyRange?: DashboardDateRange;
  breakdownRange?: DashboardDateRange;
} {
  if (dateRange) {
    const lookback = dateRangeLookback(dateRange, now);
    const previousStart = addLocalDays(dateRange.start, -dateRangeDays(dateRange));
    const heatmapStart = addLocalDays(localDateNow(undefined, now), -(HEATMAP_LOOKBACK_DAYS - 1));
    const hourlyStart = selectedDate && selectedDate < dateRange.start
      ? addLocalDays(selectedDate, -1) : addLocalDays(dateRange.start, -1);
    return {
      dailyDays: Math.max(lookback + rangeDays, HEATMAP_LOOKBACK_DAYS),
      breakdownDays: rangeDays,
      hourlyDays: Math.max(lookback + 1, hourlyDaysForSelectedDate(selectedDate, now)),
      dailyRange: { start: previousStart < heatmapStart ? previousStart : heatmapStart, end: localDateNow(undefined, now) },
      hourlyRange: { start: hourlyStart, end: localDateNow(undefined, now) },
      breakdownRange: dateRange,
    };
  }
  return {
    dailyDays: Math.max(rangeDays, HEATMAP_LOOKBACK_DAYS),
    breakdownDays: rangeDays,
    hourlyDays: Math.max(
      rangeDays === 1 ? 2 : rangeDays,
      hourlyDaysForSelectedDate(selectedDate, now),
    ),
  };
}
