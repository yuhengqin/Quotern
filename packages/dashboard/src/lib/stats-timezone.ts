import {
  DEFAULT_STATS_TIMEZONE,
  localDateAndHour,
  localDateDaysAgo,
  localDateNow,
  localHourNow,
} from 'quotern-core/timezone';

export {
  DEFAULT_STATS_TIMEZONE,
  localDateAndHour,
  localDateDaysAgo,
  localDateNow,
  localHourNow,
};

/** Fixed label matching DEFAULT_STATS_TIMEZONE (Asia/Shanghai). */
export function getStatsTimezoneLabel(): string {
  return 'UTC+08:00';
}
