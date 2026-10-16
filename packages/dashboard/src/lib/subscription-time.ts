import { differenceInCalendarDays, format } from 'date-fns';

/** Only display reset times supplied by the provider, never the fetch time. */
export function formatSubscriptionResetTime(resetsAt?: number | null, now = new Date(), absolute = false): string | null {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) || resetsAt <= 0) return null;
  const date = new Date(resetsAt * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  if (absolute) return format(date, 'M月d日 HH:mm');
  const days = differenceInCalendarDays(date, now);
  const label = days === 0 ? '今日' : days === 1 ? '明日' : days > 1 ? `${days}天后` : format(date, 'M月d日');
  return `${label} ${format(date, 'HH:mm')}`;
}
