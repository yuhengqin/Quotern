import type { SubscriptionChannelId } from './subscription-channels.js';

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
  used?: number;
  limit?: number;
  unit?: 'tokens' | 'requests' | 'credits';
  valueText?: string;
  analysisEligible?: boolean;
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
  label: string;
  status: string;
  planLabel: string | null;
  fetchedAt: number | null;
  /** Latest completed reader query, including cached readings and failures. */
  queriedAt: number | null;
  stale: boolean;
  message: string | null;
  windows: QuotaWindow[];
  details: { id: string; label: string; text: string; resetsAt: number | null }[];
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
