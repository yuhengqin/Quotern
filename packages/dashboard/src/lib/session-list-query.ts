import type { SessionPageSearch } from './session-page.ts';
import { appendDashboardRangeQuery, type DashboardDateRange } from './dashboard-date-range.ts';

export function sessionListQuery(search: SessionPageSearch, range: DashboardDateRange | null, csv = false): string {
  const query = new URLSearchParams({ days: String(search.days), page: String(search.page), pageSize: String(search.pageSize), sort: search.sort, direction: search.direction });
  appendDashboardRangeQuery(query, range);
  if (search.scopeSources.length) query.set('sources', [...search.scopeSources].sort().join(','));
  if (search.sources.length) query.set('filterSources', [...search.sources].sort().join(','));
  for (const name of ['q', 'project', 'model', 'group'] as const) if (search[name]) query.set(name, search[name]!);
  if (csv) query.set('format', 'export');
  return `/functions/tud-session-list?${query}`;
}

export function paginationItems(pages: number, current: number): Array<number | 'ellipsis'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const start = Math.max(2, Math.min(current - 1, pages - 2));
  const end = Math.min(pages - 1, Math.max(current + 1, 3));
  return [1, ...(start > 2 ? ['ellipsis' as const] : []), ...Array.from({ length: end - start + 1 }, (_, index) => start + index), ...(end < pages - 1 ? ['ellipsis' as const] : []), pages];
}

export function parsePageJump(value: string, pages: number): number | null {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) return null;
  return Math.max(1, Math.min(pages, Number(value)));
}
