import { mergePricingModelMetadata } from './model-metadata.mjs';

export const MODELS_DEV_URL = 'https://models.dev/catalog.json';

const SCOPED_PROVIDERS = new Set([
  'anthropic', 'openai', 'google', 'xai', 'deepseek', 'alibaba', 'alibaba-cn',
  'moonshotai', 'moonshotai-cn', 'minimax', 'minimax-cn', 'xiaomi', 'mistral',
  'zai', 'zhipuai', 'volcengine', 'stepfun', 'meta',
]);
const SUBSCRIPTION_PROVIDERS = new Set([
  'kimi-code-plan-cn', 'kimi-code-plan-global', 'zai-coding-plan', 'zhipuai-coding-plan',
  'minimax-coding-plan', 'minimax-cn-coding-plan', 'alibaba-coding-plan', 'alibaba-coding-plan-cn',
  'alibaba-token-plan', 'alibaba-token-plan-cn', 'volcengine-coding-plan', 'tencent-coding-plan',
  'tencent-token-plan', 'stepfun-ai-step-plan', 'stepfun-step-plan', 'xiaomi-token-plan-cn',
  'xiaomi-token-plan-sgp', 'xiaomi-token-plan-ams',
]);
// Pin corrections here so scheduled builds and runtime refreshes share them.
const OVERRIDES = {};
const OFFICIAL_PROVIDERS = {
  claude: ['anthropic'], gpt: ['openai'], o1: ['openai'], o3: ['openai'], o4: ['openai'], codex: ['openai'],
  gemini: ['google'], deepResearch: ['google'], grok: ['xai'], deepseek: ['deepseek'],
  qwen: ['alibaba', 'alibaba-cn'], qvq: ['alibaba', 'alibaba-cn'], qwq: ['alibaba', 'alibaba-cn'], tongyi: ['alibaba', 'alibaba-cn'],
  kimi: ['moonshotai', 'moonshotai-cn'], moonshot: ['moonshotai', 'moonshotai-cn'], k2p6: ['moonshotai', 'moonshotai-cn'],
  minimax: ['minimax', 'minimax-cn'], mimo: ['xiaomi'],
  mistral: ['mistral'], codestral: ['mistral'], devstral: ['mistral'], ministral: ['mistral'], magistral: ['mistral'],
  openMistral: ['mistral'], openMixtral: ['mistral'], pixtral: ['mistral'], voxtral: ['mistral'],
  glm: ['zai', 'zhipuai'], doubao: ['volcengine'], step: ['stepfun'], muse: ['meta'], llama: ['meta'],
  hy3: ['tencent'], ling: ['inclusionai'], ring: ['inclusionai'], agnes: ['sapiens'], longcat: ['meituan'],
};
const FAMILY_PATTERNS = [
  ['claude', /^claude-/], ['gpt', /^gpt-/], ['o1', /^o1(?:$|-)/], ['o3', /^o3(?:$|-)/], ['o4', /^o4-/],
  ['codex', /^codex-/], ['gemini', /^gemini-/], ['deepResearch', /^deep-research/], ['grok', /^grok-/], ['deepseek', /^deepseek-/],
  ['qwen', /^qwen/], ['qvq', /^qvq-/], ['qwq', /^qwq-/], ['tongyi', /^tongyi-/], ['kimi', /^kimi-/], ['moonshot', /^moonshot-/], ['k2p6', /^k2p6/],
  ['minimax', /^minimax-/], ['mimo', /^mimo-/], ['mistral', /^mistral-/], ['codestral', /^codestral-/], ['devstral', /^devstral-/],
  ['ministral', /^ministral-/], ['magistral', /^magistral-/], ['openMistral', /^open-mistral-/], ['openMixtral', /^open-mixtral-/],
  ['pixtral', /^pixtral-/], ['voxtral', /^voxtral-/], ['glm', /^(?:zai-glm|glm)-/], ['doubao', /^doubao-/], ['step', /^step-/],
  ['muse', /^muse-/], ['llama', /^llama-/], ['hy3', /^hy3(?:$|-)/], ['ling', /^ling-/], ['ring', /^ring-/], ['agnes', /^agnes-/], ['longcat', /^longcat-/],
];
function isOfficialKey(key) {
  const parts = key.split('/');
  const provider = parts[0], model = parts[parts.length - 1].toLowerCase();
  if (provider === 'google-vertex' || provider === 'google-vertex-anthropic') return false;
  if (provider === 'cursor') return true;
  for (const [family, re] of FAMILY_PATTERNS) {
    if (re.test(model)) return (OFFICIAL_PROVIDERS[family] ?? []).includes(provider);
  }
  return true;
}
const EXCLUDE_FAMILY = /embedding|rerank|moderation|tts|stt|audio|speech|video|realtime|live|transcription|midi|voxtral/i;
const EXCLUDE_ID = /embedding|rerank|moderation|tts|stt|lyria|-image\b|image-|-live\b|live-|realtime|transcription|speech|robotics|midi/i;
function isTextModel(model, id) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return false;
  if (EXCLUDE_FAMILY.test(model.family ?? '') || EXCLUDE_ID.test(model.id ?? id)) return false;
  if (model.modalities && (!Array.isArray(model.modalities.input) || !model.modalities.input.includes('text')
    || !Array.isArray(model.modalities.output) || !model.modalities.output.includes('text'))) return false;
  return true;
}
function validRate(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function toRates(cost) {
  const rates = {};
  for (const field of ['input', 'output', 'cache_read', 'cache_write']) {
    if (cost[field] === undefined) continue;
    if (!validRate(cost[field])) throw new Error(`models.dev cost.${field} must be finite and non-negative`);
    rates[field] = cost[field];
  }
  return rates;
}

/**
 * One pure conversion for bundled syncs and startup refreshes. Never writes files.
 * Manual mappings/supplements survive incomplete upstream coverage.
 * @param {import('./matcher.js').PricingData} current
 * @param {any} catalog
 * @param {string} generatedAt
 * @returns {import('./matcher.js').PricingData}
 */
export function mergeModelsDevPricing(current, catalog, generatedAt = new Date().toISOString()) {
  if (!catalog?.providers || typeof catalog.providers !== 'object' || Array.isArray(catalog.providers)
    || !Object.keys(catalog.providers).length) throw new Error('models.dev catalog is missing providers');
  const providers = catalog.providers, fresh = {}, subscriptionKeys = {};
  for (const [provider, entry] of Object.entries(providers)) {
    if (!SUBSCRIPTION_PROVIDERS.has(provider) && !SCOPED_PROVIDERS.has(provider)) continue;
    if (!entry?.models || typeof entry.models !== 'object' || Array.isArray(entry.models)) continue;
    for (const [modelId, model] of Object.entries(entry.models)) {
      if (!isTextModel(model, modelId)) continue;
      const key = `${provider}/${modelId}`;
      if (SUBSCRIPTION_PROVIDERS.has(provider)) { subscriptionKeys[key] = {}; continue; }
      if (!model.cost || model.cost.input === undefined || model.cost.output === undefined) continue;
      fresh[key] = toRates(model.cost);
    }
  }
  if (!Object.keys(fresh).length) throw new Error('models.dev catalog contains no supported text prices');
  const exact = { ...current.exact, ...fresh, ...OVERRIDES };
  for (const key of Object.keys(exact)) {
    if (SUBSCRIPTION_PROVIDERS.has(key.split('/')[0]) || !isOfficialKey(key)) delete exact[key];
  }
  return {
    ...current, exact,
    model_metadata: mergePricingModelMetadata(current.model_metadata, providers, exact, catalog.models ?? {}),
    subscription_models: mergePricingModelMetadata(current.subscription_models, providers, { ...current.subscription_models, ...subscriptionKeys }, catalog.models ?? {}),
    _meta: { ...current._meta, generated_at: generatedAt, source: MODELS_DEV_URL },
  };
}
