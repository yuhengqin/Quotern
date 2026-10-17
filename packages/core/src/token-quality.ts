/** Local-only provenance, independent of the completeness of request/cache fields. */
export type TokenQuality = 'recorded' | 'estimated' | 'ledger' | 'mixed';

export function mergeTokenQuality(a?: TokenQuality, b?: TokenQuality): TokenQuality | undefined {
  if (a === b) return a;
  // A known contribution mixed with unannotated historical data is not fully known.
  return 'mixed';
}
