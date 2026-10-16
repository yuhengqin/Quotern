import type { TokenTotals } from '../types.js';

export interface PendingCompaction {
  sessionId: string;
  model: string;
  project: string;
  timestamp: string;
  usage: TokenTotals;
  threadUsage?: TokenTotals | null;
  ledgerCoveredTokens?: number;
}
export interface CodexCompactionState {
  pending: Record<string, PendingCompaction>;
  markers: string[];
  settled: Record<string, { tokens: number; standalone: boolean; sessions: string[] }>;
  latest: Record<string, string>;
}
export function emptyCompactionState(): CodexCompactionState {
  return { pending: {}, markers: [], settled: {}, latest: {} };
}
export function sameUsage(a: TokenTotals | null | undefined, b: TokenTotals | null | undefined): boolean {
  if (!a || !b) return false;
  return (['input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_creation_input_tokens', 'reasoning_output_tokens'] as const)
    .every((field) => (a[field] ?? 0) === (b[field] ?? 0));
}
export function settleCompaction(state: CodexCompactionState, id: string, standalone: boolean): PendingCompaction | null {
  const pending = state.pending[id];
  if (!pending || state.settled[id]) return null;
  state.settled[id] = { tokens: pending.usage.total_tokens, standalone, sessions: [pending.sessionId] };
  delete state.pending[id];
  return pending;
}
export function compactionLifetime(state: CodexCompactionState, sessionId: string): number {
  return Object.values(state.settled).reduce((sum, item) => sum + (item.standalone && item.sessions.includes(sessionId) ? item.tokens : 0), 0);
}

/** Conservative overlap accounting: the ledger has no response IDs or token breakdown. */
export function allocateLedgerCoverage(state: CodexCompactionState, sessionId: string, gap: number): void {
  let remaining = gap;
  for (const pending of Object.values(state.pending)) {
    if (pending.sessionId !== sessionId || remaining <= 0) continue;
    const covered = pending.ledgerCoveredTokens ?? 0;
    const allocation = Math.min(remaining, Math.max(0, pending.usage.total_tokens - covered));
    pending.ledgerCoveredTokens = covered + allocation;
    remaining -= allocation;
  }
}

/** A partial overlap cannot retain a trustworthy field split or request count. */
export function uncoveredUsage(usage: TokenTotals, covered: number): TokenTotals | null {
  if (covered <= 0) return usage;
  const remaining = Math.max(0, usage.total_tokens - covered);
  if (!remaining) return null;
  return {
    input_tokens: remaining, output_tokens: 0, cached_input_tokens: 0,
    cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
    total_tokens: remaining, conversation_count: 0, token_quality: 'ledger',
  };
}
