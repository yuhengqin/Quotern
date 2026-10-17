import type { PricingCatalogRow } from './pricing-data.ts';
import { filterAndSortPricingCatalog, getPricingChannel, getPricingProvider, type PricingSortDescriptor } from './pricing-catalog.ts';
import { formatContextWindow } from './pricing-filters.ts';

export interface PricingVariant {
  id: string;
  row: PricingCatalogRow;
  entries: PricingCatalogRow[];
  regions: string[];
}

export interface PricingModelGroup extends PricingCatalogRow {
  id: string;
  entries: PricingCatalogRow[];
  apiVariants: PricingVariant[];
  subscriptionVariants: PricingVariant[];
}

function usageTotal(entries: PricingCatalogRow[]): number {
  return entries.reduce((sum, entry) => sum + (Number.isFinite(entry.usageTokens) ? Math.max(0, entry.usageTokens!) : 0), 0);
}

function groupVariants(entries: PricingCatalogRow[], subscription: boolean): PricingVariant[] {
  const variants = new Map<string, PricingCatalogRow[]>();
  for (const row of entries) {
    // Regions may share a model without sharing a subscription product or API rate.
    const plan = subscription ? row.model.split('/')[0]!.toLowerCase().replace(/-(cn|global|sgp|ams)(?=-|$)/g, '') : null;
    const key = JSON.stringify(subscription
      ? [plan, row.contextWindow ?? null, row.releaseDate ?? null]
      : [row.input, row.output, row.cacheRead, row.cacheWrite, row.contextWindow ?? null, row.releaseDate ?? null]);
    const variant = variants.get(key);
    if (variant) variant.push(row);
    else variants.set(key, [row]);
  }
  return [...variants].map(([id, entries]) => ({
    id,
    row: { ...entries[0]!, usageTokens: usageTotal(entries) },
    entries,
    regions: [...new Set(entries.map(entry => getPricingChannel(entry.model)).filter((region): region is string => region !== null))].sort(),
  }));
}

export function groupPricingCatalog(rows: PricingCatalogRow[]): PricingModelGroup[] {
  const callingId = (row: PricingCatalogRow) => row.model.slice(row.model.indexOf('/') + 1).trim().toLowerCase();
  const supplierCallingId = (row: PricingCatalogRow) => JSON.stringify([getPricingProvider(row.model).key, callingId(row)]);
  const canonicalIds = new Map<string, Set<string>>();
  for (const row of rows) {
    const canonical = row.canonicalModelId?.trim().toLowerCase();
    if (!canonical) continue;
    const key = supplierCallingId(row);
    const ids = canonicalIds.get(key) ?? new Set<string>();
    ids.add(canonical);
    canonicalIds.set(key, ids);
  }
  const models = new Map<string, PricingCatalogRow[]>();
  for (const row of rows) {
    // Fall back only to the exact calling ID within a supplier, never a display name.
    // Explicit conflicting canonical identities must remain separate.
    const knownIds = canonicalIds.get(supplierCallingId(row));
    const canonical = row.canonicalModelId?.trim().toLowerCase() || (knownIds?.size === 1 ? [...knownIds][0] : undefined);
    const id = JSON.stringify([getPricingProvider(row.model).key, canonical ? `canonical:${canonical}` : `calling:${callingId(row)}`]);
    const entries = models.get(id);
    if (entries) entries.push(row);
    else models.set(id, [row]);
  }
  return [...models].map(([id, entries]) => {
    const apiVariants = groupVariants(entries.filter(entry => entry.billingMode !== 'subscription'), false);
    const subscriptionVariants = groupVariants(entries.filter(entry => entry.billingMode === 'subscription'), true)
      .sort((a, b) => (a.row.contextWindow ?? Infinity) - (b.row.contextWindow ?? Infinity) || a.row.model.localeCompare(b.row.model));
    const primary = apiVariants[0] ?? [...subscriptionVariants].sort((a, b) => (b.row.contextWindow ?? 0) - (a.row.contextWindow ?? 0))[0]!;
    return {
      ...primary.row, id, entries, apiVariants, subscriptionVariants,
      featured: entries.some(entry => entry.featured), usageTokens: usageTotal(entries),
    };
  });
}

export function filterAndSortPricingGroups(groups: PricingModelGroup[], query: string, sort: PricingSortDescriptor, usedOnly = false): PricingModelGroup[] {
  const normalized = query.trim().toLowerCase();
  const filtered = groups.filter(group => (!usedOnly || (group.usageTokens ?? 0) > 0) && (!normalized || group.entries.some(entry =>
    [entry.model, entry.displayName, entry.canonicalModelId].some(value => value?.toLowerCase().includes(normalized)))));
  return filterAndSortPricingCatalog(filtered, '', sort);
}

export function getPrimaryPricingVariant(group: PricingModelGroup): PricingVariant {
  return group.apiVariants[0] ?? group.subscriptionVariants.find(variant => variant.row.model === group.model)!;
}

export function formatPricingContext(value?: number): string {
  if (value != null && value > 0 && Number.isSafeInteger(value)) {
    if (value >= 1_048_576 && value % 1_048_576 === 0) return `${value / 1_048_576}M`;
    if (value >= 1_024 && value % 1_024 === 0) return `${value / 1_024}K`;
  }
  return formatContextWindow(value);
}
