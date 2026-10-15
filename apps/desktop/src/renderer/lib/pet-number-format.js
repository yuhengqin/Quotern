export function formatChineseNumber(value, { decimals = 1 } = {}) {
  const n = Number(value) || 0;
  if (n >= 1e8) return `${(n / 1e8).toFixed(decimals)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(decimals)}万`;
  return String(Math.round(n));
}
