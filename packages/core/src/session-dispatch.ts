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
interface SessionStart { identity: string; timestamp: number }
export interface SessionDispatchIndex {
  sessions: Map<string, SessionActivity>;
  starts: Map<string, SessionStart[]>;
}
const projectKey = (source: string, project: string) => JSON.stringify([source, project]);

/** Build once for an enrichment pass, rather than scanning all evidence per row. */
export function createSessionDispatchIndex(evidence: readonly SessionEvidence[], candidates: readonly SessionActivity[]): SessionDispatchIndex {
  const sessions = new Map<string, SessionActivity>(), starts = new Map<string, SessionStart[]>();
  for (const candidate of candidates) if (!sessions.has(key(candidate))) sessions.set(key(candidate), candidate);
  for (const event of evidence) {
    if (event.kind !== 'metadata' || !event.sessionStart || !event.projectKey) continue;
    const timestamp = Date.parse(event.timestamp);
    if (!Number.isFinite(timestamp)) continue;
    const id = projectKey(event.source, event.projectKey), group = starts.get(id) ?? [];
    group.push({ identity: key(event), timestamp }); starts.set(id, group);
  }
  for (const group of starts.values()) group.sort((a, b) => a.timestamp - b.timestamp);
  return { sessions, starts };
}

function inferredTarget(index: SessionDispatchIndex, source: string, project: string, timestamp: string): SessionActivity | undefined {
  const starts = index.starts.get(projectKey(source, project));
  const time = Date.parse(timestamp);
  if (!starts || !Number.isFinite(time)) return;
  let low = 0, high = starts.length;
  while (low < high) { const middle = (low + high) >>> 1; if (starts[middle]!.timestamp < time) low = middle + 1; else high = middle; }
  let match: string | undefined;
  for (let i = low; i < starts.length && starts[i]!.timestamp <= time + 120000; i++) {
    const id = starts[i]!.identity;
    if (match !== undefined && match !== id) return;
    match = id;
  }
  return match === undefined ? undefined : index.sessions.get(match);
}

/** Links are separate from the lineage totals: a resumed task can be dispatched more than once. */
export function sessionDispatches(row: SessionActivity, events: readonly SessionEvidence[], allEvidence: readonly SessionEvidence[], candidates: readonly SessionActivity[], index = createSessionDispatchIndex(allEvidence, candidates)): SessionDispatch[] {
  const links = new Map<string, SessionDispatch>();
  const results = new Map(events.filter(event => event.kind === 'tool-result').map(event => [event.id.replace(/^tool-result:/, ''), event.operation]));
  for (const event of events) {
    const operation = event.operation;
    if (!operation?.dispatchSource || operation.dispatchSource === row.source) continue;
    const targetId = operation.dispatchSessionId ?? results.get(event.id.replace(/^tool:/, ''))?.dispatchSessionId;
    let target: SessionActivity | undefined;
    if (targetId) target = index.sessions.get(key({ source: operation.dispatchSource, sessionId: targetId }));
    else if (operation.projectKey) {
      target = inferredTarget(index, operation.dispatchSource, operation.projectKey, event.timestamp);
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
