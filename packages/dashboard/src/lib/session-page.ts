import type { SessionActivitySnapshot } from 'quotern-core';
import { dateRangeDays, type DashboardDateRange } from './dashboard-date-range.ts';
import { DASHBOARD_RANGE_DAYS, isDashboardRange, type DashboardRange } from './dashboard-range.ts';
import { localDateDaysAgo, localDateNow } from './stats-timezone.ts';
import { relatedSessionActivity, type SessionSort } from './session-activity.ts';

export interface SessionScope {
  days: number;
  selectedDate: string | null;
  dateRange: DashboardDateRange | null;
  sources: readonly string[];
}

export interface SessionPageSearch {
  days: number;
  /** Absent for an inherited frozen window; presets use the live dashboard semantics. */
  range?: DashboardRange | 'custom';
  start?: string;
  end?: string;
  fromTime?: string;
  toTime?: string;
  scopeSources: string[];
  group?: string;
  q: string;
  sources: string[];
  project: string;
  sort: SessionSort;
  page: number;
}

const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item)))] : [];

/** Validate direct links and browser history, including JSON-encoded multi-selects. */
export function parseSessionPageSearch(raw: Record<string, unknown>): SessionPageSearch {
  const days = Number(raw.days), page = Number(raw.page);
  const preset = isDashboardRange(raw.range) ? raw.range : undefined;
  const calendar = !preset && date(raw.start) && date(raw.end) && raw.start <= raw.end;
  const instants = calendar && typeof raw.fromTime === 'string' && typeof raw.toTime === 'string'
    && Number.isFinite(Date.parse(raw.fromTime)) && Number.isFinite(Date.parse(raw.toTime)) && Date.parse(raw.fromTime) < Date.parse(raw.toTime);
  return {
    days: preset ? DASHBOARD_RANGE_DAYS[preset] : Number.isInteger(days) && days >= 1 && days <= 365 ? days : 7,
    ...(preset ? { range: preset } : raw.range === 'custom' && calendar ? { range: 'custom' as const } : {}),
    ...(calendar ? { start: raw.start as string, end: raw.end as string } : {}),
    ...(instants ? { fromTime: raw.fromTime as string, toTime: raw.toTime as string } : {}),
    scopeSources: strings(raw.scopeSources),
    ...(typeof raw.group === 'string' && raw.group ? { group: raw.group } : {}),
    q: typeof raw.q === 'string' ? raw.q : '',
    sources: strings(raw.sources),
    project: typeof raw.project === 'string' ? raw.project : '',
    sort: ['recent', 'tokens', 'cost', 'duration'].includes(String(raw.sort)) ? raw.sort as SessionSort : 'recent',
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

/** Freeze the overview's range so navigation cannot silently move its denominator. */
export function createSessionPageSearch(scope: SessionScope, now = new Date()): SessionPageSearch {
  const range = scope.selectedDate ? { start: scope.selectedDate, end: scope.selectedDate } : scope.dateRange;
  return parseSessionPageSearch({
    days: scope.selectedDate ? 1 : scope.days,
    start: range?.start ?? localDateDaysAgo(scope.days, undefined, now),
    end: range?.end ?? localDateNow(undefined, now),
    ...range,
    scopeSources: [...scope.sources],
  });
}

export function updateSessionPageSearch(search: SessionPageSearch, patch: Partial<SessionPageSearch>): SessionPageSearch {
  return parseSessionPageSearch({ ...search, page: 1, ...patch });
}

export function selectSessionPageRange(search: SessionPageSearch, range: DashboardRange | DashboardDateRange): SessionPageSearch {
  return updateSessionPageSearch(search, {
    start: undefined, end: undefined, fromTime: undefined, toTime: undefined,
    ...(typeof range === 'string' ? { range, days: DASHBOARD_RANGE_DAYS[range] }
      : { range: 'custom', days: dateRangeDays(range), start: range.start, end: range.end }),
  });
}

/** Preserve inherited exact bounds, while reflecting their matching preset if possible. */
export function sessionTimeRangeControl(search: SessionPageSearch, now = new Date()): { value: DashboardRange; customRange: DashboardDateRange | null } {
  if (search.range && search.range !== 'custom') return { value: search.range, customRange: null };
  if (search.fromTime && search.toTime) return { value: 'last-24-hours', customRange: null };
  const calendar = search.start && search.end ? { start: search.start, end: search.end } : null;
  const preset = (['today', 'last-7-days', 'last-30-days', 'last-90-days'] as const).find(value => DASHBOARD_RANGE_DAYS[value] === search.days);
  if (search.range !== 'custom' && preset && (!calendar || calendar.start === localDateDaysAgo(search.days, undefined, now) && calendar.end === localDateNow(undefined, now))) {
    return { value: preset, customRange: null };
  }
  return { value: preset ?? 'last-7-days', customRange: calendar ?? { start: localDateDaysAgo(search.days, undefined, now), end: localDateNow(undefined, now) } };
}

export const sessionAttributionKey = (row: Pick<SessionActivitySnapshot['billing'][number], 'service' | 'mode' | 'accountRef'>): string => JSON.stringify([row.service, row.mode, row.accountRef]);

export function sessionPageRows(snapshot: SessionActivitySnapshot, group?: string) {
  if (!group) return snapshot.sessions;
  const attribution = snapshot.billing.find(row => sessionAttributionKey(row) === group);
  return attribution ? relatedSessionActivity(snapshot.sessions, attribution) : [];
}
