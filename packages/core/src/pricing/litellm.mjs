export const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

// A provider field and a compatible key are both required. In particular, a
// bare Claude name can be a Bedrock SKU; a bare name is never proof of channel.
const PROVIDERS = {
  openai: 'openai', anthropic: 'anthropic', gemini: 'google', xai: 'xai',
  mistral: 'mistral', cohere: 'cohere', deepseek: 'deepseek',
};
export const RATE_KEYS = {
  input_cost_per_token: 'input', output_cost_per_token: 'output',
  cache_read_input_token_cost: 'cache_read', cache_creation_input_token_cost: 'cache_write',
};
export function validRate(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
export function perMillion(value) {
  const [mantissa, exponent = '0'] = String(value).split('e');
  return Number(`${mantissa}e${Number(exponent) + 6}`);
}
const NON_TEXT = /embedding|rerank|moderation|tts|stt|audio|speech|video|realtime|transcription|(?:^|-)image(?:$|-)/i;

/** @returns {Record<string, { rates: import('./matcher.js').ModelPricingRates, entry: any }>} */
export function parseLiteLLMPricing(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid LiteLLM pricing');
  const rows = {};
  // Prefer direct bare rows over same-provider aliases; never depend on JSON order.
  const entries = Object.entries(raw).sort(([a], [b]) => Number(a.includes('/')) - Number(b.includes('/')) || a.localeCompare(b));
  for (const [name, entry] of entries) {
    if (!entry || typeof entry !== 'object' || !Object.hasOwn(PROVIDERS, entry.litellm_provider)) continue;
    if (!['chat', 'completion'].includes(entry.mode) || NON_TEXT.test(name)) continue;
    const provider = entry.litellm_provider;
    const segments = name.split('/');
    if (segments.length > 2 || segments.length === 2 && segments[0] !== provider) continue;
    const id = segments.at(-1);
    if (!id || id.includes(':') || !validRate(entry.input_cost_per_token) || !validRate(entry.output_cost_per_token)) continue;
    if (!validRate(perMillion(entry.input_cost_per_token)) || !validRate(perMillion(entry.output_cost_per_token))) continue;
    if (Array.isArray(entry.output_modalities) && !entry.output_modalities.includes('text')) continue;
    const key = `${PROVIDERS[provider]}/${id}`;
    if (Object.hasOwn(rows, key)) continue;
    const rates = {};
    for (const [field, target] of Object.entries(RATE_KEYS)) {
      if (validRate(entry[field]) && validRate(perMillion(entry[field]))) rates[target] = perMillion(entry[field]);
    }
    rows[key] = { rates, entry };
  }
  if (!Object.keys(rows).length) throw new Error('LiteLLM contains no supported direct text prices');
  return rows;
}

const RULE_FIELDS = ['input', 'output', 'cache_read', 'cache_write', 'cache_write_5m', 'cache_write_1h'];

/** Only published fields become rules; independent tiers never form an invented combination.
 * @returns {import('./request-pricing.js').RequestPricingRule[]}
 */
export function liteLLMRequestRules(model, entry, referenceRates) {
  const source = model.startsWith('openai/') ? 'codex' : model.startsWith('anthropic/') ? 'claude' : null;
  if (!source) return [];
  const base = {};
  for (const [field, target] of Object.entries(RATE_KEYS)) {
    if (validRate(entry[field])) base[target] = perMillion(entry[field]);
  }
  if (base.input !== referenceRates.input || base.output !== referenceRates.output) return [];
  const groups = new Map();
  const put = (tier, threshold, field, value) => {
    if (!validRate(value)) return;
    const key = `${tier ?? ''}:${threshold ?? ''}`;
    if (!groups.has(key)) groups.set(key, { tier, threshold, rates: {} });
    groups.get(key).rates[field] = value;
  };
  for (const [field, value] of Object.entries(entry)) {
    const match = /^(input_cost_per_token|output_cost_per_token|cache_read_input_token_cost|cache_creation_input_token_cost)(_above_1hr)?(?:_above_(\d+)k_tokens)?(?:_(priority|flex))?$/.exec(field);
    if (!match || !validRate(value)) continue;
    const [, rateKey, oneHour, thousands, service] = match;
    if (!oneHour && !thousands && !service) continue;
    if (oneHour && (source !== 'claude' || rateKey !== 'cache_creation_input_token_cost')) continue;
    const target = oneHour ? 'cache_write_1h' : RATE_KEYS[rateKey];
    put(service === 'priority' ? 'fast' : service, thousands ? Number(thousands) * 1000 : undefined, target, perMillion(value));
  }
  if (source === 'claude' && base.cache_write !== undefined) put(undefined, undefined, 'cache_write_5m', base.cache_write);
  const explicitFast = entry.provider_specific_entry?.fast;
  if (source === 'claude' && validRate(explicitFast) && explicitFast > 0 && explicitFast <= 100) {
    const defaults = { ...base, ...(groups.get(':')?.rates ?? {}) };
    for (const group of [{ rates: {}, threshold: undefined }, ...[...groups.values()].filter(group => !group.tier && group.threshold !== undefined)]) {
      for (const [field, rate] of Object.entries({ ...defaults, ...group.rates })) put('fast', group.threshold, field, rate * explicitFast);
    }
  }
  const contexts = [...new Set([...groups.values()].flatMap(group => group.threshold === undefined ? [] : [group.threshold]))];
  const tiers = [...new Set([...groups.values()].flatMap(group => group.tier ? [group.tier] : []))];
  // A known context tier plus a special tier requires an explicitly published
  // combination. Mark absent combinations unknown, never multiply two rates.
  for (const threshold of contexts) for (const tier of tiers) {
    const key = `${tier}:${threshold}`;
    if (!groups.has(key)) groups.set(key, { tier, threshold, rates: {}, missing: true });
  }
  return [...groups.values()].map(group => {
    const rates = {}, multipliers = {};
    for (const [field, rate] of Object.entries(group.rates)) {
      const baseField = field.startsWith('cache_write_') ? 'cache_write' : field;
      // Optional cache fields from another source may disagree; do not combine them.
      if (base[baseField] !== referenceRates[baseField]) continue;
      rates[field] = rate;
      if (base[baseField] > 0 && validRate(rate / base[baseField])) multipliers[field] = rate / base[baseField];
      else if (base[baseField] === 0 && rate === 0) multipliers[field] = 1;
    }
    const unpriced = group.tier && group.threshold !== undefined
      ? RULE_FIELDS.filter(field => rates[field] === undefined) : undefined;
    return { model, source, origin: 'litellm', reference: LITELLM_URL, rates, multipliers,
      ...(group.tier ? { serviceTier: group.tier } : {}),
      ...(group.threshold !== undefined ? { minInputTokens: group.threshold } : {}),
      ...(unpriced?.length ? { unpriced } : {}),
    };
  }).filter(rule => Object.keys(rule.rates).length > 0 || rule.unpriced?.length);
}
