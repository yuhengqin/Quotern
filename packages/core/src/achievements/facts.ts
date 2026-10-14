import type { QueueBucket } from '../types.js';
import type { SessionMessage } from '../session-metrics.js';
import { DEFAULT_STATS_TIMEZONE, localDateAndHour, localDateNow } from '../timezone.js';
import { bucketKey } from '../queue/keys.js';
import { loadBucketsForRange } from '../queue/index.js';
import { computeRowCost, computeTokens } from '../pricing/index.js';
import { readSessionHistory } from '../session-collector.js';
import type { AchievementDay, AchievementFacts, AchievementProject, AchievementSession } from './types.js';

/** Queue rows are replacements, not deltas. This also supports hand-provided histories. */
export function buildAchievementFacts(rows: readonly QueueBucket[], messages: readonly SessionMessage[], missingSessionSources: readonly string[] = [], now = new Date()): AchievementFacts {
  const observedAt = now.toISOString(), timeZone = DEFAULT_STATS_TIMEZONE;
  const today = localDateNow(timeZone, now);
  const latest = new Map(rows.map(row => [bucketKey(row), row]));
  const days = new Map<string, AchievementDay>();
  for (const row of latest.values()) {
    const stamp = Date.parse(row.hour_start);
    if (!Number.isFinite(stamp) || stamp > now.getTime()) continue;
    const tokens = computeTokens(row), costUsd = computeRowCost(row);
    if (!Number.isFinite(tokens) || !Number.isFinite(costUsd) || (!tokens && !costUsd)) continue;
    const date = localDateAndHour(row.hour_start, timeZone).date;
    const day = days.get(date) ?? { date, tokens: 0, costUsd: 0, sources: Object.create(null) as Record<string, number> };
    day.tokens += tokens; day.costUsd += costUsd;
    day.sources[row.source] = (day.sources[row.source] ?? 0) + tokens;
    days.set(date, day);
  }
  const unique = new Map<string, SessionMessage>();
  for (const message of messages) {
    const stamp = Date.parse(message.timestamp);
    if (!message.id || !message.sessionId || !Number.isFinite(stamp) || stamp > now.getTime()) continue;
    const key = JSON.stringify([message.source, message.sessionId, message.id]);
    const previous = unique.get(key);
    if (!previous || Date.parse(previous.timestamp) < stamp) unique.set(key, message);
  }
  const sessions = new Map<string, AchievementSession>();
  const projects = new Map<string, { label: string; dates: Set<string>; kind: AchievementProject['kind']; aliases: Set<string> }>();
  const aliases = new Map<string, string>();
  const evidence = new Map<string, SessionMessage>();
  for (const message of unique.values()) {
    if (!message.projectId || !message.projectLabel) continue;
    const previous = evidence.get(message.projectId);
    if (!previous || message.projectKind === 'repository' || previous.projectKind === undefined) evidence.set(message.projectId, message);
    if (message.projectLegacyId && message.projectLegacyId !== message.projectId && /^[a-f0-9]{64}$/.test(message.projectLegacyId)) aliases.set(message.projectLegacyId, message.projectId);
  }
  const canonicalId = (id: string) => {
    const visited = new Set<string>();
    while (aliases.has(id) && !visited.has(id)) { visited.add(id); id = aliases.get(id)!; }
    return id;
  };
  for (const message of unique.values()) {
    const key = JSON.stringify([message.source, message.sessionId]);
    const session = sessions.get(key) ?? { source: message.source, id: message.sessionId, firstAt: message.timestamp, lastAt: message.timestamp, durationSeconds: 0 };
    if (Date.parse(message.timestamp) < Date.parse(session.firstAt)) session.firstAt = message.timestamp;
    if (Date.parse(message.timestamp) > Date.parse(session.lastAt)) session.lastAt = message.timestamp;
    session.durationSeconds = Math.round((Date.parse(session.lastAt) - Date.parse(session.firstAt)) / 1000);
    sessions.set(key, session);
    if (message.projectId && /^[a-f0-9]{64}$/.test(message.projectId) && message.projectLabel) {
      const id = canonicalId(message.projectId), meta = evidence.get(id) ?? message;
      const project = projects.get(id) ?? { label: meta.projectLabel!.slice(0, 160), kind: meta.projectKind ?? 'unconfirmed', dates: new Set<string>(), aliases: new Set<string>() };
      project.dates.add(localDateAndHour(message.timestamp, timeZone).date);
      if (message.projectId !== id) project.aliases.add(message.projectId);
      if (message.projectLegacyId && message.projectLegacyId !== id) project.aliases.add(message.projectLegacyId);
      projects.set(id, project);
    }
  }
  const dayRows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map(day => ({
    ...day, tokens: Math.max(0, day.tokens), costUsd: Math.max(0, day.costUsd),
    sources: Object.fromEntries(Object.entries(day.sources).filter(([, tokens]) => tokens > 0)),
  })).filter(day => day.tokens > 0 || day.costUsd > 0);
  const sessionRows = [...sessions.values()].sort((a, b) => a.firstAt.localeCompare(b.firstAt) || a.source.localeCompare(b.source) || a.id.localeCompare(b.id));
  const projectRows: AchievementProject[] = [...projects].map(([id, project]) => ({ id, label: project.label, kind: project.kind, aliases: [...project.aliases].sort(), dates: [...project.dates].sort() })).sort((a, b) => a.id.localeCompare(b.id));
  const starts = [dayRows[0]?.date, sessionRows[0] ? localDateAndHour(sessionRows[0].firstAt, timeZone).date : undefined].filter((date): date is string => Boolean(date)).sort();
  return { observedAt, today, timeZone, coverageFromDate: starts[0] ?? null, days: dayRows, sessions: sessionRows, projects: projectRows, missingSessionSources: [...new Set(missingSessionSources)].sort() };
}

/** Intentionally independent of dashboard collect/display floors. No source logs are opened here. */
export async function readAchievementFacts(dataDir: string, now = new Date()): Promise<AchievementFacts> {
  const rows = await loadBucketsForRange(dataDir, '0001-01-01T00:00:00.000Z');
  const sources = [...new Set(rows.filter(row => computeTokens(row) > 0).map(row => row.source))];
  const history = await readSessionHistory(dataDir, sources);
  return buildAchievementFacts(rows, history.messages, history.missingSources, now);
}
