import type { ModelPricingRates } from './matcher.js';

export const TOKEN_FIELDS = ['input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_creation_input_tokens', 'reasoning_output_tokens'] as const;
export type TokenParts = Record<typeof TOKEN_FIELDS[number], number>;
/** Local numerical evidence. No request content, credentials or raw paths. */
export interface RequestPricingFact extends TokenParts {
  id: string; timestamp: string;
  requestInputTokens?: number;
  serviceTier?: 'standard' | 'fast' | 'flex' | 'unknown';
  cacheWrite5mTokens?: number; cacheWrite1hTokens?: number;
}
export interface RequestPricingRule {
  model: string; source: string; serviceTier?: RequestPricingFact['serviceTier'];
  effectiveFrom?: string; effectiveTo?: string;
  /** Strictly above this complete-request input threshold; whole-request rates. */
  minInputTokens?: number;
  rates: ModelPricingRates & { cache_write_1h?: number; cache_write_5m?: number };
  reference: string;
}
export function normalizeServiceTier(value: unknown): RequestPricingFact['serviceTier'] {
  if (typeof value !== 'string') return 'unknown';
  return ({ default: 'standard', standard: 'standard', priority: 'fast', fast: 'fast', flex: 'flex' } as const)[value.toLowerCase() as 'default'] ?? 'unknown';
}
export function serviceTierFromEvent(record: Record<string, unknown>, previous?: RequestPricingFact['serviceTier']): RequestPricingFact['serviceTier'] {
  const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const payload = obj(record.payload);
  for (const part of [obj(payload.thread_settings), payload, obj(record.thread_settings), record]) {
    if (Object.hasOwn(part, 'service_tier')) return normalizeServiceTier(part.service_tier);
  }
  return previous;
}
export function mergePricingRequests(a?: RequestPricingFact[], b?: RequestPricingFact[]): RequestPricingFact[] | undefined {
  if (!a?.length && !b?.length) return undefined;
  const rows = new Map<string, RequestPricingFact>();
  for (const row of [...(a ?? []), ...(b ?? [])]) {
    const prev = rows.get(row.id);
    if (!prev || row.timestamp >= prev.timestamp) rows.set(row.id, row);
  }
  return [...rows.values()];
}
export function validRequestRules(value: unknown): value is RequestPricingRule[] {
  return Array.isArray(value) && value.every(rule => rule && typeof rule === 'object'
    && typeof rule.model === 'string' && !!rule.model && typeof rule.source === 'string' && !!rule.source
    && typeof rule.reference === 'string' && /^https:\/\//.test(rule.reference)
    && (rule.serviceTier === undefined || ['standard', 'fast', 'flex', 'unknown'].includes(rule.serviceTier))
    && [rule.effectiveFrom, rule.effectiveTo].every(v => v === undefined || typeof v === 'string' && Number.isFinite(Date.parse(v)))
    && (!rule.effectiveFrom || !rule.effectiveTo || Date.parse(rule.effectiveFrom) < Date.parse(rule.effectiveTo))
    && (rule.minInputTokens === undefined || Number.isFinite(rule.minInputTokens) && rule.minInputTokens >= 0)
    && rule.rates && typeof rule.rates === 'object' && !Array.isArray(rule.rates)
    && Object.entries(rule.rates).every(([key, v]) => ['input', 'output', 'cache_read', 'cache_write', 'cache_write_1h', 'cache_write_5m'].includes(key) && typeof v === 'number' && Number.isFinite(v) && v >= 0));
}

/** Verified current modifiers, scoped to direct vendor pricing IDs; no historical backdating. */
export function builtinRequestRules(model: string, source: string, base: ModelPricingRates): RequestPricingRule[] {
  const common = { model, source, effectiveFrom: '2026-10-18T00:00:00Z' };
  const rules: RequestPricingRule[] = [];
  if (model.startsWith('anthropic/claude-') && source === 'claude' && base.input !== undefined) {
    rules.push({ ...common, rates: { cache_write_5m: base.input * 1.25, cache_write_1h: base.input * 2 }, reference: 'https://platform.claude.com/docs/en/about-claude/pricing' });
    if (/^anthropic\/claude-haiku-5[.-]5(?:$|-)/.test(model)) rules.push({ ...common, minInputTokens: 100000, rates: { input: base.input * 5, ...(base.output === undefined ? {} : { output: base.output * 5 }), ...(base.cache_read === undefined ? {} : { cache_read: base.cache_read * 5 }), ...(base.cache_write === undefined ? {} : { cache_write: base.cache_write * 5 }), cache_write_5m: base.input * 6.25, cache_write_1h: base.input * 10 }, reference: 'https://platform.claude.com/docs/en/about-claude/pricing' });
    if (/^anthropic\/claude-(?:opus-5(?:[.-]5)?|opus-4[.-]8)$/.test(model)) rules.push({ ...common, serviceTier: 'fast', rates: { ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v! * 2])), cache_write_5m: base.input * 2.5, cache_write_1h: base.input * 4 }, reference: 'https://platform.claude.com/docs/en/about-claude/pricing' });
  }
  if (source === 'codex' && /^openai\/gpt-(?:6-astra|6[.]1-sol|6-luna)$/.test(model)) {
    for (const [serviceTier, multiplier] of [['fast', 2], ['flex', 0.5]] as const) rules.push({ ...common, serviceTier, rates: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v! * multiplier])) as ModelPricingRates, reference: 'https://developers.openai.com/api/docs/pricing' });
  }
  return rules;
}

export function priceRequest(fact: RequestPricingFact, base: ModelPricingRates, rules: RequestPricingRule[]): { cost: number; unpricedTokens: number; ruleReferences: string[] } {
  const matched = rules.filter(rule => (!rule.serviceTier || rule.serviceTier === fact.serviceTier)
    && (!rule.effectiveFrom || Date.parse(fact.timestamp) >= Date.parse(rule.effectiveFrom))
    && (!rule.effectiveTo || Date.parse(fact.timestamp) < Date.parse(rule.effectiveTo))
    && (rule.minInputTokens === undefined || fact.requestInputTokens !== undefined && fact.requestInputTokens > rule.minInputTokens));
  // Base/TTL first, whole-request context second, explicit service tier last.
  matched.sort((a, b) => Number(!!a.serviceTier) - Number(!!b.serviceTier) || (a.minInputTokens ?? -1) - (b.minInputTokens ?? -1));
  const rates = Object.assign({}, base, ...matched.map(rule => rule.rates));
  const oneHour = Math.min(fact.cache_creation_input_tokens, fact.cacheWrite1hTokens ?? 0);
  const fiveMinute = Math.min(fact.cache_creation_input_tokens - oneHour, fact.cacheWrite5mTokens ?? 0);
  const fields: Array<[number, number | undefined]> = [[fact.input_tokens, rates.input], [fact.output_tokens + fact.reasoning_output_tokens, rates.output], [fact.cached_input_tokens, rates.cache_read], [fact.cache_creation_input_tokens - oneHour - fiveMinute, rates.cache_write], [oneHour, rates.cache_write_1h ?? rates.cache_write], [fiveMinute, rates.cache_write_5m ?? rates.cache_write]];
  return { cost: fields.reduce((sum, [n, rate]) => sum + n * (rate ?? 0), 0) / 1e6,
    unpricedTokens: fields.reduce((sum, [n, rate]) => sum + (rate === undefined ? n : 0), 0), ruleReferences: [...new Set(matched.map(rule => rule.reference))] };
}
