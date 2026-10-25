/** Foreground fallback for statistics; focus and sync events still refresh immediately. */
export const DASHBOARD_POLL_MS = 30_000;

/** Advancing a 24-hour window every minute is enough for aggregate usage charts. */
export const ROLLING_DAY_TICK_MS = 60_000;

/** Subscribe only to automatic refresh sources; initial loads and explicit sync stay with callers. */
export function subscribeAutomaticRefresh(
  poll: () => void,
  { readOnly = false, onFocus = poll, intervalMs = DASHBOARD_POLL_MS }: {
    readOnly?: boolean; onFocus?: () => void; intervalMs?: number;
  } = {},
): () => void {
  if (readOnly) return () => {};
  const timer = window.setInterval(poll, intervalMs);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onFocus);
  };
}
