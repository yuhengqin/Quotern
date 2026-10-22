import {
  DEFAULT_STATS_TIMEZONE,
  localDateAndHour,
  localDateDaysAgo as coreLocalDateDaysAgo,
  localDateNow as coreLocalDateNow,
  localHourNow as coreLocalHourNow,
} from 'quotern-core/timezone';
import { dashboardNow } from './demo-runtime.ts';

export {
  DEFAULT_STATS_TIMEZONE,
  localDateAndHour,
};
export const localDateNow = (timeZone?: string, now = dashboardNow()) => coreLocalDateNow(timeZone, now);
export const localHourNow = (timeZone?: string, now = dashboardNow()) => coreLocalHourNow(timeZone, now);
export const localDateDaysAgo = (days: number, timeZone?: string, now = dashboardNow()) => coreLocalDateDaysAgo(days, timeZone, now);

/** Fixed label matching DEFAULT_STATS_TIMEZONE (Asia/Shanghai). */
export function getStatsTimezoneLabel(): string {
  return 'UTC+08:00';
}
