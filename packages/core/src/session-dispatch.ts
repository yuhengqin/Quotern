import type { SessionEvidence } from './session-insights.js';
import type { SessionActivity } from './session-observation.js';

export interface SessionDispatch {
  source: string;
  sessionId: string;
  sessionTitle?: string;
  evidence: 'recorded' | 'inferred';
  observedAt: string;
  tokens: number | null;
  costUsd: number | null;
  knownCostUsd: number;
  costKind: SessionActivity['costKind'];
}
const key = (row: { source: string; sessionId: string }) => JSON.stringify([row.source, row.sessionId]);

/** Links are separate from the lineage totals: a resumed task can be dispatched more than once. */
export function sessionDispatches(row: SessionActivity, events: readonly SessionEvidence[], allEvidence: readonly SessionEvidence[], candidates: readonly SessionActivity[]): SessionDispatch[] {
  const links = new Map<string, SessionDispatch>();
  const results = new Map(events.filter(event => event.kind === 'tool-result').map(event => [event.id.replace(/^tool-result:/, ''), event.operation]));
  const starts = allEvidence.filter(event => event.kind === 'metadata' && event.sessionStart && event.projectKey);
  for (const event of events) {
    const operation = event.operation;
    if (!operation?.dispatchSource || operation.dispatchSource === row.source) continue;
    const targetId = operation.dispatchSessionId ?? results.get(event.id.replace(/^tool:/, ''))?.dispatchSessionId;
    let target: SessionActivity | undefined;
    if (targetId) target = candidates.find(candidate => candidate.source === operation.dispatchSource && candidate.sessionId === targetId);
    else if (operation.projectKey) {
      const matches = new Set(starts.filter(start => start.source === operation.dispatchSource && start.projectKey === operation.projectKey
        && Date.parse(start.timestamp) >= Date.parse(event.timestamp) && Date.parse(start.timestamp) - Date.parse(event.timestamp) <= 120000).map(key));
      // Count all candidates, including those outside a paginated detail response.
      if (matches.size === 1) target = candidates.find(candidate => matches.has(key(candidate)));
    }
    if (!target) continue;
    const existing = links.get(key(target));
    if (existing?.evidence === 'recorded') continue;
    links.set(key(target), { source: target.source, sessionId: target.sessionId, sessionTitle: target.sessionTitle, evidence: targetId ? 'recorded' : 'inferred', observedAt: event.timestamp,
      tokens: target.tokens, costUsd: target.unallocatedCostUsd == null && target.models?.some(model => model.costUsd === null) ? null : target.costUsd,
      knownCostUsd: target.costUsd ?? 0, costKind: target.costKind });
  }
  return [...links.values()].slice(0, 50);
}
