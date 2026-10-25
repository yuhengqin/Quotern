import type { SubscriptionChannelId } from './subscription-channels.js';
import type { QuotaReadDiagnostic } from './quota-diagnostic.js';

export type QuotaPaceModel = 'uniform' | 'workdays' | 'automatic';
export interface QuotaProfile {
  id: string;
  provider: 'codex' | 'claude';
  label: string;
  directory: string;
  enabled: boolean;
  alerts?: boolean;
}
export interface QuotaProvenance {
  source: 'native' | 'omp';
  observer: string;
  observedAt: number | null;
  identityVerified: boolean;
  accountRef?: string;
}
export interface QuotaWindow {
  id: string;
  label: string;
  groupLabel?: string;
  usedPercent: number;
  resetsAt: number | null;
  timeKind?: 'reset' | 'expiry';
  durationSeconds?: number | null;
  /** Semantic cycle length for display and ordering; independent of label language. */
  periodSeconds?: number | null;
  used?: number;
  limit?: number;
  unit?: 'tokens' | 'requests' | 'credits';
  valueText?: string;
  /** Structured monetary balance; the legacy ring percentage is not a quota ratio. */
  balance?: { currency: 'CNY'; remaining: number | null };
  analysisEligible?: boolean;
}
/** Resolve cycle length from explicit metadata, numeric duration, or a stable period ID. */
export function quotaWindowPeriodSeconds(window: QuotaWindow): number | null {
  if (typeof window.periodSeconds === 'number' && Number.isFinite(window.periodSeconds) && window.periodSeconds > 0) return window.periodSeconds;
  if (typeof window.durationSeconds === 'number' && Number.isFinite(window.durationSeconds) && window.durationSeconds > 0) return window.durationSeconds;
  const periods: Record<string, number> = {
    monthly: 31 * 86400, limit_month_total: 31 * 86400,
    weekly: 7 * 86400, 'seven-day': 7 * 86400, limit_7d: 7 * 86400,
    daily: 86400, 'five-hour': 18000, five_hour: 18000, limit_5h: 18000,
    session: 18000,
  };
  if (Object.hasOwn(periods, window.id)) return periods[window.id];
  const coded = /^(\d+(?:\.\d+)?)([hd])$/i.exec(window.id);
  if (coded) return Number(coded[1]) * (coded[2].toLowerCase() === 'h' ? 3600 : 86400);
  const numericSuffix = /^(?:account|feature:.+):(\d+)$/.exec(window.id);
  return numericSuffix ? Number(numericSuffix[1]) || null : null;
}
export interface QuotaSample { at: number; usedPercent: number; resetsAt: number | null }
export interface QuotaAnalysis {
  paceDifference: number | null;
  paceBasis: QuotaPaceModel;
  etaAt: number | null;
  trend: QuotaSample[];
}
export interface QuotaServiceStatus {
  level: 'operational' | 'minor' | 'major' | 'critical' | 'maintenance' | 'unknown';
  checkedAt: number | null;
  stale: boolean;
  url: string;
}
export interface QuotaProviderState {
  id: string;
  providerId?: string;
  profileLabel?: string;
  provenance?: QuotaProvenance;
  diagnostic?: QuotaReadDiagnostic;
  label: string;
  status: string;
  planLabel: string | null;
  fetchedAt: number | null;
  /** Latest completed reader query, including cached readings and failures. */
  queriedAt: number | null;
  stale: boolean;
  message: string | null;
  windows: QuotaWindow[];
  details: { id: string; label: string; text: string; valueKind?: 'unlimited' | 'exhausted'; resetsAt: number | null }[];
  resetCredits: number | null;
  refreshing: boolean;
  nextRefreshAt: number | null;
  analyses: Record<string, QuotaAnalysis>;
  service: QuotaServiceStatus | null;
}
export interface QuotaPreferences {
  profiles?: QuotaProfile[];
  thresholdAlerts: boolean;
  resetAlerts: boolean;
  showSparkline: boolean;
  paceModel: QuotaPaceModel;
  channels: Partial<Record<SubscriptionChannelId, boolean>>;
}
export const DEFAULT_QUOTA_PREFERENCES: QuotaPreferences = {
  thresholdAlerts: true, resetAlerts: true, showSparkline: true, paceModel: 'uniform', channels: {},
};
export interface QuotaState {
  providers: QuotaProviderState[];
  preferences: QuotaPreferences;
  notice: string | null;
}
export type QuotaPreferencePatch = Partial<QuotaPreferences>;
export const QUOTA_GET = 'quota:get';
export const QUOTA_REFRESH = 'quota:refresh';
export const QUOTA_SET = 'quota:set';
export const QUOTA_CHANGED = 'quota:changed';
