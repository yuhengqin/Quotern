export type BillingSource = 'extra' | 'console';
export type BillingError = 'BILLING_AUTH' | 'BILLING_CHALLENGE' | 'BILLING_RATE_LIMIT' | 'BILLING_NETWORK' | 'BILLING_HTTP' | 'BILLING_INVALID_RESPONSE' | 'BILLING_RESPONSE_TOO_LARGE' | 'BILLING_CURRENCY';
export interface BillingOrganization { id: string; name: string }
export interface BillingSection<T> { data: T | null; observedAt: number | null; stale: boolean; error: BillingError | null }
export interface ExtraSpend { enabled: boolean | null; usedUsd: number | null; limitUsd: number | null }
export interface ExtraGrants { remainingUsd: number | null; grantedUsd: number | null }
export interface ConsoleSpend { usd: number | null; resetsAt: string | null }
export interface ConsoleCostRow { day: string; model: string | null; keyId: string | null; keyName: string | null; usd: number | null }
export interface ConsoleDetails { from: string; until: string; totalUsd: number | null; complete: boolean; unknownRows: number; rows: ConsoleCostRow[] }
export interface BillingReport {
  attemptedAt: number;
  spend?: BillingSection<ExtraSpend>; grants?: BillingSection<ExtraGrants>;
  currentSpend?: BillingSection<ConsoleSpend>; prepaid?: BillingSection<{ usd: number | null }>;
  details?: BillingSection<ConsoleDetails>;
}
export interface BillingConnectionView { revision: string; organization: BillingOrganization | null; report: BillingReport | null; error?: 'BILLING_STORAGE' }
export interface BillingView { token: string; connections: Record<BillingSource, BillingConnectionView> }
