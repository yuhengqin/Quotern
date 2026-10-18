import { addLocalDays, DEFAULT_STATS_TIMEZONE, localDateAndHour } from './timezone.js';
import type { SessionMessage, SessionMetricOptions } from './session-metrics.js';

/** Execution clocks only; never stores message, reasoning or tool content. */
export interface SessionTimingEvent {
  source: string;
  sessionId: string;
  id: string;
  kind: 'user' | 'activity' | 'task-start' | 'task-end' | 'task-abort';
  timestamp: string;
  startTimestamp?: string;
  turnId?: string;
  durationMs?: number;
  seq?: number;
}

export interface TaskTimingMetrics {
  taskSeconds: number | null;
  taskTimingKind: 'recorded' | 'estimated' | 'mixed' | 'empty' | 'unavailable';
  estimatedTaskSources: string[];
  missingTaskSources: string[];
}

/** Find local midnight without assuming a fixed UTC offset or a 24-hour DST day. */
function midnight(date: string, timeZone: string): number {
  const utc = Date.parse(`${date}T00:00:00Z`);
  let low = utc - 36 * 3600000, high = utc + 36 * 3600000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (localDateAndHour(new Date(mid), timeZone).date < date) low = mid;
    else high = mid;
  }
  return high;
}

const validDuration = (event: SessionTimingEvent): boolean => typeof event.durationMs === 'number' && Number.isFinite(event.durationMs) && event.durationMs >= 0;
const sessionKey = (event: Pick<SessionTimingEvent, 'source' | 'sessionId'>) => JSON.stringify([event.source, event.sessionId]);
function turnKey(event: SessionTimingEvent): string {
  // Real Codex turn UUIDs survive copied/forked rollouts. Legacy labels are not globally unique.
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(event.turnId ?? '')
    ? `codex:${event.turnId}` : JSON.stringify([event.source, event.sessionId, event.turnId]);
}

/** Keep a shared Codex turn on its original session before per-session grouping. */
export function attributeTaskTimingEvents(events: readonly SessionTimingEvent[], parents: ReadonlyMap<string, string> = new Map()): SessionTimingEvent[] {
  const turns = new Map<string, SessionTimingEvent[]>();
  for (const event of events) {
    if (event.source !== 'codex' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(event.turnId ?? '')) continue;
    const rows = turns.get(event.turnId!) ?? []; rows.push(event); turns.set(event.turnId!, rows);
  }
  const owners = new Map<string, string>();
  for (const [turn, rows] of turns) {
    const candidates = new Set(rows.map(row => row.sessionId));
    const ancestor = (id: string) => {
      const seen = new Set<string>(); let current = id;
      while (parents.has(current) && !seen.has(current)) {
        seen.add(current); current = parents.get(current)!;
        if (candidates.has(current)) return current;
      }
      return id;
    };
    const root = [...rows].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.sessionId.localeCompare(b.sessionId))[0]!;
    let owner = root.sessionId, seen = new Set<string>();
    while (!seen.has(owner)) { seen.add(owner); const next = ancestor(owner); if (next === owner) break; owner = next; }
    owners.set(turn, owner);
  }
  return events.map(event => event.source === 'codex' && owners.has(event.turnId ?? '') ? { ...event, sessionId: owners.get(event.turnId!)! } : event);
}

export function aggregateTaskTiming(
  messages: readonly SessionMessage[],
  timingEvents: readonly SessionTimingEvent[],
  options: SessionMetricOptions,
): TaskTimingMetrics {
  const selected = options.sources?.length ? new Set(options.sources) : null;
  const zone = options.timeZone ?? DEFAULT_STATS_TIMEZONE;
  const from = options.fromDate ? midnight(options.fromDate, zone) : -Infinity;
  const to = options.toDate ? midnight(addLocalDays(options.toDate, 1), zone) : Infinity;
  const events = timingEvents.filter(e => (!selected || selected.has(e.source)) && Number.isFinite(Date.parse(e.timestamp)));
  const eventGroups = new Set(events.map(sessionKey));
  const codexMessageGroups = new Set<string>();
  const missing = new Set((options.missingSources ?? []).filter(s => !selected || selected.has(s)));
  // Old metadata for removed raw files remains useful; non-Codex message clocks can still estimate it.
  for (const message of messages) {
    if (selected && !selected.has(message.source)) continue;
    if (message.source === 'codex') {
      const stamp = Date.parse(message.timestamp);
      if (stamp >= from && stamp < to) codexMessageGroups.add(sessionKey(message));
    } else if (!eventGroups.has(sessionKey(message))) {
      events.push({ ...message, kind: message.role === 'user' ? 'user' : 'activity' });
    }
  }
  let recordedMs = 0, estimatedMs = 0, recordedCount = 0, estimatedCount = 0;
  const estimatedSources = new Set<string>();
  const add = (start: number, end: number, source: string, recorded: boolean) => {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end < from || start >= to) return;
    const span = Math.max(0, Math.min(end, to) - Math.max(start, from));
    if (recorded) { recordedMs += span; recordedCount++; }
    else { estimatedMs += span; estimatedCount++; estimatedSources.add(source); }
  };
  const starts = new Map<string, SessionTimingEvent>(), ends = new Map<string, SessionTimingEvent>();
  const turnGroups = new Map<string, Set<string>>();
  const coveredCodexGroups = new Set<string>();
  for (const event of events) {
    if (event.source !== 'codex' || !event.turnId) continue;
    const key = turnKey(event);
    const aliases = turnGroups.get(key) ?? new Set<string>();
    aliases.add(sessionKey(event)); turnGroups.set(key, aliases);
    if (event.kind === 'task-start') {
      const previous = starts.get(key);
      if (!previous || event.timestamp < previous.timestamp) starts.set(key, event);
    } else if (event.kind === 'task-end' || event.kind === 'task-abort') {
      const previous = ends.get(key);
      if (!previous || (validDuration(event) && !validDuration(previous))
        || (validDuration(event) === validDuration(previous) && event.timestamp > previous.timestamp)) ends.set(key, event);
    }
  }
  for (const [key, event] of ends) {
    const end = Date.parse(event.timestamp);
    const start = validDuration(event) ? end - event.durationMs! : Date.parse(starts.get(key)?.timestamp ?? event.startTimestamp ?? '');
    if (!Number.isFinite(start) || start > end) {
      if (end >= from && end < to) missing.add('codex');
      continue;
    }
    if (end >= from && start < to) {
      for (const group of turnGroups.get(key) ?? []) coveredCodexGroups.add(group);
    }
    add(start, end, 'codex', true);
  }
  // Pending Codex turns have no terminal duration and are not completed tasks.
  for (const [key, event] of starts) {
    const stamp = Date.parse(event.timestamp);
    if (!ends.has(key) && stamp >= from && stamp < to) {
      for (const group of turnGroups.get(key) ?? []) coveredCodexGroups.add(group);
    }
  }
  for (const group of codexMessageGroups) if (!coveredCodexGroups.has(group)) missing.add('codex');
  const groups = new Map<string, SessionTimingEvent[]>();
  for (const event of events) {
    if (event.source === 'codex' || !['user', 'activity'].includes(event.kind)) continue;
    const key = sessionKey(event), rows = groups.get(key) ?? [];
    rows.push(event); groups.set(key, rows);
  }
  for (const rows of groups.values()) {
    rows.sort((a, b) => Date.parse(a.startTimestamp ?? a.timestamp) - Date.parse(b.startTimestamp ?? b.timestamp)
      || (a.kind === b.kind ? 0 : a.kind === 'user' ? -1 : 1));
    let start: number | null = null, end: number | null = null;
    const finish = () => { if (start !== null && end !== null) add(start, end, rows[0]!.source, false); };
    for (const event of rows) {
      const stamp = Date.parse(event.timestamp);
      if (event.kind === 'user') { finish(); start = stamp; end = null; }
      else {
        start ??= Date.parse(event.startTimestamp ?? event.timestamp);
        end = Math.max(end ?? start, stamp);
      }
    }
    finish();
  }
  const unknown = recordedCount + estimatedCount === 0 && missing.size > 0;
  return {
    taskSeconds: unknown ? null : Math.round((recordedMs + estimatedMs) / 1000),
    taskTimingKind: unknown ? 'unavailable' : recordedCount && estimatedCount ? 'mixed' : recordedCount ? 'recorded' : estimatedCount ? 'estimated' : 'empty',
    estimatedTaskSources: [...estimatedSources].sort(),
    missingTaskSources: [...missing].sort(),
  };
}
