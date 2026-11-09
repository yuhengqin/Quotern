import type { QuotaProviderState, QuotaWindow } from './quota';

/** Pick the tightest quota among the first available prioritized account, or across all accounts. */
export function selectTrayQuota(
  providers: QuotaProviderState[],
  { now = -Infinity, providerOrder = [] }: { now?: number; providerOrder?: string[] } = {},
): { provider: QuotaProviderState; window: QuotaWindow } | undefined {
  const windows = providers.filter(provider => provider.status === 'ready' && !provider.stale)
    .flatMap(provider => provider.windows
      .filter(window => window.analysisEligible !== false && !window.balance && Number.isFinite(window.usedPercent)
        && (window.resetsAt === null || window.resetsAt > now))
      .map(window => ({ provider, window })))
    .sort((a, b) => b.window.usedPercent - a.window.usedPercent);
  for (const id of providerOrder) {
    const match = windows.find(({ provider }) => provider.id === id);
    if (match) return match;
  }
  return windows[0];
}
