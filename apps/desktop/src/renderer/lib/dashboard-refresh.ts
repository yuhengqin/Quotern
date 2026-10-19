/** Foreground fallback for statistics; focus and sync events still refresh immediately. */
export const DASHBOARD_POLL_MS = 30_000;

/** Advancing a 24-hour window every minute is enough for aggregate usage charts. */
export const ROLLING_DAY_TICK_MS = 60_000;
