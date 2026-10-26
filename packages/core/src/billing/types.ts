import type { PlatformCosts } from './openai-costs.js';
export interface BillingReport {
  platform: PlatformCosts; stale: boolean;
  local: { costUsd: number | null; knownCostUsd: number; estimatedCostUsd: number; reportedCostUsd: number;
    scope: 'all-local-agents'; fromTime: string; toTime: string;
    coverage: { limited: boolean; collectSince: string; lastSyncAt: string | null } };
  deepseek: { remaining: number | null; currency: 'cny'; fetchedAt: number | null; stale: boolean };
}
