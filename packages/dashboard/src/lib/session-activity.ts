import type { SessionActivity, SessionActivitySnapshot } from 'quotern-core';

export function relatedSessionActivity(rows: SessionActivity[], group: Pick<SessionActivitySnapshot['billing'][number], 'sessionRefs'>): SessionActivity[] {
  const refs = new Set(group.sessionRefs?.map(ref => JSON.stringify([ref.source, ref.sessionId])));
  return rows.filter(row => refs.has(JSON.stringify([row.source, row.sessionId])));
}

export const SESSION_PAGE_SIZE = 12;
export function filterSessionActivity(rows: SessionActivity[], query: string, source: string | readonly string[], project = ''): SessionActivity[] {
  const needle = query.trim().toLocaleLowerCase();
  const sources = typeof source === 'string' ? source === 'all' ? [] : [source] : source;
  return rows.filter(row => (!sources.length || sources.includes(row.source)) && (!project || row.projectLabel === project) && (!needle || [row.sessionTitle, row.projectLabel, row.model, row.source, row.sessionId, ...(row.models?.map(model => model.model) ?? [])].some(value => value?.toLocaleLowerCase().includes(needle))));
}

function sessionFilterOptions(rows: SessionActivity[], key: 'source' | 'projectLabel', selected: string | readonly string[]) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row[key], (counts.get(row[key]) ?? 0) + 1);
  for (const value of typeof selected === 'string' ? [selected] : selected) {
    if (value && !counts.has(value)) counts.set(value, 0);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({ value, count }));
}

export function sessionActivityFacets(rows: SessionActivity[], query: string, source: string | readonly string[], project: string) {
  // Ignore a facet's own selection so users can switch to its other matching options.
  return {
    sources: sessionFilterOptions(filterSessionActivity(rows, query, 'all', project), 'source', source === 'all' ? '' : source),
    projects: sessionFilterOptions(filterSessionActivity(rows, query, source), 'projectLabel', project),
  };
}

export type SessionSort = 'recent' | 'tokens' | 'cost' | 'duration';
export type SessionSortDirection = 'ascending' | 'descending';
export function sortSessionActivity(rows: SessionActivity[], sort: SessionSort, direction: SessionSortDirection = 'descending'): SessionActivity[] {
  const value = (row: SessionActivity) => sort === 'cost' ? row.costUsd : sort === 'duration' ? row.taskSeconds : row.tokens;
  const order = direction === 'ascending' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let compared: number;
    if (sort === 'recent') compared = order * a.lastActivityAt.localeCompare(b.lastActivityAt);
    else {
      const first = value(a), second = value(b);
      // Missing measurements stay after known values in either direction, including zero.
      if (first == null || second == null) compared = Number(first == null) - Number(second == null);
      else compared = order * (first - second);
    }
    return compared || b.lastActivityAt.localeCompare(a.lastActivityAt) || a.source.localeCompare(b.source) || a.sessionId.localeCompare(b.sessionId);
  });
}

export function sessionActivityPage(rows: SessionActivity[], page: number) {
  const pages = Math.max(1, Math.ceil(rows.length / SESSION_PAGE_SIZE));
  const current = Math.min(pages, Math.max(1, page));
  return { rows: rows.slice((current - 1) * SESSION_PAGE_SIZE, current * SESSION_PAGE_SIZE), page: current, pages };
}
