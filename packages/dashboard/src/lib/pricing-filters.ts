import { isModelReleaseDate } from 'quotern-core/pricing-matcher';
import type { PricingCatalogRow } from './pricing-data.ts';
import { getPricingProvider } from './pricing-catalog.ts';
import { dashboardNow } from './demo-runtime.ts';

export interface PricingFilters {
  providers?: readonly string[];
  minContext?: number;
  releasedAfter?: string;
  releasedBefore?: string;
}

function releaseInterval(value?: string): [string, string] | null {
  if (!isModelReleaseDate(value)) return null;
  if (value.length === 10) return [value, value];
  const [year, month] = value.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  return [`${value}-01`, `${value}-${String(lastDay).padStart(2, '0')}`];
}

export function filterPricingCatalog(rows: PricingCatalogRow[], filters: PricingFilters): PricingCatalogRow[] {
  const after = releaseInterval(filters.releasedAfter)?.[0];
  const before = releaseInterval(filters.releasedBefore)?.[1];
  if (after && before && after > before) return [];
  return rows.filter(row => {
    if (filters.providers?.length && !filters.providers.includes(getPricingProvider(row.model).key)) return false;
    if ((filters.minContext ?? 0) > 0 && (row.contextWindow == null || row.contextWindow < filters.minContext!)) return false;
    if (after || before) {
      const interval = releaseInterval(row.releaseDate);
      if (!interval || (after && interval[1] < after) || (before && interval[0] > before)) return false;
    }
    return true;
  });
}

export function formatContextWindow(value?: number, locale = 'en-US'): string {
  if (value == null || !Number.isSafeInteger(value) || value <= 0) return '—';
  const divisor = value >= 1_000_000 ? 1_000_000 : value >= 1_000 ? 1_000 : 1;
  const suffix = divisor === 1_000_000 ? 'M' : divisor === 1_000 ? 'K' : '';
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / divisor)}${suffix}`;
}

export function getRecentReleaseRange(days: number, now = dashboardNow()): Pick<PricingFilters, 'releasedAfter' | 'releasedBefore'> {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(0, Math.floor(days) - 1));
  const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { releasedAfter: format(start), releasedBefore: format(end) };
}
