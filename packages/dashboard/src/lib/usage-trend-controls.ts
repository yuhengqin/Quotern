import type { TrendGranularity } from 'quotern-core';
import type { DashboardDateRange } from './dashboard-date-range.ts';

export type TrendSelection = TrendGranularity | 'auto';
const DAY_MS = 86_400_000;
const dateStamp = (date: string) => Date.parse(`${date}T00:00:00Z`);

export function getTrendDateRange(days: number, selectedDate: string | null, dateRange: DashboardDateRange | null, today: string): DashboardDateRange {
  if (selectedDate) return { start: selectedDate, end: selectedDate };
  if (dateRange) return dateRange;
  return { start: new Date(dateStamp(today) - (days - 1) * DAY_MS).toISOString().slice(0, 10), end: today };
}

/** Limit the overview to intervals that remain readable and have something to compare. */
export function getTrendControls(range: DashboardDateRange, requested: TrendSelection) {
  const start = dateStamp(range.start), end = dateStamp(range.end);
  const days = Math.round((end - start) / DAY_MS) + 1;
  const monday = (stamp: number) => stamp - ((new Date(stamp).getUTCDay() + 6) % 7) * DAY_MS;
  const month = (stamp: number) => new Date(stamp).getUTCFullYear() * 12 + new Date(stamp).getUTCMonth();
  const options: TrendGranularity[] = [];
  if (days <= 7) options.push('hourly');
  if (days > 1) options.push('daily');
  if (days > 7 && monday(end) > monday(start)) options.push('weekly');
  if (days > 7 && month(end) > month(start)) options.push('monthly');
  const autoGranularity: TrendGranularity = days === 1 ? 'hourly' : days <= 90 ? 'daily' : 'weekly';
  const selection = requested === 'auto' || options.includes(requested) ? requested : 'auto';
  return { options, selection, autoGranularity, granularity: selection === 'auto' ? autoGranularity : selection };
}

export function formatTrendDateRange(range: DashboardDateRange, today: string, todayLabel: string): string {
  if (range.start !== range.end) return `${range.start} – ${range.end}`;
  return range.start === today ? `${todayLabel} · ${range.start}` : range.start;
}
