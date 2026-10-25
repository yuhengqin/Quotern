import { appendDashboardRangeQuery, type DashboardDateRange } from './dashboard-date-range.ts';

export interface SessionActivityTarget { source: string; sessionId: string; period?: 'selected' }

export function sessionActivityQuery(days: number, range: DashboardDateRange | null, sources: string, target?: SessionActivityTarget, preview = false): string {
  const query = new URLSearchParams({ days: String(days) });
  appendDashboardRangeQuery(query, range);
  if (sources) query.set('sources', sources);
  if (preview && !target) query.set('preview', '6');
  // Older runtimes ignore bounds whenever a session target is supplied. Read the
  // bounded source snapshot instead; FocusedSession locates the exact row locally.
  if (target?.period === 'selected') query.set('sources', target.source);
  else if (target) { query.set('sessionSource', target.source); query.set('sessionId', target.sessionId); }
  return `/functions/tud-session-activity?${query}`;
}
