import type { SessionActivity } from 'quotern-core';

export const SESSION_PAGE_SIZE = 12;
export function filterSessionActivity(rows: SessionActivity[], query: string, source: string, project = ''): SessionActivity[] {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter(row => (source === 'all' || row.source === source) && (!project || row.projectLabel === project) && (!needle || [row.sessionTitle, row.projectLabel, row.model, row.source, row.sessionId, ...(row.models?.map(model => model.model) ?? [])].some(value => value?.toLocaleLowerCase().includes(needle))));
}
export type SessionSort = 'recent' | 'tokens' | 'cost' | 'duration';
export function sortSessionActivity(rows: SessionActivity[], sort: SessionSort): SessionActivity[] {
  const value = (row: SessionActivity) => sort === 'cost' ? row.costUsd ?? -1 : sort === 'duration' ? row.taskSeconds ?? -1 : row.tokens ?? -1;
  return [...rows].sort((a, b) => (sort === 'recent' ? 0 : value(b) - value(a)) || b.lastActivityAt.localeCompare(a.lastActivityAt) || a.source.localeCompare(b.source) || a.sessionId.localeCompare(b.sessionId));
}

export function sessionActivityPage(rows: SessionActivity[], page: number) {
  const pages = Math.max(1, Math.ceil(rows.length / SESSION_PAGE_SIZE));
  const current = Math.min(pages, Math.max(1, page));
  return { rows: rows.slice((current - 1) * SESSION_PAGE_SIZE, current * SESSION_PAGE_SIZE), page: current, pages };
}
