import { canonicalSubscriptionPlanLabel } from './subscription-plan.js';

/** Read-only subset of the local OpenCode Go subscription snapshot. */
export type OpenCodeSubscriptionStatus =
  | 'ready'
  | 'unsupported-plan'
  | 'not-installed'
  | 'not-signed-in'
  | 'custom-provider'
  | 'expired'
  | 'temporarily-unavailable';

export interface OpenCodeRateLimitWindow {
  id: 'five-hour' | 'weekly' | 'monthly';
  label: string;
  usedPercent: number;
  /** Unix timestamp in seconds. */
  resetsAt: number | null;
  durationSeconds?: number | null;
}

export interface OpenCodeSubscriptionSnapshot {
  status: OpenCodeSubscriptionStatus;
  planLabel: string | null;
  limits: OpenCodeRateLimitWindow[];
  /** Unix timestamp in seconds. */
  fetchedAt: number | null;
  stale: boolean;
  message: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedPercent(value: unknown, allowFraction = true): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const normalized = allowFraction && number <= 1 ? number * 100 : number;
  return Math.round(Math.min(100, Math.max(0, normalized)) * 100) / 100;
}

function resetAt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value > 10_000_000_000 ? value / 1_000 : value);
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? Math.floor(millis / 1_000) : null;
}

export function openCodePlanLabel(value: unknown): string | null {
  return canonicalSubscriptionPlanLabel(value);
}

type WindowId = OpenCodeRateLimitWindow['id'];
const WINDOWS: { id: WindowId; key: string; label: string; durationSeconds: number | null }[] = [
  { id: 'five-hour', key: 'rolling', label: '5h', durationSeconds: 18_000 },
  { id: 'weekly', key: 'weekly', label: '7d', durationSeconds: 604_800 },
  { id: 'monthly', key: 'monthly', label: '月限额', durationSeconds: null },
];

function pickWindow(raw: Record<string, unknown>, hint?: WindowId): OpenCodeRateLimitWindow | null {
  const usedPercent = boundedPercent(raw.usedPercent ?? raw.usagePercent ?? raw.percent);
  if (usedPercent === null) return null;
  const resetsAt = resetAt(raw.resetsAt ?? raw.nextResetTime ?? raw.resetTime);
  const minutes = Number(raw.windowDurationMins ?? raw.windowMins ?? raw.minutes);
  const id = hint ?? (minutes >= 240 && minutes <= 360 ? 'five-hour'
    : minutes >= 10_000 && minutes <= 10_200 ? 'weekly'
      : minutes >= 28 * 1440 && minutes <= 31 * 1440 ? 'monthly' : null);
  const definition = WINDOWS.find(window => window.id === id);
  return definition ? { id: definition.id, label: definition.label, usedPercent, resetsAt,
    durationSeconds: Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : definition.durationSeconds } : null;
}

/** Official Go usage schemas: v1.19.0 `usage.*`, and the original `*Usage` response. */
export function mapOpenCodeUsage(value: unknown, now = Date.now() / 1_000): Pick<
  OpenCodeSubscriptionSnapshot,
  'planLabel' | 'limits'
> {
  const root = asRecord(value);
  if (!root) return { planLabel: null, limits: [] };

  const planLabel = openCodePlanLabel(root.plan ?? root.tier ?? root.planName ?? root.plan_name);
  const usage = asRecord(root.usage);
  const byId = new Map<WindowId, OpenCodeRateLimitWindow>();
  for (const definition of WINDOWS) {
    const row = asRecord(usage?.[definition.key]) ?? asRecord(root[`${definition.key}Usage`]);
    if (!row || (row.status !== undefined && row.status !== 'ok' && row.status !== 'rate-limited')) continue;
    // Official percentages are already 0–100; 1 means one percent, not a full pool.
    const usedPercent = boundedPercent(row.percent ?? row.usagePercent, false);
    if (usedPercent === null) continue;
    const seconds = row.resetInSec;
    const resetsAt = resetAt(row.resetsAt) ?? (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? Math.floor(now + seconds) : null);
    byId.set(definition.id, { id: definition.id, label: definition.label, usedPercent, resetsAt, durationSeconds: definition.durationSeconds });
  }
  const official = byId.size > 0;

  const buckets: unknown[] = [];
  if (Array.isArray(root.windows)) buckets.push(...root.windows);
  if (Array.isArray(root.limits)) buckets.push(...root.limits);
  if (Array.isArray(root.usagePeriods)) buckets.push(...root.usagePeriods);
  for (const [id, value] of [['five-hour', root.primary ?? root.fiveHour], ['weekly', root.secondary ?? root.weekly], ['monthly', root.monthly ?? root.tertiary]] as const) {
    const row = asRecord(value);
    const window = row ? pickWindow(row, id) : null;
    if (window && !byId.has(window.id)) byId.set(window.id, window);
  }

  for (const item of buckets) {
    const record = asRecord(item);
    if (!record) continue;
    const window = pickWindow(record);
    if (window && !byId.has(window.id)) byId.set(window.id, window);
  }

  return { planLabel: planLabel ?? (official ? 'Go' : null), limits: WINDOWS.flatMap(window => byId.has(window.id) ? [byId.get(window.id)!] : []) };
}

export function openCodeRemainingPercent(usedPercent: number): number {
  if (!Number.isFinite(usedPercent)) return 0;
  return Math.min(100, Math.max(0, 100 - usedPercent));
}
