// Observed model totals and timestamps from the 2026-10-17 seven-day query
// (chat 01a149bc-8c89-7711-bac9-da12ff44e4a6). No conversations or projects.
export const sessionModelTotals = [
  ['codex', 'gpt-6.1-sol', 940750848],
  ['codex', 'gpt-6-sol', 350650657],
  ['codex', 'gpt-6-astra', 273866793],
  ['codex', 'gpt-6-luna', 52596094],
  ['zcode', 'glm-5.3', 6866247],
  ['opencode', 'mimo-v2.6-flash-free', 4924031],
  ['zcode', 'glm-5.3-flash', 3179363],
  ['opencode', 'deepseek-v4.1-flash-free', 2891290],
  ['claude', 'deepseek-v4-pro', 1521431],
  ['claude', 'deepseek-flash', 886449],
  ['opencode', 'glm-5.3-flash-free', 246461],
  ['antigravity', 'gemini-3.8-flash', 223303],
];

export const sessionContext = {
  collectSince: '2026-01-01T00:00:00Z',
  lastSyncAt: '2026-10-17T08:55:21.344Z',
  now: new Date('2026-10-17T12:03:01.386Z'),
  snapshot: 'persisted',
};

// Synthetic buckets reproduce observed totals, not the original event, token
// component, per-model quality or pricing breakdown. The ledger allocation and
// collection start are test scaffolding; only aggregate quality counts are known.
export function sessionBuckets() {
  const rows = sessionModelTotals.map(([source, model, tokens]) => ({
    source, model, project: 'Regression', hour_start: '2026-10-17T08:00:00Z',
    input_tokens: tokens, output_tokens: 0, cached_input_tokens: 0,
    cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
    total_tokens: tokens, conversation_count: 0,
  }));
  rows[0].input_tokens -= 6716020;
  rows[0].total_tokens -= 6716020;
  rows.push({ ...rows[0], collector: 'codex-ledger', hour_start: '2026-10-17T08:30:00Z', input_tokens: 6716020, total_tokens: 6716020 });
  return rows;
}
