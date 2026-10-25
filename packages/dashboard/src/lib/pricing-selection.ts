import { resolvePricingModelId, type PricingData } from 'quotern-core/pricing-matcher';
import type { PricingModelGroup } from './pricing-groups.ts';

export type PricingModelSelection = { source: string; model: string };
export type PricingSearch = { q: string; models?: PricingModelSelection[] };

export function parsePricingSearch(search: Record<string, unknown>): PricingSearch {
  let raw = search.models;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = undefined; } }
  const models = new Map<string, PricingModelSelection>();
  if (Array.isArray(raw)) for (const value of raw) {
    if (!value || typeof value !== 'object' || typeof value.source !== 'string' || typeof value.model !== 'string') continue;
    const item = { source: value.source.trim(), model: value.model.trim() };
    if (item.model) models.set(JSON.stringify(item), item);
  }
  return { q: typeof search.q === 'string' ? search.q : '', ...(models.size ? { models: [...models.values()] } : {}) };
}

/** Resolve identity conservatively; an unmatched selection must never broaden to all rows. */
export function filterSessionPricingGroups(groups: PricingModelGroup[], selection: readonly PricingModelSelection[], matching?: Pick<PricingData, 'alias' | 'sourceAlias'>) {
  if (!selection.length) return { groups, unmatched: [] as PricingModelSelection[] };
  const entries = groups.flatMap(group => group.entries);
  const data: PricingData = { ...matching, exact: Object.fromEntries(entries.filter(entry => entry.billingMode !== 'subscription').map(entry => [entry.model, {}])) };
  const subscriptions = new Map(entries.filter(entry => entry.billingMode === 'subscription').map(entry => [entry.model.toLowerCase(), entry.model]));
  const ids = new Set<string>(), unmatched: PricingModelSelection[] = [];
  for (const item of selection) {
    const id = subscriptions.get(item.model.toLowerCase()) ?? resolvePricingModelId(item.model, data, item.source);
    if (id) ids.add(id.toLowerCase()); else unmatched.push(item);
  }
  return { groups: groups.filter(group => group.entries.some(entry => ids.has(entry.model.toLowerCase()))), unmatched };
}
