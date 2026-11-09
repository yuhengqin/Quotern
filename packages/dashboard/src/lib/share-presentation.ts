export type ShareAspect = '2:3' | '1:1' | '4:5' | '9:16';
export interface SharePresentation { layout: 'details' | 'tokens' | 'cost'; aspect: ShareAspect }
export const DEFAULT_SHARE_PRESENTATION: SharePresentation = { layout: 'details', aspect: '2:3' };
export interface ShareCostEvidence { knownCostUsd: number; tokens: number; unpricedTokens: number }

export function shareDimensions(aspect: ShareAspect = '2:3') {
  const [width, height] = ({ '2:3': [300, 450], '1:1': [400, 400], '4:5': [360, 450], '9:16': [300, 1600 / 3] } as const)[aspect];
  return { width, height, exportWidth: Math.round(2048 * width / height), exportHeight: 2048 };
}

export function cumulativeShareTokens(days: readonly { date: string; tokens: number }[]) {
  const byDay = new Map<string, number>();
  for (const row of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(`${row.date}T00:00:00Z`)) || !Number.isFinite(row.tokens) || row.tokens < 0) continue;
    byDay.set(row.date, (byDay.get(row.date) ?? 0) + row.tokens);
  }
  let total = 0;
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, tokens]) => ({ date, tokens: total += tokens }));
}

export function shareCostState(evidence?: ShareCostEvidence | null): { kind: 'unknown' | 'partial' | 'complete'; value: number | null } {
  if (!evidence || !Number.isFinite(evidence.knownCostUsd) || !Number.isFinite(evidence.tokens) || !Number.isFinite(evidence.unpricedTokens)
    || evidence.tokens < 0 || evidence.unpricedTokens < 0 || evidence.knownCostUsd < 0
    || (evidence.tokens > 0 && evidence.unpricedTokens >= evidence.tokens)) return { kind: 'unknown', value: null };
  return { kind: evidence.unpricedTokens > 0 ? 'partial' : 'complete', value: evidence.knownCostUsd };
}

export function shareCostText(evidence: ShareCostEvidence | null | undefined, format: (value: number) => string, partialLabel: string) {
  const cost = shareCostState(evidence);
  return cost.value === null ? '—' : `${format(cost.value)}${cost.kind === 'partial' ? ` (${partialLabel})` : ''}`;
}

export function buildShareCaption({ userName, rangeLabel, toolLabel, metrics }: { userName?: string; rangeLabel: string; toolLabel?: string; metrics: readonly (readonly [string, string])[] }) {
  return [[userName?.trim(), 'Quotern', rangeLabel].filter(Boolean).join(' · '), toolLabel, ...metrics.map(([label, value]) => `${label}: ${value}`)].filter(Boolean).join('\n');
}
