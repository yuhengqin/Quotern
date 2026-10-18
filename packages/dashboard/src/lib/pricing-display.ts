import type { PricingCurrency } from './pricing-currency.ts';

/** Release dates are calendar dates, not instants. Keep their day stable across time zones. */
export function formatPricingReleaseDate(value: string | undefined, locale: string): string {
  if (!value || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(value)) return '—';
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day ?? 1));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || (day != null && date.getUTCDate() !== day)) return '—';
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'numeric', ...(day != null ? { day: 'numeric' } : {}) }).format(date);
}

export function formatPricingTokens(value: number, locale: string): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

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

export function formatPricingDisplayRate(value: number | null, currency: PricingCurrency = 'USD', exchangeRate: number | null = null, locale = 'en-US') {
  const unavailable = { text: '—', exact: '—', approximate: false };
  if (value === null || !Number.isFinite(value) || value < 0) return unavailable;
  if (currency === 'CNY' && (exchangeRate === null || !Number.isFinite(exchangeRate) || exchangeRate <= 0)) return unavailable;
  const converted = value * (currency === 'CNY' ? exchangeRate! : 1);
  if (!Number.isFinite(converted)) return unavailable;
  // Suppress floating-point multiplication noise in the converted detail value.
  const exact = Number(converted.toPrecision(15));
  const approximate = Number(converted.toPrecision(4)) !== exact;
  const symbol = currency === 'USD' ? '$' : '¥';
  const compactRate = new Intl.NumberFormat(locale, { maximumSignificantDigits: 4 });
  const exactRate = new Intl.NumberFormat(locale, { maximumSignificantDigits: 15 });
  return { text: `${approximate ? '≈' : ''}${symbol}${compactRate.format(converted)}`, exact: `${symbol}${exactRate.format(exact)}`, approximate };
}
