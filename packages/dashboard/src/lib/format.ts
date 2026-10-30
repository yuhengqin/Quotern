export { formatCompactTokenCount as formatTokens } from './utils.ts';

export function formatTokensExact(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString();
}

export function formatUsd(
  n: number | null | undefined,
  locale?: string,
  { lowerBound = false }: { lowerBound?: boolean } = {},
): string {
  return formatCost(n, 'USD', locale, { lowerBound });
}

export function formatCost(
  n: number | null | undefined,
  currency: 'USD' | 'CNY',
  locale?: string,
  { lowerBound = false }: { lowerBound?: boolean } = {},
): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const symbol = currency === 'CNY' ? '¥' : '$';
  if (n === 0) return `${symbol}0`;
  if (Math.abs(n) < 0.01) {
    if (lowerBound && n > 0) return `> ${symbol}0`;
    return n > 0 ? `<${symbol}0.01` : `>-${symbol}0.01`;
  }
  const amount = Math.abs(n).toLocaleString(locale, { maximumFractionDigits: 2 });
  return `${lowerBound ? '≥ ' : ''}${n < 0 ? '-' : ''}${symbol}${amount}`;
}

export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '0.0%';
  return `${n.toFixed(1)}%`;
}
