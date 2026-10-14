import { DEFAULT_STATS_TIMEZONE, localDateAndHour } from './timezone.js';

/** Local accounting metadata only: no prompt, response or tool content. */
export interface SessionMessage {
  source: string;
  sessionId: string;
  id: string;
  role: 'user' | 'assistant';
  timestamp: string;
}

export interface SessionMetrics {
  sessionCount: number;
  messageCount: number;
  durationSeconds: number;
  /** Null until a source supplies verified generation timing, excluding TTFT. */
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
  const sessions = new Map<string, { first: number; last: number; count: number }>();
  for (const message of unique.values()) {
    const date = localDateAndHour(message.timestamp, options.timeZone ?? DEFAULT_STATS_TIMEZONE).date;
    if (options.fromDate && date < options.fromDate) continue;
    if (options.toDate && date > options.toDate) continue;
    const key = JSON.stringify([message.source, message.sessionId]);
    const stamp = Date.parse(message.timestamp);
    const session = sessions.get(key) ?? { first: stamp, last: stamp, count: 0 };
    session.first = Math.min(session.first, stamp);
    session.last = Math.max(session.last, stamp);
    session.count++;
    sessions.set(key, session);
  }
  let messageCount = 0;
  let durationMs = 0;
  for (const session of sessions.values()) {
    messageCount += session.count;
    durationMs += session.last - session.first;
  }
  const missingSources = [...new Set(options.missingSources ?? [])]
    .filter((source) => !selected || selected.has(source)).sort();
  return {
    sessionCount: sessions.size,
    messageCount,
    durationSeconds: Math.round(durationMs / 1000),
    activeSeconds: null,
    complete: missingSources.length === 0,
    missingSources,
  };
}
