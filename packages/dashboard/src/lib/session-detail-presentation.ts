import { detailTokenFields, type buildSessionDetail } from './session-detail.ts';

type Usage = ReturnType<typeof buildSessionDetail>['usage'];

/** A total belongs in the table only when it adds information beyond its one model. */
export function shouldShowUsageTotal(usage: Usage): boolean {
  const model = usage.models[0];
  return usage.models.length !== 1 || usage.tokens !== model.tokens || usage.costUsd !== model.costUsd
    || usage.knownCostUsd !== model.knownCostUsd || usage.costKind !== model.costKind
    || detailTokenFields.some(field => usage.parts[field] !== model[field]);
}

export function visibleServiceTiers(tiers: readonly string[]): string[] {
  return [...new Set(tiers.map(tier => tier.trim()).filter(tier => tier && !['standard', 'unknown'].includes(tier.toLowerCase())))];
}
