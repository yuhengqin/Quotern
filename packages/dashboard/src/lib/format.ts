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
