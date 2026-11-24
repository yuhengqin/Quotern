export type ShareAspect = '2:3' | '1:1' | '4:5' | '9:16';
export const DEFAULT_SHARE_ASPECT = '2:3';
export interface ShareCostEvidence { knownCostUsd: number; tokens: number; unpricedTokens: number }

export function shareDimensions(aspect: ShareAspect = DEFAULT_SHARE_ASPECT) {
  const [width, height] = ({ '2:3': [300, 450], '1:1': [400, 400], '4:5': [360, 450], '9:16': [300, 1600 / 3] } as const)[aspect];
  return { width, height, exportWidth: Math.round(2048 * width / height), exportHeight: 2048 };
}

export function shareCostState(evidence?: ShareCostEvidence | null): { kind: 'unknown' | 'partial' | 'complete'; value: number | null } {
  if (!evidence || !Number.isFinite(evidence.knownCostUsd) || !Number.isFinite(evidence.tokens) || !Number.isFinite(evidence.unpricedTokens)
    || evidence.tokens < 0 || evidence.unpricedTokens < 0 || evidence.knownCostUsd < 0
    || (evidence.tokens > 0 && evidence.unpricedTokens >= evidence.tokens)) return { kind: 'unknown', value: null };
  return { kind: evidence.unpricedTokens > 0 ? 'partial' : 'complete', value: evidence.knownCostUsd };
}
