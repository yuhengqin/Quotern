/** Instant bounds are half-open. Token usage selects existing bucket starts;
 * it cannot split the accounting inside a persisted 30-minute bucket. */
export interface UsageBounds {
  fromDate?: string;
  toDate?: string;
  fromTime?: string;
  toTime?: string;
}

export function inTimeBounds(stamp: string, bounds?: UsageBounds): boolean {
  const time = Date.parse(stamp);
  return (!bounds?.fromTime || time >= Date.parse(bounds.fromTime))
    && (!bounds?.toTime || time < Date.parse(bounds.toTime));
}

export function validTimeBounds(bounds: UsageBounds): boolean {
  const instant = (value?: string) => !!value && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  return instant(bounds.fromTime) && instant(bounds.toTime) && Date.parse(bounds.fromTime!) < Date.parse(bounds.toTime!);
}
