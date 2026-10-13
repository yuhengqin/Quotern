/** Default timezone for usage day/hour bucketing (UTC+8). */
export const DEFAULT_STATS_TIMEZONE = 'Asia/Shanghai';

export interface LocalDateHour {
  /** Calendar date in the stats timezone: `YYYY-MM-DD`. */
  date: string;
  /** Hour of day in the stats timezone: `0..23`. */
  hour: number;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsFormatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
    });
    partsFormatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * Map a UTC instant (ISO string or Date) to calendar date + hour in `timeZone`.
 * Example: `2026-07-24T17:00:00.000Z` → `{ date: '2026-07-25', hour: 1 }` in Asia/Shanghai.
 */
export function localDateAndHour(
  isoUtc: string | Date,
  timeZone: string = DEFAULT_STATS_TIMEZONE,
): LocalDateHour {
  const d = typeof isoUtc === 'string' ? new Date(isoUtc) : isoUtc;
  if (Number.isNaN(d.getTime())) {
    return { date: '1970-01-01', hour: 0 };
  }
  const parts = getPartsFormatter(timeZone).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
  };
}

export function localDateNow(
  timeZone: string = DEFAULT_STATS_TIMEZONE,
  now: Date = new Date(),
): string {
  return localDateAndHour(now, timeZone).date;
}

export function localHourNow(
  timeZone: string = DEFAULT_STATS_TIMEZONE,
  now: Date = new Date(),
): number {
  return localDateAndHour(now, timeZone).hour;
}

/** Calendar arithmetic on `YYYY-MM-DD` (timezone-agnostic). */
export function addLocalDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + delta));
  return utc.toISOString().slice(0, 10);
}

/** Inclusive window start date for the last `days` local calendar days. */
export function localDateDaysAgo(
  days: number,
  timeZone: string = DEFAULT_STATS_TIMEZONE,
  now: Date = new Date(),
): string {
  const today = localDateNow(timeZone, now);
  return addLocalDays(today, -(Math.max(1, days) - 1));
}
