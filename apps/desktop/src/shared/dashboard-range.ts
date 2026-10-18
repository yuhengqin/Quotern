export type DashboardRange = 'today' | 'last-24-hours' | 'last-7-days' | 'last-30-days' | 'last-90-days';

export const DEFAULT_DASHBOARD_RANGE: DashboardRange = 'last-7-days';

export const DASHBOARD_RANGE_DAYS: Record<DashboardRange, number> = {
  today: 1,
  'last-24-hours': 1,
  'last-7-days': 7,
  'last-30-days': 30,
  'last-90-days': 90,
};

/** User-facing time range labels for the dashboard and share card. */
export const DASHBOARD_RANGE_LABELS: Record<DashboardRange, string> = {
  today: '今天',
  'last-24-hours': '最近 24 小时',
  'last-7-days': '近 7 天',
  'last-30-days': '近 30 天',
  'last-90-days': '近 90 天',
};

export const DASHBOARD_RANGE_GET_CHANNEL = 'dashboard-range:get';
export const DASHBOARD_RANGE_SET_CHANNEL = 'dashboard-range:set';
export const DASHBOARD_RANGE_CHANGED_CHANNEL = 'dashboard-range:changed';

export function isDashboardRange(value: unknown): value is DashboardRange {
  return typeof value === 'string' && value in DASHBOARD_RANGE_DAYS;
}
