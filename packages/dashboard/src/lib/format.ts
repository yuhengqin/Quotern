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
  if (n == null || !Number.isFinite(n)) return '—';
  if (n === 0) return '$0';
  if (Math.abs(n) < 0.01) {
    if (lowerBound && n > 0) return '> $0';
    return n > 0 ? '<$0.01' : '>-$0.01';
  }
  const amount = Math.abs(n).toLocaleString(locale, { maximumFractionDigits: 2 });
  return `${lowerBound ? '≥ ' : ''}${n < 0 ? '-$' : '$'}${amount}`;
}

export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '0.0%';
  return `${n.toFixed(1)}%`;
}

/** Monetary balances/platform costs retain their original currency. USD uses the usage contract. */
export function formatMoney(n: number | null | undefined, currency: string, locale?: string): string {
  if (currency.toLowerCase() === 'usd') return formatUsd(n, locale);
  if (n == null || !Number.isFinite(n) || !/^[a-zA-Z]{3}$/.test(currency)) return '—';
  try {
    const format = new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: 0, maximumFractionDigits: 2 });
    if (n !== 0 && Math.abs(n) < .01) return `${n < 0 ? '>' : '<'}${format.format(n < 0 ? -.01 : .01)}`;
    return format.format(n);
  } catch { return '—'; }
}
