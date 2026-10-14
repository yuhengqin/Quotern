import { isModelReleaseDate, resolvePricingModelId, type PricingData } from 'quotern-core/pricing-matcher';
import type { ModelBreakdownRow, PricingCatalogRow } from './api.ts';

export const PRICING_PAGE_SIZE = 100;

/**
 * Providers that expose upstream models through a gateway or reseller.
 * Keep these out of the public catalog view so the table focuses on the
 * model vendor's direct prices. The core pricing matcher still retains all
 * entries because usage can legitimately come from these providers.
 */
export const PRICING_GATEWAY_PREFIXES = new Set([
  '302ai',
  'abacus',
  'aihubmix',
  'cloudflare-ai-gateway',
  'crossmodel',
  'edenai',
  'empiriolabs',
  'fastrouter',
  'helicone',
  'impossibl',
  'jiekou',
  'kilo',
  'llmgateway',
  'llmtr',
  'merge-gateway',
  'nano-gpt',
  'neon',
  'ofox',
  'openrouter',
  'opencode',
  'opencode-go',
  'orcarouter',
  'poe',
  'pioneer',
  'requesty',
  'routing-run',
  'siliconflow',
  'siliconflow-cn',
  'submodel',
  'synthetic',
  'venice',
  'vercel',
  'xpersona',
  'zenmux',
]);

export function isGatewayPricingModel(model: string): boolean {
  const prefix = model.trim().split('/', 1)[0]?.toLocaleLowerCase();
  return prefix ? PRICING_GATEWAY_PREFIXES.has(prefix) : false;
}

export function filterDirectPricingCatalog(rows: PricingCatalogRow[]): PricingCatalogRow[] {
  return rows.filter((row) => !isGatewayPricingModel(row.model));
}

export type PricingSortKey = 'latest' | 'usage' | 'model' | 'inputOutput' | 'cache';

export type PricingSortDirection = 'ascending' | 'descending';

export interface PricingSortDescriptor {
  column: PricingSortKey;
  direction: PricingSortDirection;
}

export const DEFAULT_PRICING_SORT: PricingSortDescriptor = {
  column: 'latest',
  direction: 'descending',
};

export const PRICING_SORT_STORAGE_KEY = 'quotern.pricing.sort.v1';

export const PRICING_SORT_OPTIONS = [
  { key: 'latest:descending', label: '最新旗舰' },
  { key: 'usage:descending', label: '我的常用' },
  { key: 'inputOutput:descending', label: '输入价：高 → 低' },
  { key: 'inputOutput:ascending', label: '输入价：低 → 高' },
  { key: 'model:ascending', label: '模型名称：A → Z' },
  { key: 'model:descending', label: '模型名称：Z → A' },
  { key: 'cache:descending', label: '缓存价：高 → 低' },
  { key: 'cache:ascending', label: '缓存价：低 → 高' },
] as const;

export function readPricingSort(storage?: Pick<Storage, 'getItem'>): PricingSortDescriptor {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    const saved = JSON.parse(target?.getItem(PRICING_SORT_STORAGE_KEY) ?? 'null') as PricingSortDescriptor | null;
    if (saved && PRICING_SORT_OPTIONS.some(option => option.key === `${saved.column}:${saved.direction}`)) return saved;
  } catch { /* Storage may be unavailable in a private or restricted window. */ }
  return DEFAULT_PRICING_SORT;
}

export function writePricingSort(sort: PricingSortDescriptor, storage?: Pick<Storage, 'setItem'>): void {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    target?.setItem(PRICING_SORT_STORAGE_KEY, JSON.stringify(sort));
  } catch { /* The page remains usable without preference storage. */ }
}

export function addPricingUsage(
  rows: PricingCatalogRow[],
  usage: ModelBreakdownRow[],
  matching?: Pick<PricingData, 'alias' | 'sourceAlias'>,
): PricingCatalogRow[] {
  const data: PricingData = { ...matching, exact: Object.fromEntries(rows.map(row => [row.model, {}])) };
  const totals = new Map<string, number>();
  for (const row of usage) {
    if (!Number.isFinite(row.tokens) || row.tokens <= 0) continue;
    const id = resolvePricingModelId(row.model, data, row.source);
    if (id) totals.set(id, (totals.get(id) ?? 0) + row.tokens);
  }
  return rows.map(row => ({ ...row, usageTokens: totals.get(row.model) ?? 0 }));
}

function compareLatest(a: PricingCatalogRow, b: PricingCatalogRow): number {
  const aDate = isModelReleaseDate(a.releaseDate) ? a.releaseDate : '';
  const bDate = isModelReleaseDate(b.releaseDate) ? b.releaseDate : '';
  return Number(Boolean(b.featured)) - Number(Boolean(a.featured))
    || bDate.localeCompare(aDate)
    || a.model.localeCompare(b.model);
}

/** The price source may include a provider namespace such as `azure/gpt-5.4`. */
export function getPricingModelName(model: string): string {
  const segments = model.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? model;
}

export function filterAndSortPricingCatalog(
  rows: PricingCatalogRow[],
  query: string,
  sort: PricingSortDescriptor,
): PricingCatalogRow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = normalizedQuery
    ? rows.filter((row) => row.model.toLocaleLowerCase().includes(normalizedQuery))
    : rows;

  return [...filtered].sort((a, b) => {
    if (sort.column === 'latest') return compareLatest(a, b);
    if (sort.column === 'usage') return (b.usageTokens ?? 0) - (a.usageTokens ?? 0) || compareLatest(a, b);
    const comparisons =
      sort.column === 'model'
        ? [getPricingModelName(a.model).localeCompare(getPricingModelName(b.model))]
        : sort.column === 'inputOutput'
          ? [a.input - b.input, a.output - b.output]
          : [a.cacheRead - b.cacheRead, a.cacheWrite - b.cacheWrite];

    for (const comparison of comparisons) {
      if (comparison !== 0) {
        return sort.direction === 'descending' ? -comparison : comparison;
      }
    }

    // Keep all sorts predictable when the displayed values are the same.
    return a.model.localeCompare(b.model);
  });
}

export function getPageCount(totalItems: number, pageSize = PRICING_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

export function getPricingPage<T>(rows: T[], page: number, pageSize = PRICING_PAGE_SIZE): T[] {
  const safePage = Math.min(Math.max(page, 1), getPageCount(rows.length, pageSize));
  const start = (safePage - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

export function getPaginationItems(
  totalPages: number,
  currentPage: number,
): Array<number | 'ellipsis'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items: Array<number | 'ellipsis'> = [1];
  if (currentPage > 3) items.push('ellipsis');

  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);
  for (let page = start; page <= end; page += 1) items.push(page);

  if (currentPage < totalPages - 2) items.push('ellipsis');
  items.push(totalPages);
  return items;
}
