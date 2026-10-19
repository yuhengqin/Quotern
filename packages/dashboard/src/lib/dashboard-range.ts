export type DashboardRange = 'today' | 'last-24-hours' | 'last-7-days' | 'last-30-days' | 'last-90-days';

export const DASHBOARD_RANGE_DAYS: Record<DashboardRange, number> = {
  today: 1,
  'last-24-hours': 1,
  'last-7-days': 7,
  'last-30-days': 30,
  'last-90-days': 90,
};

export function isDashboardRange(value: unknown): value is DashboardRange {
  return typeof value === 'string' && Object.hasOwn(DASHBOARD_RANGE_DAYS, value);
}
