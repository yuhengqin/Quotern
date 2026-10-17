import type { PricingCurrency } from './pricing-currency.ts';

const compactRate = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 });
const exactRate = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 15 });

/** Keep source suffixes verbatim; unrelated calling IDs are shown whole. */
export function getPricingVariantSuffixes(canonicalModel: string, models: string[]): string[] {
  const callingId = (model: string) => model.slice(model.indexOf('/') + 1);
  const base = callingId(canonicalModel);
  return [...new Set(models.flatMap(model => {
    const id = callingId(model);
    if (id.toLowerCase() === base.toLowerCase()) return [];
    if (id.toLowerCase().startsWith(base.toLowerCase()) && /^[-._:/]/.test(id.slice(base.length))) {
      return [id.slice(base.length).replace(/^[-._:/]+/, '')];
    }
    return [id];
  }).filter(Boolean))];
}

/** A visible suffix is not necessarily a complete or unique calling ID. */
export function getPricingVariantAliases(canonicalModel: string, models: string[]): Array<{ label: string; models: string[] }> {
  const aliases = new Map<string, string[]>();
  for (const model of models) {
    const label = getPricingVariantSuffixes(canonicalModel, [model])[0];
    if (!label) continue;
    const ids = aliases.get(label) ?? [];
    if (!ids.includes(model)) ids.push(model);
    aliases.set(label, ids);
  }
  return [...aliases].map(([label, models]) => ({ label, models }));
}

export function splitPricingHighlight(text: string, query: string): Array<{ text: string; match: boolean }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const parts: Array<{ text: string; match: boolean }> = [];
  let position = 0;
  let index = lower.indexOf(needle);
  while (index !== -1) {
    if (index > position) parts.push({ text: text.slice(position, index), match: false });
    parts.push({ text: text.slice(index, index + needle.length), match: true });
    position = index + needle.length;
    index = lower.indexOf(needle, position);
  }
  if (position < text.length) parts.push({ text: text.slice(position), match: false });
  return parts;
}

export function formatPricingDisplayRate(value: number | null, currency: PricingCurrency = 'USD', exchangeRate: number | null = null) {
  const unavailable = { text: '—', exact: '—', approximate: false };
  if (value === null || !Number.isFinite(value) || value < 0) return unavailable;
  if (currency === 'CNY' && (exchangeRate === null || !Number.isFinite(exchangeRate) || exchangeRate <= 0)) return unavailable;
  const converted = value * (currency === 'CNY' ? exchangeRate! : 1);
  if (!Number.isFinite(converted)) return unavailable;
  // Suppress floating-point multiplication noise in the converted detail value.
  const exact = Number(converted.toPrecision(15));
  const approximate = Number(converted.toPrecision(4)) !== exact;
  const symbol = currency === 'USD' ? '$' : '¥';
  return { text: `${approximate ? '≈' : ''}${symbol}${compactRate.format(converted)}`, exact: `${symbol}${exactRate.format(exact)}`, approximate };
}
