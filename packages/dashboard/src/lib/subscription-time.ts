import { differenceInCalendarDays, format } from 'date-fns';
import { translate, type SupportedLocale } from 'quotern-i18n';

/** Provider timestamps only. Passing the deadline means waiting for a fresh reading, not proof of a reset. */
export function formatSubscriptionCountdown(resetsAt?: number | null, now = new Date(), locale: SupportedLocale = 'zh-CN'): string | null {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) || resetsAt <= 0) return null;
  const minutes = Math.ceil((resetsAt * 1000 - now.getTime()) / 60000);
  if (minutes <= 0) return translate(locale, 'usage.quota.awaitingUpdate');
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), rest = minutes % 60;
  return [days ? translate(locale, 'usage.quota.countdownDays', { count: days }) : null,
    hours ? translate(locale, 'usage.quota.countdownHours', { count: hours }) : null,
    rest ? translate(locale, 'usage.quota.countdownMinutes', { count: rest }) : null].filter(Boolean).join(' ');
}

/** Only display reset times supplied by the provider, never the fetch time. */
export function formatSubscriptionResetTime(resetsAt?: number | null, now = new Date(), absolute = false, locale: SupportedLocale = 'zh-CN'): string | null {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) || resetsAt <= 0) return null;
  const date = new Date(resetsAt * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  const monthDay = translate(locale, 'usage.time.monthDay', { month: date.getMonth() + 1, day: date.getDate() });
  if (absolute) return translate(locale, 'usage.time.withClock', { day: monthDay, clock: format(date, 'HH:mm') });
  const days = differenceInCalendarDays(date, now);
  const label = days === 0 ? translate(locale, 'usage.time.today')
    : days === 1 ? translate(locale, 'usage.time.tomorrow')
      : days > 1 ? translate(locale, 'usage.time.daysLater', { count: days })
        : monthDay;
  return translate(locale, 'usage.time.withClock', { day: label, clock: format(date, 'HH:mm') });
}
