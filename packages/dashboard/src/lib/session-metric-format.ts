import type { SessionMetrics } from 'quotern-core';
import { formatCompactTokenCount } from './utils.ts';

/** Compact display follows the saved unit preference. */
export function formatSessionTokens(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return formatCompactTokenCount(value);
}

/** Round display costs without changing the source data. */
export function formatSessionUsd(
  value: number | null | undefined,
  locale: string,
  { lowerBound = false }: { lowerBound?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value !== 0 && Math.abs(value) < 0.0001) {
    return lowerBound ? '> $0' : value > 0 ? '<$0.0001' : '>-$0.0001';
  }
  const amount = value.toLocaleString(locale, { maximumFractionDigits: 4 });
  return `${lowerBound ? '≥ ' : ''}$${amount}`;
}

export function formatSessionDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function sessionMetricValue(metrics: SessionMetrics | null, key: 'sessionCount' | 'messageCount' | 'durationSeconds' | 'activeSeconds' | 'taskSeconds'): number | null {
  if (!metrics) return null;
  if (key === 'taskSeconds') return metrics.taskSeconds ?? null;
  if (!metrics.complete && metrics.sessionCount === 0) return null;
  return metrics[key];
}
