import type { CodexSubscriptionSnapshot } from '../../shared/codex-subscription';

export interface CodexSubscriptionState {
  snapshot: CodexSubscriptionSnapshot | null;
  lastUpdatedAt: number | null;
}

export const INITIAL_CODEX_SUBSCRIPTION_STATE: CodexSubscriptionState = {
  snapshot: null,
  lastUpdatedAt: null,
};

/** The main process owns account-aware caching; the renderer never merges allowances. */
export function updateCodexSubscriptionState(
  _previous: CodexSubscriptionState,
  snapshot: CodexSubscriptionSnapshot,
  _now: number,
): CodexSubscriptionState {
  if (!snapshot.hasAccount) return INITIAL_CODEX_SUBSCRIPTION_STATE;
  return {
    snapshot,
    lastUpdatedAt: snapshot.fetchedAt === null ? null : snapshot.fetchedAt * 1000,
  };
}
