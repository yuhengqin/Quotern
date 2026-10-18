import type { TrendGranularity, UsageTrendPoint } from 'quotern-core';
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

export function formatTrendPointLabels(point: Pick<UsageTrendPoint, 'key' | 'fromDate' | 'toDate'>, granularity: TrendGranularity, singleDay = false) {
  if (granularity === 'weekly') {
    const weekEnd = new Date(dateStamp(point.key) + 6 * DAY_MS).toISOString().slice(0, 10);
    const date = (value: string) => value.replaceAll('-', '/');
    return {
      axisLabel: `${date(point.key).slice(5)}–${date(weekEnd).slice(point.key.slice(0, 7) === weekEnd.slice(0, 7) ? 8 : 5)}`,
      tooltipLabel: point.fromDate === point.toDate ? date(point.fromDate) : `${date(point.fromDate)} – ${date(point.toDate).slice(point.fromDate.slice(0, 4) === point.toDate.slice(0, 4) ? 5 : 0)}`,
      partialWeek: point.fromDate !== point.key || point.toDate !== weekEnd,
    };
  }
  const axisLabel = granularity === 'hourly' ? `${singleDay ? '' : `${point.key.slice(5, 10)} `}${point.key.slice(-2)}:00` : granularity === 'monthly' ? point.key : point.key.slice(5);
  return { axisLabel, tooltipLabel: axisLabel, partialWeek: false };
}

/** Both cards use the narrower card's label budget, including at responsive breakpoints. */
export function getTrendAxisTicks(points: readonly Pick<UsageTrendPoint, 'key' | 'fromDate' | 'toDate'>[], granularity: TrendGranularity, singleDay: boolean, cardWidth: number): string[] {
  const labels = points.map(point => formatTrendPointLabels(point, granularity, singleDay).axisLabel);
  if (!labels.length) return [];
  const labelWidth = Math.max(...labels.map(label => label.length)) * 7 + 24;
  const count = Math.min(labels.length, Math.max(2, Math.min(5, Math.floor(Math.max(0, cardWidth - 100) / labelWidth))));
  return Array.from({ length: count }, (_, i) => labels[count === 1 ? 0 : Math.round(i * (labels.length - 1) / (count - 1))]!);
}
