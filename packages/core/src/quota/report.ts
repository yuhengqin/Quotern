import { SUBSCRIPTION_CHANNELS, isSubscriptionChannelId, type SubscriptionChannelId } from './shared/subscription-channels.js';
import { quotaWindowPeriodSeconds, type QuotaState } from './shared/quota.js';
import { QUOTA_DIAGNOSTIC_CODES, QUOTA_DIAGNOSTIC_STAGES, type QuotaReadDiagnostic } from './shared/quota-diagnostic.js';

export type QuotaRuntimeSource = 'cli' | 'desktop';
export const QUOTA_REPORT_MAX_AGE = 1800;
const statuses = ['ready', 'unavailable', 'temporarily-unavailable', 'not-signed-in', 'expired', 'access-denied', 'unsupported-account', 'custom-provider', 'not-installed'];
export interface QuotaReportWindow {
  id: string; kind: 'percentage' | 'balance'; usedPercent: number | null;
  balance: { currency: 'CNY'; remaining: number | null } | null;
  resetsAt: number | null; timeKind: 'reset' | 'expiry'; periodSeconds: number | null; stale: boolean;
  forecast: { etaAt: number | null; paceDifference: number | null; paceBasis: 'uniform' | 'workdays' | 'automatic' } | null;
}
export interface QuotaReportProvider {
  id: string; provider: SubscriptionChannelId; label: string; status: string; fetchedAt: number | null; queriedAt: number | null;
  stale: boolean; source: 'native' | 'omp'; identityVerified: boolean;
  details: { id: string; valueKind: 'unlimited' | 'exhausted'; resetsAt: number | null; stale: boolean }[];
  windows: QuotaReportWindow[]; diagnostic: QuotaReadDiagnostic | null;
}
export interface QuotaReport {
  schemaVersion: 1; runtime: QuotaRuntimeSource | null; generatedAt: number | null;
  readAt: number;
  availability: 'ready' | 'missing' | 'invalid'; stale: boolean; providers: QuotaReportProvider[];
}
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const stamp = (value: unknown): number | null => number(value) && value > 0 && value < 253402300800 ? value : null;
const windowId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid quota snapshot');
  return value as Record<string, unknown>;
};
function enumValue<const T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error('invalid quota snapshot');
  return value as T;
}
function nullableNumber(value: unknown): number | null {
  if (value === null) return null;
  if (!number(value)) throw new Error('invalid quota snapshot');
  return value;
}
function nullableStamp(value: unknown): number | null {
  if (value === null) return null;
  if (stamp(value) === null) throw new Error('invalid quota snapshot');
  return value as number;
}
function diagnosis(value: unknown): QuotaReadDiagnostic | null {
  if (value == null) return null;
  const d = record(value);
  if (!Array.isArray(d.attempts) || d.attempts.length > 24 || stamp(d.queriedAt) === null || !number(d.durationMs) || d.durationMs < 0 || d.durationMs > 86400000) throw new Error('invalid quota snapshot');
  return { source: enumValue(d.source, ['native', 'omp']), code: d.code === null ? null : enumValue(d.code, QUOTA_DIAGNOSTIC_CODES),
    queriedAt: d.queriedAt as number, durationMs: d.durationMs, retainedFrom: d.retainedFrom === null ? null : enumValue(d.retainedFrom, ['cache', 'omp']),
    retryAt: nullableStamp(d.retryAt), attempts: d.attempts.map(item => {
      const a = record(item);
      if (a.httpStatus !== undefined && (!number(a.httpStatus) || !Number.isInteger(a.httpStatus) || a.httpStatus < 100 || a.httpStatus > 599)) throw new Error('invalid quota snapshot');
      return { stage: enumValue(a.stage, QUOTA_DIAGNOSTIC_STAGES), outcome: enumValue(a.outcome, ['success', 'failure', 'retained']),
        code: a.code === null ? null : enumValue(a.code, QUOTA_DIAGNOSTIC_CODES), ...(a.httpStatus === undefined ? {} : { httpStatus: a.httpStatus as number }) };
    }) };
}

/** Deliberately excludes preferences, account/profile labels, paths, errors and raw provider payloads. */
export function projectQuotaReport(state: QuotaState, runtime: QuotaRuntimeSource, now = Date.now() / 1000): QuotaReport {
  const providers: QuotaReportProvider[] = [];
  for (const p of state.providers.slice(0, 100)) {
    const provider = p.providerId ?? p.id.split('@')[0];
    if (!isSubscriptionChannelId(provider) || !new RegExp(`^${provider}(?:@[a-zA-Z0-9_-]{1,80})?$`).test(p.id)) continue;
    const stale = p.stale || p.fetchedAt === null || p.fetchedAt < now - QUOTA_REPORT_MAX_AGE || p.fetchedAt > now + 300;
    providers.push({ id: p.id, provider, label: SUBSCRIPTION_CHANNELS.find(c => c.id === provider)!.label,
      status: statuses.includes(p.status) ? p.status : 'unavailable', fetchedAt: stamp(p.fetchedAt), queriedAt: stamp(p.queriedAt), stale,
      source: p.provenance?.source === 'omp' ? 'omp' : 'native', identityVerified: p.provenance?.identityVerified === true,
      details: p.details.filter(d => windowId(d.id) && (d.valueKind === 'unlimited' || d.valueKind === 'exhausted')).slice(0, 128).map(d => ({ id: d.id,
        valueKind: d.valueKind as 'unlimited' | 'exhausted', resetsAt: stamp(d.resetsAt), stale: stale || d.resetsAt !== null && d.resetsAt <= now })),
      diagnostic: diagnosis(p.diagnostic), windows: p.windows.filter(w => windowId(w.id) && number(w.usedPercent)).slice(0, 128).map(w => {
        const periodSeconds = quotaWindowPeriodSeconds(w);
        const expired = w.resetsAt !== null && w.resetsAt <= now;
        const a = p.analyses[w.id];
        const monetary = provider === 'deepseek' || w.balance !== undefined;
        const forecast = !monetary && !stale && !expired && p.status === 'ready' && periodSeconds && w.analysisEligible !== false && a
          ? { etaAt: stamp(a.etaAt), paceDifference: number(a.paceDifference) ? a.paceDifference : null, paceBasis: a.paceBasis } : null;
        return { id: w.id, kind: monetary ? 'balance' : 'percentage', usedPercent: monetary ? null : Math.max(0, Math.min(100, w.usedPercent)),
          balance: monetary ? { currency: 'CNY', remaining: number(w.balance?.remaining) && w.balance!.remaining! >= 0 ? w.balance!.remaining! : null } : null,
          resetsAt: stamp(w.resetsAt), timeKind: w.timeKind === 'expiry' ? 'expiry' : 'reset', periodSeconds,
          stale: stale || expired, forecast };
      }) });
  }
  return { schemaVersion: 1, runtime, generatedAt: now, readAt: now, availability: 'ready', stale: false, providers };
}

/** Decode by whitelist, then recompute age without trusting persisted freshness. Throws on malformed data. */
export function parseQuotaReport(value: unknown, runtime: QuotaRuntimeSource, now = Date.now() / 1000): QuotaReport {
  const r = record(value);
  if (r.schemaVersion !== 1 || r.runtime !== runtime || r.availability !== 'ready' || !number(r.generatedAt) || r.generatedAt <= 0 || r.generatedAt > now + 300 || !Array.isArray(r.providers) || r.providers.length > 100) throw new Error('invalid quota snapshot');
  const stale = r.stale === true || r.generatedAt < now - QUOTA_REPORT_MAX_AGE;
  const providers = r.providers.map(item => {
    const p = record(item);
    if (!isSubscriptionChannelId(p.provider) || typeof p.id !== 'string' || !new RegExp(`^${p.provider}(?:@[a-zA-Z0-9_-]{1,80})?$`).test(p.id) || !Array.isArray(p.windows) || p.windows.length > 128 || !Array.isArray(p.details) || p.details.length > 128) throw new Error('invalid quota snapshot');
    const fetchedAt = nullableStamp(p.fetchedAt), queriedAt = nullableStamp(p.queriedAt);
    const providerStale = stale || p.stale === true || fetchedAt === null || fetchedAt < now - QUOTA_REPORT_MAX_AGE || fetchedAt > now + 300;
    const status = enumValue(p.status, statuses);
    return { id: p.id, provider: p.provider, label: SUBSCRIPTION_CHANNELS.find(c => c.id === p.provider)!.label, status,
      fetchedAt, queriedAt, stale: providerStale, source: enumValue(p.source, ['native', 'omp']), identityVerified: p.identityVerified === true,
      details: p.details.map(item => {
        const d = record(item); if (!windowId(d.id)) throw new Error('invalid quota snapshot');
        const resetsAt = nullableStamp(d.resetsAt);
        return { id: d.id, valueKind: enumValue(d.valueKind, ['unlimited', 'exhausted']), resetsAt,
          stale: providerStale || d.stale === true || resetsAt !== null && resetsAt <= now };
      }),
      diagnostic: diagnosis(p.diagnostic), windows: p.windows.map(item => {
        const w = record(item);
        const kind = enumValue(w.kind, ['percentage', 'balance']);
        if (!windowId(w.id) || (kind === 'percentage' ? !number(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100 : w.usedPercent !== null)) throw new Error('invalid quota snapshot');
        const balanceValue = kind === 'balance' ? record(w.balance) : null;
        const balance = balanceValue ? { currency: enumValue(balanceValue.currency, ['CNY']), remaining: nullableNumber(balanceValue.remaining) } : null;
        if (balance?.remaining !== null && balance?.remaining !== undefined && balance.remaining < 0) throw new Error('invalid quota snapshot');
        const resetsAt = nullableStamp(w.resetsAt), periodSeconds = nullableNumber(w.periodSeconds);
        if (periodSeconds !== null && (periodSeconds <= 0 || periodSeconds > 10 * 366 * 86400)) throw new Error('invalid quota snapshot');
        const windowStale = providerStale || w.stale === true || resetsAt !== null && resetsAt <= now;
        const f = w.forecast == null ? null : record(w.forecast);
        const forecast = kind === 'percentage' && f && !windowStale && periodSeconds !== null && status === 'ready' ? {
          etaAt: nullableStamp(f.etaAt), paceDifference: nullableNumber(f.paceDifference), paceBasis: enumValue(f.paceBasis, ['uniform', 'workdays', 'automatic']),
        } : null;
        return { id: w.id, kind, balance, usedPercent: w.usedPercent as number | null, resetsAt,
          timeKind: enumValue(w.timeKind, ['reset', 'expiry']), periodSeconds, stale: windowStale, forecast };
      }) };
  });
  return { schemaVersion: 1, runtime, generatedAt: r.generatedAt, readAt: now, availability: 'ready', stale, providers };
}

export function filterQuotaReport(report: QuotaReport, provider?: SubscriptionChannelId): QuotaReport {
  return provider ? { ...report, providers: report.providers.filter(p => p.provider === provider) } : report;
}
