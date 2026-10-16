import type { QuotaWindow } from './quota';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function codexQuotaWindows(value: unknown): QuotaWindow[] {
  const root = record(value), windows: QuotaWindow[] = [];
  const add = (value: unknown, prefix: string, groupLabel?: string) => {
    const limits = record(value);
    for (const name of ['primary_window', 'secondary_window']) {
      const row = record(limits[name]), duration = row.limit_window_seconds, used = row.used_percent;
      if (typeof used !== 'number' || !Number.isFinite(used)) continue;
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 366 * 86400) continue;
      const id = `${prefix}${duration}`;
      if (windows.some(window => window.id === id)) continue;
      windows.push({ id, label: duration === 18000 ? '5h' : duration === 604800 ? '7d' : duration < 86400 ? `${Math.round(duration / 3600)}h` : `${Math.round(duration / 86400)}d`,
        ...(groupLabel ? { groupLabel } : {}), durationSeconds: duration,
        usedPercent: Math.min(100, Math.max(0, used)), resetsAt: typeof row.reset_at === 'number' && Number.isFinite(row.reset_at) && row.reset_at > 0 ? row.reset_at : null });
    }
  };
  add(root.rate_limit, 'account:');
  if (Array.isArray(root.additional_rate_limits)) for (const entry of root.additional_rate_limits) {
    const row = record(entry);
    const name = typeof row.limit_name === 'string' ? row.limit_name : typeof row.metered_feature === 'string' ? row.metered_feature : '';
    const key = typeof row.metered_feature === 'string' ? row.metered_feature : name;
    if (name && key) add(row.rate_limit, `feature:${key}:`, name);
  }
  return windows;
}
