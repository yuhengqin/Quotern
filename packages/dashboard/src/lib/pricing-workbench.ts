import type { PricingCatalogRow } from './pricing-data.ts';

export const PRICING_TOKEN_FIELDS = [
  ['input', '普通输入'], ['output', '输出'], ['cacheRead', '缓存读'], ['cacheWrite', '缓存写'],
] as const;
export type PricingTokenKind = typeof PRICING_TOKEN_FIELDS[number][0];
/** Mutually exclusive token quantities, not a cache-inclusive input total. */
export type PricingScenario = Record<PricingTokenKind, number>;
export const DEFAULT_PRICING_SCENARIO: PricingScenario = { input: 10_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 };
export const MAX_COMPARISON_MODELS = 4;

export interface PricingEstimate {
  status: 'ready' | 'missing' | 'subscription' | 'invalid';
  totalUsd: number | null;
  missing: PricingTokenKind[];
}

export function estimatePricingCost(row: PricingCatalogRow, scenario: PricingScenario): PricingEstimate {
  if (row.billingMode === 'subscription') return { status: 'subscription', totalUsd: null, missing: [] };
  if (PRICING_TOKEN_FIELDS.some(([key]) => !Number.isFinite(scenario[key]) || scenario[key] < 0 || scenario[key] > Number.MAX_SAFE_INTEGER)) {
    return { status: 'invalid', totalUsd: null, missing: [] };
  }
  const missing: PricingTokenKind[] = [];
  let total = 0;
  for (const [key] of PRICING_TOKEN_FIELDS) {
    if (scenario[key] === 0) continue;
    const rate = row[key];
    if (rate == null || !Number.isFinite(rate) || rate < 0) missing.push(key);
    else total += scenario[key] / 1_000_000 * rate;
  }
  if (missing.length) return { status: 'missing', totalUsd: null, missing };
  if (!Number.isFinite(total)) return { status: 'invalid', totalUsd: null, missing: [] };
  return { status: 'ready', totalUsd: Number(total.toPrecision(15)), missing: [] };
}

/** Negative means cache reads cost more than ordinary input. */
export function getCacheReadSavings(row: PricingCatalogRow): number | null {
  if (row.billingMode === 'subscription' || row.input == null || row.input <= 0 || !Number.isFinite(row.input)
    || row.cacheRead == null || row.cacheRead < 0 || !Number.isFinite(row.cacheRead)) return null;
  return Number(((1 - row.cacheRead / row.input) * 100).toPrecision(12));
}

export function togglePricingComparison(selected: string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter(value => value !== id);
  return selected.length < MAX_COMPARISON_MODELS ? [...selected, id] : selected;
}

export function comparePricingCosts(totals: Array<number | null>): Array<{
  differenceUsd: number; multiple: number | null; isLowest: boolean;
} | null> {
  const valid = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;
  const known = totals.filter(valid);
  if (known.length < 2) return totals.map(() => null);
  const minimum = Math.min(...known);
  return totals.map(total => valid(total) ? {
    differenceUsd: Number((total - minimum).toPrecision(15)),
    multiple: minimum > 0 ? total / minimum : null,
    isLowest: total === minimum,
  } : null);
}
