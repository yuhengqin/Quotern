import { DEFAULT_STATS_TIMEZONE, localDateAndHour } from './timezone.js';
import { aggregateTaskTiming, type SessionTimingEvent, type TaskTimingMetrics } from './task-timing.js';

/** Local accounting metadata only: no prompt, response or tool content. */
export interface SessionMessage {
  source: string;
  sessionId: string;
  id: string;
  role: 'user' | 'assistant';
  timestamp: string;
  /** Local-only path identity. Full project paths are never persisted here. */
  projectId?: string;
  projectLabel?: string;
}

export interface SessionMetrics extends TaskTimingMetrics {
  sessionCount: number;
  messageCount: number;
  durationSeconds: number;
  /** Legacy assistant-record span estimate. The task duration card uses taskSeconds. */
  activeSeconds: number | null;
  complete: boolean;
  missingSources: string[];
}

export interface SessionMetricOptions {
  fromDate?: string;
  toDate?: string;
  sources?: readonly string[];
  missingSources?: readonly string[];
  timeZone?: string;
  timingEvents?: readonly SessionTimingEvent[];
}

/** Assistant timestamps approximate a turn, including any tool waits between records. */
function estimateActiveSeconds(messages: readonly SessionMessage[]): number {
  const ordered = messages.map((message) => ({ role: message.role, stamp: Date.parse(message.timestamp) }))
    .sort((a, b) => a.stamp - b.stamp || (a.role === b.role ? 0 : a.role === 'user' ? -1 : 1));
  let activeSeconds = 0;
  let turnStart: number | null = null;
  let turnEnd = 0;
  for (const message of ordered) {
    if (message.role === 'user') {
      if (turnStart !== null) activeSeconds += Math.round((turnEnd - turnStart) / 1000);
      turnStart = null;
    } else {
      // A date filter can leave only the assistant portion of the first turn.
      turnStart ??= message.stamp;
      turnEnd = message.stamp;
    }
  }
  if (turnStart !== null) activeSeconds += Math.round((turnEnd - turnStart) / 1000);
  return activeSeconds;
}

/** Distinct sessions are counted over the whole range, never summed by day. */
export function aggregateSessionMetrics(
  messages: readonly SessionMessage[],
  options: SessionMetricOptions = {},
): SessionMetrics {
  const selected = options.sources?.length ? new Set(options.sources) : null;
  const unique = new Map<string, SessionMessage>();
  for (const message of messages) {
    if (selected && !selected.has(message.source)) continue;
    if (!message.id || !message.sessionId || !Number.isFinite(Date.parse(message.timestamp))) continue;
    const key = JSON.stringify([message.source, message.sessionId, message.id]);
    const previous = unique.get(key);
    // Repeated stream snapshots describe one logical message. Its final record
    // supplies the message time; it never increments the logical count again.
    if (!previous || message.timestamp > previous.timestamp) unique.set(key, message);
  }
  const sessions = new Map<string, { first: number; last: number; messages: SessionMessage[] }>();
  for (const message of unique.values()) {
    const date = localDateAndHour(message.timestamp, options.timeZone ?? DEFAULT_STATS_TIMEZONE).date;
    if (options.fromDate && date < options.fromDate) continue;
    if (options.toDate && date > options.toDate) continue;
    const key = JSON.stringify([message.source, message.sessionId]);
    const stamp = Date.parse(message.timestamp);
    const session = sessions.get(key) ?? { first: stamp, last: stamp, messages: [] };
    session.first = Math.min(session.first, stamp);
    session.last = Math.max(session.last, stamp);
    session.messages.push(message);
    sessions.set(key, session);
  }
  let messageCount = 0;
  let durationMs = 0;
  let activeSeconds = 0;
  for (const session of sessions.values()) {
    messageCount += session.messages.length;
    durationMs += session.last - session.first;
    activeSeconds += estimateActiveSeconds(session.messages);
  }
  const missingSources = [...new Set(options.missingSources ?? [])]
    .filter((source) => !selected || selected.has(source)).sort();
  return {
    ...aggregateTaskTiming([...unique.values()], options.timingEvents ?? [], options),
    sessionCount: sessions.size,
    messageCount,
    durationSeconds: Math.round(durationMs / 1000),
    activeSeconds: sessions.size === 0 && missingSources.length > 0 ? null : activeSeconds,
    complete: missingSources.length === 0,
    missingSources,
  };
}
