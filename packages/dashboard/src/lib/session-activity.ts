import type { SessionActivity } from 'quotern-core';

export const SESSION_PAGE_SIZE = 12;
export function filterSessionActivity(rows: SessionActivity[], query: string, source: string): SessionActivity[] {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter(row => (source === 'all' || row.source === source) && (!needle || [row.sessionTitle, row.projectLabel, row.model, row.source, row.sessionId].some(value => value?.toLocaleLowerCase().includes(needle))));
}

export function sessionActivityPage(rows: SessionActivity[], page: number) {
  const pages = Math.max(1, Math.ceil(rows.length / SESSION_PAGE_SIZE));
  const current = Math.min(pages, Math.max(1, page));
  return { rows: rows.slice((current - 1) * SESSION_PAGE_SIZE, current * SESSION_PAGE_SIZE), page: current, pages };
}
