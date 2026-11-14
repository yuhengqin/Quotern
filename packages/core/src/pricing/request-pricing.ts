import type { ModelPricingRates } from './matcher.js';

/** Bump when built-in request rules or their calculation change, so persisted costs are rebuilt. */
export const REQUEST_PRICING_REVISION = '2026-11-14-source-rules';

export const TOKEN_FIELDS = ['input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_creation_input_tokens', 'reasoning_output_tokens'] as const;
export type TokenParts = Record<typeof TOKEN_FIELDS[number], number>;
/** Conditions of the rules that supplied this component's effective rate. Absent on legacy estimates. */
export interface TokenPricingConditions {
  serviceTier?: 'fast' | 'flex';
  minInputTokens?: number;
  maxInputTokens?: number;
}
export interface TokenCostItem {
  category: 'input' | 'output' | 'cache_read' | 'cache_write' | 'cache_write_1h' | 'cache_write_5m';
  tokens: number;
  rateUsdPerMillion: number | null;
  costUsd: number | null;
  conditions?: TokenPricingConditions;
}

export function tokenCostItem(category: TokenCostItem['category'], tokens: number, rate: number | undefined): TokenCostItem {
  const rateUsdPerMillion = rate !== undefined && Number.isFinite(rate) && rate >= 0 ? rate : null;
  return { category, tokens, rateUsdPerMillion, costUsd: tokens === 0 ? 0 : rateUsdPerMillion === null ? null : tokens * rateUsdPerMillion / 1e6 };
}
/** Local numerical evidence. No request content, credentials or raw paths. */
export interface RequestPricingFact extends TokenParts {
  id: string; timestamp: string;
  requestInputTokens?: number;
  serviceTier?: 'standard' | 'fast' | 'flex' | 'unknown';
  cacheWrite5mTokens?: number; cacheWrite1hTokens?: number;
}
export interface RequestPricingRule {
  origin?: 'litellm';
  /** Ratios from published rates; only automatic rules follow edited base prices. */
  multipliers?: Partial<Record<keyof RequestPricingRule['rates'], number>>;
  /** A missing published tier/context combination must not invent a price. */
  unpriced?: Array<keyof RequestPricingRule['rates']>;
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
  const rateKeys = ['input', 'output', 'cache_read', 'cache_write', 'cache_write_1h', 'cache_write_5m'];
  const validRates = (rates: unknown) => !!rates && typeof rates === 'object' && !Array.isArray(rates)
    && Object.entries(rates).every(([key, v]) => rateKeys.includes(key) && typeof v === 'number' && Number.isFinite(v) && v >= 0);
  return Array.isArray(value) && value.every(rule => rule && typeof rule === 'object'
    && typeof rule.model === 'string' && !!rule.model && typeof rule.source === 'string' && !!rule.source
    && typeof rule.reference === 'string' && /^https:\/\//.test(rule.reference)
    && (rule.serviceTier === undefined || ['standard', 'fast', 'flex', 'unknown'].includes(rule.serviceTier))
    && [rule.effectiveFrom, rule.effectiveTo].every(v => v === undefined || typeof v === 'string' && Number.isFinite(Date.parse(v)))
    && (!rule.effectiveFrom || !rule.effectiveTo || Date.parse(rule.effectiveFrom) < Date.parse(rule.effectiveTo))
    && (rule.minInputTokens === undefined || Number.isFinite(rule.minInputTokens) && rule.minInputTokens >= 0)
    && validRates(rule.rates)
    && (rule.origin === undefined || rule.origin === 'litellm')
    && (rule.multipliers === undefined || rule.origin === 'litellm' && validRates(rule.multipliers))
    && (rule.unpriced === undefined || rule.origin === 'litellm' && Array.isArray(rule.unpriced) && rule.unpriced.every((key: unknown) => typeof key === 'string' && rateKeys.includes(key))));
}

/** Verified API reference modifiers, scoped to direct vendor pricing IDs. */
export function builtinRequestRules(model: string, source: string, base: ModelPricingRates): RequestPricingRule[] {
  const common = { model, source, effectiveFrom: '2026-10-18T00:00:00Z' };
  const rules: RequestPricingRule[] = [];
  if (model.startsWith('anthropic/claude-') && source === 'claude' && base.input !== undefined) {
    rules.push({ ...common, rates: { cache_write_5m: base.input * 1.25, cache_write_1h: base.input * 2 }, reference: 'https://platform.claude.com/docs/en/about-claude/pricing' });
    if (/^anthropic\/claude-haiku-5[.-]5(?:$|-)/.test(model)) rules.push({ ...common, minInputTokens: 100000, rates: { input: base.input * 5, ...(base.output === undefined ? {} : { output: base.output * 5 }), ...(base.cache_read === undefined ? {} : { cache_read: base.cache_read * 5 }), ...(base.cache_write === undefined ? {} : { cache_write: base.cache_write * 5 }), cache_write_5m: base.input * 6.25, cache_write_1h: base.input * 10 }, reference: 'https://platform.claude.com/docs/en/about-claude/pricing' });
    if (/^anthropic\/claude-(?:opus-5(?:[.-]5)?|opus-4[.-]8)$/.test(model)) rules.push({ ...common, serviceTier: 'fast', rates: { ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v! * 2])), cache_write_5m: base.input * 2.5, cache_write_1h: base.input * 4 }, reference: 'https://platform.claude.com/docs/en/about-claude/pricing' });
  }
  if (source === 'codex' && /^openai\/gpt-(?:6-astra|6[.]1-sol|6-luna)$/.test(model)) {
    const reference = 'https://developers.openai.com/api/docs/pricing';
    const scaledRates = (tier: number, long: boolean): ModelPricingRates => Object.fromEntries(
      Object.entries(base).filter(([, value]) => value !== undefined).map(([key, value]) =>
        [key, value! * tier * (long ? key === 'output' ? 1.5 : 2 : 1)]),
    );
    // Current API-equivalent reference prices, not a claim about historical subscription bills.
    const context = { model, source, minInputTokens: 272_000, reference };
    rules.push({ ...context, rates: scaledRates(1, true) });
    for (const [serviceTier, multiplier] of [['fast', 2], ['flex', 0.5]] as const) {
      rules.push({ ...common, serviceTier, rates: scaledRates(multiplier, false), reference });
      // Tier rules contain absolute rates; each combination must retain the context multiplier.
      rules.push({ ...context, effectiveFrom: common.effectiveFrom, serviceTier, rates: scaledRates(multiplier, true) });
    }
  }
  return rules;
}

export function priceRequest(fact: RequestPricingFact, base: ModelPricingRates, rules: RequestPricingRule[]): { cost: number; unpricedTokens: number; ruleReferences: string[]; items: TokenCostItem[] } {
  // A curated condition owns its date boundaries too. An automatic substitute
  // must not become eligible simply because the curated rule is not yet active.
  const curated = rules.filter(rule => rule.origin !== 'litellm');
  const effectiveRules = rules.filter(rule => rule.origin !== 'litellm' || !curated.some(explicit =>
    explicit.serviceTier === rule.serviceTier && explicit.minInputTokens === rule.minInputTokens));
  const eligible = effectiveRules.filter(rule => (!rule.serviceTier || rule.serviceTier === fact.serviceTier)
    && (!rule.effectiveFrom || Date.parse(fact.timestamp) >= Date.parse(rule.effectiveFrom))
    && (!rule.effectiveTo || Date.parse(fact.timestamp) < Date.parse(rule.effectiveTo)));
  const matched = eligible.filter(rule => rule.minInputTokens === undefined || fact.requestInputTokens !== undefined && fact.requestInputTokens > rule.minInputTokens);
  // Base/TTL first, whole-request context second, explicit service tier last.
  matched.sort((a, b) => Number(!!a.serviceTier) - Number(!!b.serviceTier) || (a.minInputTokens ?? -1) - (b.minInputTokens ?? -1)
    || Number(a.origin !== 'litellm') - Number(b.origin !== 'litellm'));
  const rates: RequestPricingRule['rates'] = { ...base };
  type RateKey = keyof RequestPricingRule['rates'];
  const unknown = new Set<RateKey>();
  const applied = new Map<RateKey, RequestPricingRule>();
  for (const rule of matched) {
    for (const key of rule.unpriced ?? []) { delete rates[key]; unknown.add(key); applied.set(key, rule); }
    for (const key of Object.keys(rule.rates) as RateKey[]) {
      const baseKey = key.startsWith('cache_write_') ? 'cache_write' : key as keyof ModelPricingRates;
      if (rule.origin === 'litellm' && base[baseKey] === undefined) {
        delete rates[key]; unknown.add(key); applied.set(key, rule); continue;
      }
      rates[key] = rule.origin === 'litellm' && rule.multipliers?.[key] !== undefined && base[baseKey] !== undefined
        ? base[baseKey]! * rule.multipliers[key]! : rule.rates[key];
      if (!Number.isFinite(rates[key])) { delete rates[key]; unknown.add(key); }
      else unknown.delete(key);
      applied.set(key, rule);
    }
  }
  const conditionsFor = (key: RateKey): TokenPricingConditions => {
    const rule = applied.get(key), conditions: TokenPricingConditions = {};
    if (rule?.serviceTier === 'fast' || rule?.serviceTier === 'flex') conditions.serviceTier = rule.serviceTier;
    if (rule?.minInputTokens !== undefined) conditions.minInputTokens = rule.minInputTokens;
    if (fact.requestInputTokens !== undefined) {
      // Only a future rule that can supersede this field establishes an upper bound.
      const limits = eligible.filter(next => next.rates[key] !== undefined && next.minInputTokens !== undefined
        && next.minInputTokens >= fact.requestInputTokens!
        && Number(!!next.serviceTier) >= Number(!!rule?.serviceTier)).map(next => next.minInputTokens!);
      if (limits.length) conditions.maxInputTokens = Math.min(...limits);
    }
    return conditions;
  };
  const oneHour = Math.min(fact.cache_creation_input_tokens, fact.cacheWrite1hTokens ?? 0);
  const fiveMinute = Math.min(fact.cache_creation_input_tokens - oneHour, fact.cacheWrite5mTokens ?? 0);
  const ttlRate = (key: 'cache_write_1h' | 'cache_write_5m') => unknown.has(key) ? undefined : rates[key] ?? rates.cache_write;
  const fields: Array<[TokenCostItem['category'], number, number | undefined]> = [['input', fact.input_tokens, rates.input], ['output', fact.output_tokens + fact.reasoning_output_tokens, rates.output], ['cache_read', fact.cached_input_tokens, rates.cache_read], ['cache_write', fact.cache_creation_input_tokens - oneHour - fiveMinute, rates.cache_write], ['cache_write_1h', oneHour, ttlRate('cache_write_1h')], ['cache_write_5m', fiveMinute, ttlRate('cache_write_5m')]];
  return { cost: fields.reduce((sum, [, n, rate]) => sum + n * (rate ?? 0), 0) / 1e6,
    unpricedTokens: fields.reduce((sum, [, n, rate]) => sum + (rate === undefined ? n : 0), 0), ruleReferences: [...new Set(matched.map(rule => rule.reference))],
    items: fields.filter(([category, tokens]) => tokens > 0 || !category.startsWith('cache_write_')).map(([category, tokens, rate]) => {
      const key: RateKey = category === 'input' || category === 'output' ? category
        : category === 'cache_read' ? 'cache_read'
        : (category === 'cache_write_1h' || category === 'cache_write_5m') && (rates[category] !== undefined || unknown.has(category)) ? category : 'cache_write';
      return { ...tokenCostItem(category, tokens, rate), conditions: conditionsFor(key) };
    }) };
}
