import type { SessionEvidence } from './session-insights.js';
import type { SessionActivity } from './session-observation.js';
import { localDateAndHour } from './timezone.js';
import { inTimeBounds, type UsageBounds } from './usage-window.js';

export interface PerformanceMetrics {
  sessionCount: number;
  ttftSampleCount: number;
  speedSampleCount: number;
  ttftP50Ms: number | null;
  ttftP95Ms: number | null;
  tokensPerSecond: number | null;
}
export interface PerformanceSample {
  id: string; source: string; sessionId: string; sessionTitle?: string;
  model: string; project: string; timestamp: string;
  ttftMs: number | null; outputTokens: number | null; durationMs: number | null;
  tokensPerSecond: number | null;
}
export type PerformanceGroup = 'model' | 'source' | 'project';
export interface PerformanceFilters { model?: string; project?: string; groupBy?: PerformanceGroup }
export interface PerformanceReport {
  range: UsageBounds;
  summary: PerformanceMetrics;
  groups: Array<PerformanceMetrics & { label: string }>;
  trend: Array<PerformanceMetrics & { date: string }>;
  samples: PerformanceSample[];
  sampleCount: number;
  facets: { sources: string[]; models: string[]; projects: string[] };
  kind: 'local-samples';
}
type SessionLabel = Pick<SessionActivity, 'source' | 'sessionId' | 'projectLabel' | 'sessionTitle'>;
const identity = (source: string, sessionId: string) => JSON.stringify([source, sessionId]);
const finite = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Raw observations only: TTFT records and throughput estimates are separate sample sets. */
export function buildPerformanceReport(
  evidence: readonly SessionEvidence[], sessions: readonly SessionLabel[],
  options: UsageBounds & PerformanceFilters & { sources?: readonly string[]; timeZone?: string },
): PerformanceReport {
  const labels = new Map(sessions.map(row => [identity(row.source, row.sessionId), row]));
  const unique = new Map<string, SessionEvidence>();
  for (const event of evidence) {
    const key = JSON.stringify([event.source, event.sessionId, event.id]);
    const previous = unique.get(key);
    if (!previous || Date.parse(event.timestamp) >= Date.parse(previous.timestamp)) unique.set(key, event);
  }
  const parents = new Map<string, string>();
  for (const event of unique.values()) if (event.kind === 'metadata' && event.relationKind === 'fork' && !event.relationConflict && event.parentId) parents.set(identity(event.source, event.sessionId), event.parentId);
  const lineages = new Map<string, { root: string; depth: number }>();
  const lineage = (source: string, sessionId: string) => {
    const key = identity(source, sessionId), cached = lineages.get(key);
    if (cached) return cached;
    const visited = new Set<string>(); let current = sessionId;
    while (parents.has(identity(source, current)) && !visited.has(current)) {
      visited.add(current); current = parents.get(identity(source, current))!;
    }
    const value = { root: visited.has(current) ? [...visited].sort()[0]! : current, depth: visited.size };
    lineages.set(key, value); return value;
  };
  const requests = [...unique.values()].filter(event => event.kind === 'request').sort((a, b) =>
    lineage(a.source, a.sessionId).depth - lineage(b.source, b.sessionId).depth || a.sessionId.localeCompare(b.sessionId) || a.id.localeCompare(b.id));
  const inherited = new Set<string>();
  const available: PerformanceSample[] = [];
  for (const event of requests) {
    if (!Number.isFinite(Date.parse(event.timestamp))) continue;
    const key = JSON.stringify([event.source, lineage(event.source, event.sessionId).root, event.id, event.timestamp]);
    if (inherited.has(key)) continue;
    inherited.add(key);
    if (options.sources?.length && !options.sources.includes(event.source) || !inTimeBounds(event.timestamp, options)) continue;
    const date = localDateAndHour(event.timestamp, options.timeZone).date;
    if (options.fromDate && date < options.fromDate || options.toDate && date > options.toDate) continue;
    const ttftMs = finite(event.ttftMs) ? event.ttftMs : null;
    // Keep the collector's eligibility threshold even when reading older/corrupted caches.
    const speed = finite(event.outputTokens) && event.outputTokens >= 200 && finite(event.durationMs) && event.durationMs >= 1000 && event.durationMs <= 3600000;
    if (ttftMs === null && !speed) continue;
    const label = labels.get(identity(event.source, event.sessionId));
    available.push({ id: event.id, source: event.source, sessionId: event.sessionId, sessionTitle: label?.sessionTitle,
      model: event.model || 'unknown', project: label?.projectLabel || 'unknown', timestamp: event.timestamp, ttftMs,
      outputTokens: speed ? event.outputTokens! : null, durationMs: speed ? event.durationMs! : null,
      tokensPerSecond: speed ? event.outputTokens! * 1000 / event.durationMs! : null });
  }
  const selected = available.filter(row => (!options.model || row.model === options.model) && (!options.project || row.project === options.project));
  const grouped = new Map<string, PerformanceSample[]>(), dates = new Map<string, PerformanceSample[]>();
  for (const row of selected) {
    const label = row[options.groupBy ?? 'model'];
    const group = grouped.get(label) ?? []; group.push(row); grouped.set(label, group);
    const date = localDateAndHour(row.timestamp, options.timeZone).date;
    const day = dates.get(date) ?? []; day.push(row); dates.set(date, day);
  }
  const facet = (key: 'source' | 'model' | 'project') => [...new Set(available.map(row => row[key]))].sort();
  return { range: { fromDate: options.fromDate, toDate: options.toDate, fromTime: options.fromTime, toTime: options.toTime }, kind: 'local-samples',
    summary: metrics(selected), sampleCount: selected.length,
    groups: [...grouped].map(([label, rows]) => ({ label, ...metrics(rows) })).sort((a, b) => (b.ttftSampleCount + b.speedSampleCount) - (a.ttftSampleCount + a.speedSampleCount) || a.label.localeCompare(b.label)),
    trend: [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => ({ date, ...metrics(rows) })),
    samples: selected.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || a.id.localeCompare(b.id)).slice(0, 100),
    facets: { sources: facet('source'), models: facet('model'), projects: facet('project') } };
}

function metrics(samples: readonly PerformanceSample[]): PerformanceMetrics {
  const ttft = samples.flatMap(row => row.ttftMs === null ? [] : [row.ttftMs]).sort((a, b) => a - b);
  const speeds = samples.filter(row => row.durationMs !== null && row.outputTokens !== null);
  const duration = speeds.reduce((sum, row) => sum + row.durationMs!, 0);
  const quantile = (p: number) => ttft.length ? ttft[Math.max(0, Math.ceil(ttft.length * p) - 1)]! : null;
  return { sessionCount: new Set(samples.map(row => identity(row.source, row.sessionId))).size,
    ttftSampleCount: ttft.length, speedSampleCount: speeds.length,
    ttftP50Ms: quantile(0.5), ttftP95Ms: quantile(0.95),
    tokensPerSecond: duration ? speeds.reduce((sum, row) => sum + row.outputTokens!, 0) * 1000 / duration : null };
}
