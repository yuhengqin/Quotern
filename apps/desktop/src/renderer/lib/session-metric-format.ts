import type { SessionMetrics } from 'quotern-core';

export function formatSessionDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function sessionMetricValue(metrics: SessionMetrics | null, key: 'sessionCount' | 'messageCount' | 'durationSeconds' | 'activeSeconds'): number | null {
  if (!metrics || (!metrics.complete && metrics.sessionCount === 0)) return null;
  return metrics[key];
}
