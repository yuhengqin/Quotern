import type { SessionActivity, SessionActivitySnapshot, SessionModelCostItem } from 'quotern-core';

export type DetailScope = 'own' | 'thread';
export type DetailRange = SessionActivitySnapshot['range'];
type Insight = NonNullable<SessionActivity['insights']>;
type RelatedUsage = NonNullable<Insight['relatedUsage']>[number];
type ModelUsage = NonNullable<SessionActivity['models']>[number];
export type DetailMember = Omit<RelatedUsage, 'relationKind'> & { relationKind: 'own' | RelatedUsage['relationKind'] };
export type DetailModel = ModelUsage & { pricingEvidence: NonNullable<ModelUsage['pricing']>[]; costBreakdown: SessionModelCostItem[] };
export const detailTokenFields = ['input_tokens', 'cached_input_tokens', 'cache_creation_input_tokens', 'output_tokens', 'reasoning_output_tokens'] as const;
type TokenParts = Record<typeof detailTokenFields[number], number | null>;
type CostKind = SessionActivity['costKind'];

const sum = (values: readonly (number | null | undefined)[]): number | null => values.some(value => value == null) ? null : values.reduce<number>((total, value) => total + value!, 0);
function costKind(values: CostKind[]): CostKind {
  const kinds = new Set(values);
  return kinds.size === 1 ? values[0] : kinds.size > 1 ? 'mixed' : 'unknown';
}

function ownUsage(row: SessionActivity): DetailMember {
  return {
    source: row.source, sessionId: row.sessionId, sessionTitle: row.sessionTitle,
    tokens: row.tokens, costUsd: row.insights ? row.insights.ownCostUsd : row.unallocatedCostUsd == null && row.models?.some(model => model.costUsd === null) ? null : row.costUsd,
    knownCostUsd: row.costUsd ?? 0, costKind: row.costKind, models: row.models,
    detailsComplete: row.detailsComplete, unallocatedCostUsd: row.unallocatedCostUsd,
    relationKind: 'own', agentNickname: row.insights?.agentNickname ?? null, agentRole: row.insights?.agentRole ?? null,
  };
}

/** Older runtimes expose reference rates but cannot prove category charges. */
function modelCostItems(row: ModelUsage): SessionModelCostItem[] {
  if (row.costBreakdown) return row.costBreakdown;
  const output = row.output_tokens === null || row.reasoning_output_tokens === null ? null : row.output_tokens + row.reasoning_output_tokens;
  return ([['input', row.input_tokens], ['cache_read', row.cached_input_tokens], ['cache_write', row.cache_creation_input_tokens], ['output', output]] as const).map(([category, tokens]) => ({ category, tokens, rateUsdPerMillion: row.pricing?.rates?.[category] ?? null, costUsd: null, knownCostUsd: 0 }));
}

function summarizeModels(members: DetailMember[]): DetailModel[] {
  const byModel = new Map<string, ModelUsage[]>();
  for (const member of members) for (const model of member.models ?? []) {
    const rows = byModel.get(model.model) ?? [];
    rows.push(model); byModel.set(model.model, rows);
  }
  return [...byModel].map(([model, rows]) => {
    const pricing = new Map<string, NonNullable<ModelUsage['pricing']>>();
    for (const row of rows) if (row.pricing) {
      // Preserve distinct rate tables and pricing assumptions instead of choosing an arbitrary first one.
      const { unpricedTokens, ...basis } = row.pricing;
      const key = JSON.stringify(basis), previous = pricing.get(key);
      pricing.set(key, { ...basis, unpricedTokens: (previous?.unpricedTokens ?? 0) + unpricedTokens });
    }
    const costItems = new Map<string, SessionModelCostItem>();
    for (const item of rows.flatMap(modelCostItems)) {
      const key = JSON.stringify([item.category, item.rateUsdPerMillion]), previous = costItems.get(key);
      costItems.set(key, previous ? { ...item, tokens: sum([previous.tokens, item.tokens]), costUsd: sum([previous.costUsd, item.costUsd]), knownCostUsd: previous.knownCostUsd + item.knownCostUsd } : { ...item });
    }
    return {
      model, tokens: rows.reduce((total, row) => total + row.tokens, 0), requests: sum(rows.map(row => row.requests)),
      ...Object.fromEntries(detailTokenFields.map(field => [field, sum(rows.map(row => row[field]))])) as TokenParts,
      costUsd: sum(rows.map(row => row.costUsd)), knownCostUsd: rows.reduce((total, row) => total + row.knownCostUsd, 0),
      costKind: costKind(rows.map(row => row.costKind)), serviceTiers: [...new Set(rows.flatMap(row => row.serviceTiers))],
      pricingEvidence: [...pricing.values()],
      costBreakdown: [...costItems.values()],
    };
  }).sort((a, b) => (b.costUsd ?? b.knownCostUsd) - (a.costUsd ?? a.knownCostUsd) || b.tokens - a.tokens || a.model.localeCompare(b.model));
}

export function summarizeDetailUsage(members: DetailMember[]) {
  const models = summarizeModels(members);
  const tokens = sum(members.map(member => member.tokens));
  const modelTokens = models.reduce((total, model) => total + model.tokens, 0);
  const missingModelTokens = tokens === null || modelTokens > tokens ? null : tokens - modelTokens;
  const missingModels = members.some(member => member.tokens === null || member.tokens !== (member.models ?? []).reduce((total, model) => total + model.tokens, 0));
  const parts = Object.fromEntries(detailTokenFields.map(field => [field, missingModels ? null : sum(models.map(model => model[field]))])) as TokenParts;
  const classified = sum(Object.values(parts));
  const unclassifiedTokens = tokens !== null && classified !== null && tokens >= classified ? tokens - classified : null;
  const unallocated = members.filter(member => member.unallocatedCostUsd != null);
  return {
    tokens, costUsd: sum(members.map(member => member.costUsd)), knownCostUsd: members.reduce((total, member) => total + member.knownCostUsd, 0),
    costKind: costKind(members.map(member => member.costKind)), models, parts, missingModelTokens, unclassifiedTokens,
    detailsComplete: members.every(member => member.detailsComplete === true) && unclassifiedTokens === 0,
    unallocatedCostUsd: unallocated.length ? unallocated.reduce((total, member) => total + member.unallocatedCostUsd!, 0) : null,
  };
}

export function buildSessionDetail(row: SessionActivity, requestedScope: DetailScope) {
  const own = ownUsage(row), related = row.insights?.relatedUsage ?? [];
  const count = row.insights?.descendantCount ?? 0;
  const threadAvailable = count === 0 || row.insights?.relatedUsage?.length === count;
  const scope: DetailScope = requestedScope === 'thread' && count > 0 && threadAvailable ? 'thread' : 'own';
  const members = [own, ...(threadAvailable ? related : [])];
  const groups = (['own', 'subagent', 'fork', 'unknown'] as const).flatMap(kind => {
    const entries = members.filter(member => member.relationKind === kind);
    return entries.length ? [{ kind, members: entries, tokens: sum(entries.map(member => member.tokens)), costUsd: sum(entries.map(member => member.costUsd)), knownCostUsd: entries.reduce((total, member) => total + member.knownCostUsd, 0) }] : [];
  });
  const selectedMembers = scope === 'thread' ? members : [own];
  const pricingModels = new Map<string, { source: string; model: string }>();
  for (const member of selectedMembers) for (const model of member.models ?? []) {
    const item = { source: member.source, model: model.model };
    pricingModels.set(JSON.stringify(item), item);
  }
  if (!own.models?.length && row.model && row.model !== 'unknown') {
    const item = { source: row.source, model: row.model };
    pricingModels.set(JSON.stringify(item), item);
  }
  return {
    scope, threadAvailable, hasDescendants: count > 0, groups,
    pricingModels: [...pricingModels.values()], usage: summarizeDetailUsage(selectedMembers),
    legacyCombined: !threadAvailable && row.insights ? { tokens: row.insights.combinedTokens, costUsd: row.insights.combinedCostUsd, knownCostUsd: row.insights.combinedKnownCostUsd, subagentTokens: row.insights.subagentTokens, subagentCostUsd: row.insights.subagentCostUsd } : null,
  };
}

export function formatExactSessionNumber(value: number | null | undefined, locale: string): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toLocaleString(locale, { maximumSignificantDigits: 21 });
}

/** Copy an explicit data projection, never local paths or nested runtime metadata. */
export function sessionDetailExport(row: SessionActivity, scope: DetailScope, range: DetailRange): string {
  const detail = buildSessionDetail(row, scope);
  return JSON.stringify({
    source: row.source, sessionId: row.sessionId, range, scope: detail.scope, usage: detail.usage,
    attribution: detail.groups.filter(group => detail.scope === 'thread' || group.kind === 'own').map(({ members, ...group }) => ({ ...group, sessions: members.map(member => ({ source: member.source, sessionId: member.sessionId })) })),
    legacyCombined: detail.legacyCombined,
    taskSeconds: row.taskSeconds, taskTimingKind: row.taskTimingKind,
    performanceScope: 'own', performance: row.insights?.performance, signals: row.insights?.signals,
  }, null, 2);
}
