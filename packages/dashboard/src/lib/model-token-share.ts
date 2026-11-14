import type { DashboardDistributionMetric, DashboardDistributionRow } from './dashboard-mock-data.ts';

export type ModelShareRow = DashboardDistributionRow & { value: number };
export type ModelShareItem = ModelShareRow & {
  key: string;
  share: number;
  hidden: boolean;
  isOther: boolean;
  count: number;
};

const chartValue = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;

/** Preserve raw amounts and colors; visibility only changes the chart denominator. */
export function buildModelTokenShare(
  rows: readonly DashboardDistributionRow[],
  metric: DashboardDistributionMetric,
  hiddenIds: ReadonlySet<string>,
) {
  const chartRows: ModelShareRow[] = rows.map(row => ({
    ...row, value: metric === 'tokens' ? row.tokens : row.costUsd,
  })).sort((a, b) => chartValue(b.value) - chartValue(a.value) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const visibleRows = chartRows.filter(row => !hiddenIds.has(row.id));
  const total = visibleRows.reduce((sum, row) => sum + chartValue(row.value), 0);
  const items: ModelShareItem[] = chartRows.slice(0, 5).map(row => ({
    ...row, key: `model:${row.id}`, isOther: false, count: 1,
    hidden: hiddenIds.has(row.id),
    share: total > 0 && !hiddenIds.has(row.id) ? chartValue(row.value) / total * 100 : 0,
  }));
  const remainder = chartRows.slice(5);
  if (remainder.length) {
    const visible = remainder.filter(row => !hiddenIds.has(row.id));
    const value = visible.reduce((sum, row) => sum + chartValue(row.value), 0);
    items.push({
      id: '__other__', key: 'other', label: '', color: 'var(--chart-8)',
      tokens: visible.reduce((sum, row) => sum + row.tokens, 0),
      costUsd: visible.reduce((sum, row) => sum + row.costUsd, 0),
      durationMinutes: 0, value, share: total > 0 ? value / total * 100 : 0,
      hidden: visible.length === 0, isOther: true, count: remainder.length,
    });
  }
  return { chartRows, items, total, hasHiddenRows: visibleRows.length !== chartRows.length,
    hasUnknownCosts: visibleRows.some(row => !Number.isFinite(row.costUsd)),
    hasKnownCosts: visibleRows.some(row => Number.isFinite(row.costUsd)),
  };
}

export interface ModelRibbonRow { y: number; height: number }

/** Both ends use the same scale. Tiny shares never receive an inflated minimum. */
export function buildModelRibbonGeometry(width: number, height: number, rows: ModelRibbonRow[], shares: number[]) {
  if (width <= 0 || height <= 0 || rows.length !== shares.length) return { sourceY: 0, sourceHeight: 0, bands: [] };
  const fractions = shares.map(share => chartValue(share) / 100);
  const sourceHeight = Math.max(0, Math.min(width * 1.1, (height - 24) * 0.7,
    ...fractions.map((fraction, index) => fraction > 0 ? rows[index].height * 0.78 / fraction : Infinity)));
  const sourceY = (height - sourceHeight) / 2;
  let offset = 0;
  const bands = fractions.map((fraction, index) => {
    const thickness = sourceHeight * fraction;
    const startY = sourceY + offset;
    offset += thickness;
    const endY = rows[index].y + (rows[index].height - thickness) / 2;
    const endX = width - 3;
    const path = `M 8 ${startY} C ${width * 0.43} ${startY}, ${width * 0.57} ${endY}, ${endX} ${endY} L ${endX} ${endY + thickness} C ${width * 0.57} ${endY + thickness}, ${width * 0.43} ${startY + thickness}, 8 ${startY + thickness} Z`;
    return { thickness, startY, endY, endX, path };
  });
  return { sourceY, sourceHeight, bands };
}
