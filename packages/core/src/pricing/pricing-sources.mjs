import { mergeModelsDevPricing, MODELS_DEV_URL } from './models-dev.mjs';
import { LITELLM_URL, parseLiteLLMPricing, liteLLMRequestRules } from './litellm.mjs';

const FIELDS = ['input', 'output', 'cache_read', 'cache_write'];
const equal = (a, b) => FIELDS.every(field => a?.[field] === b?.[field]);
export function pricingComputationData(data) {
  if (!data) return null;
  return { exact: data.exact ?? {}, alias: data.alias ?? {}, sourceAlias: data.sourceAlias ?? {},
    fuzzy: data.fuzzy ?? [], default: data.default ?? null, request_rules: data.request_rules ?? [],
    automatic_rule_sources: data.automatic_rule_sources ?? [] };
}

/** Metadata timestamps and check summaries do not make a new published price table. */
export function pricingPublicationData(data) {
  if (!data) return null;
  return { ...pricingComputationData(data), model_metadata: data.model_metadata ?? {}, subscription_models: data.subscription_models ?? {},
    price_metadata: Object.fromEntries(Object.entries(data.price_metadata ?? {}).map(([key, info]) => {
      const { last_verified_at, ...identity } = info;
      return [key, identity];
    })) };
}

/**
 * Both runtime refreshes and bundled generation use this pure conversion.
 * @param {import('./matcher.js').PricingData} current
 * @param {{modelsDev?: any, liteLlm?: any, failedSources?: string[]}} sources
 * @returns {import('./matcher.js').PricingData}
 */
export function mergePricingSources(current, sources, checkedAt = new Date().toISOString()) {
  let next = { ...current, exact: { ...current.exact } };
  if (current.request_rules?.some(rule => rule.origin === 'litellm')) {
    next.automatic_rule_sources = [...new Set([...(current.automatic_rule_sources ?? []), 'litellm'])];
  }
  const metadata = { ...current.price_metadata }, observed = { 'models.dev': new Set(), litellm: new Set() };
  const report = { added: 0, changed: 0, carried: 0, missing_fields: 0, conflicts: 0, large_changes: 0,
    failed_sources: sources.failedSources ?? [], details: [] };
  const detail = value => { if (report.details.length < 50) report.details.push(value); };
  if (sources.modelsDev !== undefined) {
    const fresh = mergeModelsDevPricing({ exact: {} }, sources.modelsDev, checkedAt);
    next = mergeModelsDevPricing(next, sources.modelsDev, checkedAt);
    for (const key of Object.keys(fresh.exact)) {
      observed['models.dev'].add(key);
      const previous = current.price_metadata?.[key], old = current.exact[key], incoming = fresh.exact[key];
      const owned = previous?.source === 'litellm' ? ['cache_read', 'cache_write'] : previous?.supplemental_fields ?? [];
      const retained = old?.input === incoming.input && old?.output === incoming.output
        ? owned.filter(field => incoming[field] === undefined && next.exact[key][field] !== undefined) : [];
      metadata[key] = { source: 'models.dev', status: 'current', last_verified_at: checkedAt,
        ...(retained.length ? { supplemental_source: 'litellm', supplemental_fields: retained } : {}) };
    }
  }
  if (sources.liteLlm !== undefined) {
    const rows = parseLiteLLMPricing(sources.liteLlm);
    const automatic = [];
    for (const [key, { rates }] of Object.entries(rows)) {
      const existing = next.exact[key];
      if (!existing || metadata[key]?.source === 'litellm' && !observed['models.dev'].has(key)) {
        next.exact[key] = existing?.input === rates.input && existing?.output === rates.output ? { ...existing, ...rates } : rates;
        metadata[key] = { source: 'litellm', status: 'current', last_verified_at: checkedAt };
      } else if (existing.input !== rates.input || existing.output !== rates.output) {
        report.conflicts++; detail({ model: key, kind: 'conflict', primary: existing, secondary: rates });
        continue;
      } else {
        const supplemental = [...(metadata[key]?.supplemental_fields ?? [])];
        next.exact[key] = { ...existing };
        for (const field of FIELDS) {
          if ((existing[field] === undefined || supplemental.includes(field)) && rates[field] !== undefined) {
            next.exact[key][field] = rates[field]; if (!supplemental.includes(field)) supplemental.push(field);
          }
        }
        if (supplemental.length) {
          metadata[key] = { ...(metadata[key] ?? {}), supplemental_source: 'litellm', supplemental_fields: supplemental };
        }
        if (!metadata[key]?.source && equal(existing, rates)) {
          metadata[key] = { source: 'litellm', status: 'current', last_verified_at: checkedAt };
        }
      }
      observed.litellm.add(key);
      automatic.push(...liteLLMRequestRules(key, rows[key].entry, next.exact[key]));
    }
    const existingRules = next.request_rules ?? [];
    next.request_rules = [...automatic,
      ...existingRules.filter(rule => rule.origin === 'litellm' && !Object.hasOwn(rows, rule.model)),
      ...existingRules.filter(rule => rule.origin !== 'litellm')];
    next.automatic_rule_sources = [...new Set([...(current.automatic_rule_sources ?? []), 'litellm'])];
  }
  for (const [key, info] of Object.entries(metadata)) {
    const sourceAvailable = info.source === 'models.dev' ? sources.modelsDev !== undefined : info.source === 'litellm' && sources.liteLlm !== undefined;
    if (sourceAvailable && !observed[info.source].has(key)) metadata[key] = { ...info, status: 'carried' };
    if (!next.exact[key]) delete metadata[key];
  }
  for (const [key, rates] of Object.entries(next.exact)) {
    const old = current.exact[key];
    if (!old) report.added++;
    else if (!equal(old, rates)) {
      report.changed++;
      const large = FIELDS.some(field => old[field] !== undefined && rates[field] !== undefined && old[field] !== rates[field]
        && (old[field] === 0 || rates[field] === 0 || rates[field] / old[field] >= 2 || rates[field] / old[field] <= 0.5));
      if (large) report.large_changes++;
      detail({ model: key, kind: large ? 'large_change' : 'changed', previous: old, current: rates });
    }
    if (metadata[key]?.status === 'carried') report.carried++;
    report.missing_fields += FIELDS.filter(field => rates[field] === undefined).length;
  }
  return { ...next, price_metadata: metadata, _meta: { ...next._meta, checked_at: checkedAt,
    generated_at: next._meta?.generated_at ?? checkedAt, sources: ['models.dev', 'litellm'], sync_report: report } };
}

/** Fetch failures and malformed sources are independent; none can erase a valid table.
 * @param {import('./matcher.js').PricingData} current
 * @param {typeof fetch} fetchImpl
 * @param {AbortSignal | undefined} signal
 */
export async function loadPricingSources(current, fetchImpl = fetch, signal = undefined, checkedAt = new Date().toISOString()) {
  const definitions = [['models.dev', MODELS_DEV_URL], ['litellm', LITELLM_URL]];
  const results = await Promise.allSettled(definitions.map(async ([name, url]) => {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`pricing source HTTP ${response.status}`); }
    const raw = await response.json();
    if (name === 'models.dev') mergeModelsDevPricing({ exact: {} }, raw, checkedAt);
    else parseLiteLLMPricing(raw);
    return raw;
  }));
  signal?.throwIfAborted();
  const sources = { failedSources: [] };
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') sources[i === 0 ? 'modelsDev' : 'liteLlm'] = result.value;
    else sources.failedSources.push(definitions[i][0]);
  });
  if (results.every(result => result.status === 'rejected')) throw new Error('all pricing sources unavailable or invalid');
  return mergePricingSources(current, sources, checkedAt);
}
