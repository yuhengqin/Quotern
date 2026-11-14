import { readFileSync, watchFile, unwatchFile } from 'node:fs';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { getManualPricing, applyManualPricing, loadManualPricing, manualPricingPath, type ManualPricingDocument } from './manual-pricing.js';
export * from './manual-pricing.js';
import { isDeepStrictEqual } from 'node:util';
import { EnvHttpProxyAgent } from 'undici';
import { MODELS_DEV_URL } from './models-dev.mjs';
import { loadPricingSources, pricingComputationData, pricingPublicationData } from './pricing-sources.mjs';
import type { QueueBucket } from '../types.js';
import { builtinRequestRules, priceRequest, tokenCostItem, TOKEN_FIELDS, validRequestRules, REQUEST_PRICING_REVISION, type TokenCostItem } from './request-pricing.js';
export * from './request-pricing.js';
import { pricingOverlayPath } from '../paths.js';
import pricingData from './pricing.json' with { type: 'json' };
import {
  BAKED_PRICING_TTL_MS,
  BAKED_PRICING_URL,
} from './baked-defaults.js';
import {
  hasNonZeroPricing,
  lookupPricingStacked,
  type ModelPricingRates,
  type PricingData,
} from './matcher.js';

export type ModelPricing = Required<{
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}>;

export type { ModelPricingRates, PricingData };
export { lookupPricing, lookupPricingStacked, hasNonZeroPricing } from './matcher.js';
export { BAKED_PRICING_URL, BAKED_PRICING_TTL_MS } from './baked-defaults.js';

const ZERO_PRICING: ModelPricing = {
  input: 0,
  output: 0,
  cache_read: 0,
  cache_write: 0,
};

/** The packaged table is never mutated; only explicit demo replay replaces the active reference. */
const packagedPricing = pricingData as PricingData;
let builtinPricing = packagedPricing;

/** Optional remote partial overlay (exact/alias/fuzzy/default). */
let remoteOverlay: PricingData | null = null;
const modelMatchCache = new Map<string, ReturnType<typeof lookupPricingStacked>>();
let matchedBuiltin = builtinPricing;
let matchedOverlay: PricingData | null = remoteOverlay;
let matchedManual = getManualPricing();

/** Catalog identity is stable between applied snapshots; observations reuse model matches. */
function currentModelMatch(model: string, source?: string | null): ReturnType<typeof lookupPricingStacked> {
  if (matchedBuiltin !== builtinPricing || matchedOverlay !== remoteOverlay || matchedManual !== getManualPricing()) {
    modelMatchCache.clear(); matchedBuiltin = builtinPricing; matchedOverlay = remoteOverlay; matchedManual = getManualPricing();
  }
  const key = JSON.stringify([source ?? null, model]);
  let result = modelMatchCache.get(key);
  if (!result) {
    result = matchWithManual(model, matchedManual, source);
    modelMatchCache.set(key, result);
    while (modelMatchCache.size > 1024) modelMatchCache.delete(modelMatchCache.keys().next().value!);
  }
  return result;
}

function matchWithManual(model: string, document: ManualPricingDocument, source?: string | null): ReturnType<typeof lookupPricingStacked> {
  const result = lookupPricingStacked(model, remoteOverlay, builtinPricing, source ?? null);
  const explicitMatch = result.source === 'exact' || result.source === 'alias' || result.source.startsWith('sourceAlias:');
  const manual = Object.hasOwn(document.models, model) ? document.models[model] : explicitMatch && result.matchedModel && Object.hasOwn(document.models, result.matchedModel) ? document.models[result.matchedModel] : undefined;
  return manual ? { ...result, hit: true, value: { ...result.value, ...manual }, matchedModel: result.matchedModel ?? model, source: 'manual' } : result;
}

/** Base rates only. Removing an exact override may reveal an override on its resolved alias target. */
export function getPricingEditPreview(model: string, document = getManualPricing()) {
  const models = { ...document.models }; delete models[model];
  return { reference: lookupPricingStacked(model, remoteOverlay, builtinPricing, null).value,
    effective: matchWithManual(model, document).value, restored: matchWithManual(model, { version: 1, models }).value };
}

export interface PricingSnapshot { builtin: PricingData; overlay: PricingData | null; manual?: ManualPricingDocument }
/** Capture both matching layers; flattening them changes alias/fuzzy precedence. */
export function getPricingSnapshot(): PricingSnapshot { return { builtin: builtinPricing, overlay: remoteOverlay, manual: getManualPricing() }; }
let fingerprintState: PricingSnapshot | null = null, fingerprint = '';
export function getPricingFingerprint(): string {
  const next = getPricingSnapshot();
  if (!fingerprintState || next.builtin !== fingerprintState.builtin || next.overlay !== fingerprintState.overlay || next.manual !== fingerprintState.manual) {
    fingerprintState = next; fingerprint = createHash('sha256').update(JSON.stringify({ builtin: pricingComputationData(next.builtin),
      overlay: pricingComputationData(next.overlay), manual: next.manual, requestPricingRevision: REQUEST_PRICING_REVISION })).digest('hex');
  }
  return fingerprint;
}
/** Explicit, process-local replay for the separate demo process. Null restores packaged pricing. */
export function applyPricingSnapshot(snapshot: PricingSnapshot | null): void {
  builtinPricing = snapshot?.builtin ?? packagedPricing;
  applyManualPricing(snapshot?.manual ?? { version: 1, models: {} });
  applyRemotePricingOverlay(snapshot?.overlay ?? null);
}

let pricingRefreshUrl: string | null = null;
let pricingUpdatedAt: string | null = null;
let pricingCheckedAt: string | null = null;
let pricingDiskWrites: Promise<void> = Promise.resolve();
let pricingRefreshStop: (() => void) | null = null;
let pricingRefreshController: AbortController | null = null;
export const DEFAULT_PRICING_TTL_MS = 24 * 3_600_000;
/** Desktop / CLI wait this long for the first overlay fetch before opening. */
export const DEFAULT_PRICING_FIRST_FETCH_TIMEOUT_MS = 3_000;

export interface PricingStatus {
  hasOverlay: boolean;
  refreshing: boolean;
  url: string | null;
  updatedAt: string | null;
  checkedAt: string | null;
}

export interface StartPricingRefreshOptions {
  url: string;
  /** Revalidate after this many ms; startup still performs its initial fetch. */
  ttlMs?: number;
  /** Observers follow the owner's disk changes without a second periodic fetch. */
  periodic?: boolean;
  fetchImpl?: typeof fetch;
  onUpdate?: (status: PricingStatus, change: { ratesChanged: boolean }) => void;
  onError?: (err: unknown) => void;
  /** Persist overlay under this data dir (`pricing-overlay.json`). */
  dataDir?: string;
  /**
   * Wait for the first network fetch up to this many ms.
   * 0 (default) keeps the old fire-and-forget behavior.
   */
  firstFetchTimeoutMs?: number;
}

/** Stop function; `.ready` settles after the optional first-fetch wait. */
export type PricingRefreshHandle = (() => void) & {
  ready: Promise<boolean>;
  refreshIfStale(): Promise<boolean>;
};

function toModelPricing(rates: ModelPricingRates | null): ModelPricing {
  return {
    input: rates?.input ?? 0,
    output: rates?.output ?? 0,
    cache_read: rates?.cache_read ?? 0,
    cache_write: rates?.cache_write ?? 0,
  };
}

function isFiniteNonNeg(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

function validateRates(rates: unknown, path: string): string | null {
  if (rates == null || typeof rates !== 'object' || Array.isArray(rates)) {
    return `${path} must be an object`;
  }
  const o = rates as Record<string, unknown>;
  for (const key of ['input', 'output', 'cache_read', 'cache_write'] as const) {
    if (o[key] === undefined) continue;
    if (!isFiniteNonNeg(o[key])) {
      return `${path}.${key} must be a finite number >= 0`;
    }
  }
  return null;
}

/**
 * Structural validation for remote overlay JSON.
 * `exact` may be `{}`; pure alias/default overlays are allowed.
 */
export function validatePricingData(raw: unknown): { ok: true; data: PricingData } | { ok: false; error: string } {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'pricing JSON must be an object' };
  }
  const obj = raw as Record<string, unknown>;

  let exact: Record<string, ModelPricingRates> = {};
  if (obj.exact !== undefined) {
    if (obj.exact == null || typeof obj.exact !== 'object' || Array.isArray(obj.exact)) {
      return { ok: false, error: 'exact must be an object' };
    }
    exact = {};
    for (const [key, rates] of Object.entries(obj.exact as Record<string, unknown>)) {
      const err = validateRates(rates, `exact.${key}`);
      if (err) return { ok: false, error: err };
      exact[key] = rates as ModelPricingRates;
    }
  }

  let alias: Record<string, string> | undefined;
  if (obj.alias !== undefined) {
    if (obj.alias == null || typeof obj.alias !== 'object' || Array.isArray(obj.alias)) {
      return { ok: false, error: 'alias must be an object' };
    }
    alias = {};
    for (const [k, v] of Object.entries(obj.alias as Record<string, unknown>)) {
      if (typeof v !== 'string' || !v.trim()) {
        return { ok: false, error: `alias.${k} must be a non-empty string` };
      }
      alias[k] = v;
    }
  }

  let fuzzy: Array<{ match: string; ref: string }> | undefined;
  if (obj.fuzzy !== undefined) {
    if (!Array.isArray(obj.fuzzy)) {
      return { ok: false, error: 'fuzzy must be an array' };
    }
    fuzzy = [];
    for (let i = 0; i < obj.fuzzy.length; i++) {
      const row = obj.fuzzy[i];
      if (row == null || typeof row !== 'object' || Array.isArray(row)) {
        return { ok: false, error: `fuzzy[${i}] must be an object` };
      }
      const match = (row as { match?: unknown }).match;
      const ref = (row as { ref?: unknown }).ref;
      if (typeof match !== 'string' || !match || typeof ref !== 'string' || !ref) {
        return { ok: false, error: `fuzzy[${i}] needs non-empty match and ref strings` };
      }
      fuzzy.push({ match, ref });
    }
  }

  let sourceAlias: Record<string, Record<string, string>> | undefined;
  if (obj.sourceAlias !== undefined) {
    if (obj.sourceAlias == null || typeof obj.sourceAlias !== 'object' || Array.isArray(obj.sourceAlias)) {
      return { ok: false, error: 'sourceAlias must be an object' };
    }
    sourceAlias = {};
    for (const [src, map] of Object.entries(obj.sourceAlias as Record<string, unknown>)) {
      if (map == null || typeof map !== 'object' || Array.isArray(map)) {
        return { ok: false, error: `sourceAlias.${src} must be an object` };
      }
      const inner: Record<string, string> = {};
      for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
        if (typeof v !== 'string' || !v.trim()) {
          return { ok: false, error: `sourceAlias.${src}.${k} must be a non-empty string` };
        }
        inner[k] = v;
      }
      sourceAlias[src] = inner;
    }
  }

  let defaultRates: ModelPricingRates | undefined;
  if (obj.default !== undefined) {
    const err = validateRates(obj.default, 'default');
    if (err) return { ok: false, error: err };
    defaultRates = obj.default as ModelPricingRates;
  }

  const data: PricingData = { exact };
  if (obj.automatic_rule_sources !== undefined) {
    if (!Array.isArray(obj.automatic_rule_sources) || obj.automatic_rule_sources.some(value => value !== 'litellm')) return { ok: false, error: 'invalid automatic_rule_sources' };
    data.automatic_rule_sources = [...new Set(obj.automatic_rule_sources)] as Array<'litellm'>;
  }
  if (obj.request_rules !== undefined) {
    if (!validRequestRules(obj.request_rules)) return { ok: false, error: 'invalid request_rules' };
    data.request_rules = obj.request_rules;
  }
  if (obj._meta != null && typeof obj._meta === 'object' && !Array.isArray(obj._meta)) {
    data._meta = obj._meta as Record<string, unknown>;
  }
  if (alias) data.alias = alias;
  if (fuzzy) data.fuzzy = fuzzy;
  if (sourceAlias) data.sourceAlias = sourceAlias;
  if (defaultRates) data.default = defaultRates;
  for (const field of ['model_metadata', 'subscription_models', 'price_metadata'] as const) {
    if (obj[field] === undefined) continue;
    const metadata = obj[field];
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return { ok: false, error: `${field} must be an object` };
    for (const value of Object.values(metadata)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: `${field} entries must be objects` };
    }
    data[field] = metadata as NonNullable<PricingData[typeof field]>;
  }
  for (const info of Object.values(data.price_metadata ?? {})) {
    if (info.source !== undefined && !['models.dev', 'litellm', 'manual'].includes(info.source)
      || info.status !== undefined && !['current', 'carried'].includes(info.status)
      || info.last_verified_at !== undefined && (typeof info.last_verified_at !== 'string' || !Number.isFinite(Date.parse(info.last_verified_at)))
      || info.supplemental_source !== undefined && info.supplemental_source !== 'litellm'
      || info.supplemental_fields !== undefined && (!Array.isArray(info.supplemental_fields) || info.supplemental_fields.some(key => !['input', 'output', 'cache_read', 'cache_write'].includes(key)))) {
      return { ok: false, error: 'invalid price_metadata' };
    }
  }

  return { ok: true, data };
}

/** Replace (or clear) the in-memory remote overlay. Does not touch builtin. */
export function applyRemotePricingOverlay(data: PricingData | null): void {
  remoteOverlay = data;
  pricingUpdatedAt = data ? new Date().toISOString() : null;
  const checkedAt = data?._meta?.checked_at;
  pricingCheckedAt = typeof checkedAt === 'string' && Number.isFinite(Date.parse(checkedAt)) ? checkedAt : null;
}

/** Load a previously saved overlay from `dataDir`. Invalid/missing files are ignored. */
export function loadCachedPricingOverlay(dataDir: string): boolean {
  try { loadManualPricing(dataDir); } catch { /* Keep the last validated manual layer. Management reports corrupt files. */ }
  try {
    const raw = readFileSync(pricingOverlayPath(dataDir), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const validated = validatePricingData(parsed);
    if (!validated.ok) return false;
    applyRemotePricingOverlay(validated.data);
    return true;
  } catch {
    return false;
  }
}

/** Persist the current overlay so the next cold start can apply it synchronously. */
export async function saveCachedPricingOverlay(
  dataDir: string,
  data: PricingData,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const save = pricingDiskWrites.catch(() => {}).then(async () => {
    if (!isCurrent()) return;
    const target = pricingOverlayPath(dataDir), temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(data)}\n`, 'utf8');
      if (isCurrent()) await rename(temporary, target);
    } finally { await unlink(temporary).catch(() => {}); }
  });
  pricingDiskWrites = save;
  await save;
}

export function getPricingStatus(): PricingStatus {
  return {
    hasOverlay: remoteOverlay != null,
    refreshing: pricingRefreshController != null && !pricingRefreshController.signal.aborted,
    url: pricingRefreshUrl,
    updatedAt: pricingUpdatedAt,
    checkedAt: pricingCheckedAt,
  };
}

/**
 * Current validated remote overlay, if one has been loaded.
 *
 * The public API publishes a remote pricing overlay to clients.
 * Callers must treat the returned object as read-only.
 */
export function getRemotePricingOverlay(): PricingData | null {
  return remoteOverlay;
}

let tableRulesCache: { builtin: PricingData; overlay: PricingData | null; rules: NonNullable<PricingData['request_rules']> } | null = null;
function tableRequestRules() {
  if (tableRulesCache?.builtin === builtinPricing && tableRulesCache.overlay === remoteOverlay) return tableRulesCache.rules;
  const replaced = new Set(remoteOverlay?.automatic_rule_sources ?? []);
  const all = [...(builtinPricing.request_rules ?? []).filter(rule => !rule.origin || !replaced.has(rule.origin)), ...(remoteOverlay?.request_rules ?? [])];
  const seen = new Set<string>();
  const rules = all.reverse().filter(rule => {
    const key = JSON.stringify(rule);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).reverse();
  tableRulesCache = { builtin: builtinPricing, overlay: remoteOverlay, rules };
  return rules;
}

/** Full display/conversion snapshot; cost matching continues to use layered lookup. */
export function getReferencePricingData(): PricingData {
  if (!remoteOverlay) return builtinPricing;
  return {
    ...builtinPricing, ...remoteOverlay,
    exact: { ...builtinPricing.exact, ...remoteOverlay.exact },
    request_rules: tableRequestRules(),
    automatic_rule_sources: [...new Set([...(builtinPricing.automatic_rule_sources ?? []), ...(remoteOverlay.automatic_rule_sources ?? [])])],
    price_metadata: { ...builtinPricing.price_metadata, ...remoteOverlay.price_metadata },
    model_metadata: { ...builtinPricing.model_metadata, ...remoteOverlay.model_metadata },
    subscription_models: { ...builtinPricing.subscription_models, ...remoteOverlay.subscription_models },
    alias: { ...builtinPricing.alias, ...remoteOverlay.alias },
    sourceAlias: Object.fromEntries([...new Set([...Object.keys(builtinPricing.sourceAlias ?? {}), ...Object.keys(remoteOverlay.sourceAlias ?? {})])]
      .map(source => [source, { ...builtinPricing.sourceAlias?.[source], ...remoteOverlay!.sourceAlias?.[source] }])),
  };
}

/** UI catalog includes explicit manual IDs; fuzzy cost lookup continues to use reference layers. */
export function getEffectivePricingData(): PricingData {
  const reference = getReferencePricingData(), manual = getManualPricing().models;
  if (!Object.keys(manual).length) return reference;
  return { ...reference, exact: { ...reference.exact, ...Object.fromEntries(Object.keys(manual).map(model => [model, getModelPricingRates(model)!])) },
    price_metadata: { ...reference.price_metadata, ...Object.fromEntries(Object.keys(manual).map(model => [model, { source: 'manual' as const }])) } };
}

/** Test helper: clear overlay and cancel any pending refresh. */
export function resetPricingRuntime(): void {
  pricingRefreshStop?.();
  pricingRefreshStop = null;
  pricingRefreshController = null;
  remoteOverlay = null;
  applyManualPricing({ version: 1, models: {} });
  pricingRefreshUrl = null;
  pricingUpdatedAt = null;
  pricingCheckedAt = null;
}

async function fetchAndApplyOverlay(
  url: string,
  fetchImpl: typeof fetch,
  dataDir?: string,
  signal?: AbortSignal,
  useProxy = false,
): Promise<{ changed: boolean; ratesChanged: boolean }> {
  const dispatcher = useProxy ? new EnvHttpProxyAgent() : undefined;
  try {
    const requested = new URL(url), upstream = new URL(MODELS_DEV_URL);
    const isModelsDev = requested.origin === upstream.origin && requested.pathname === upstream.pathname;
    const fetchSource: typeof fetch = (input, options) => fetchImpl(input, { ...options, ...(dispatcher ? { dispatcher } : {}) } as RequestInit);
    let converted: unknown;
    if (isModelsDev) converted = await loadPricingSources(getReferencePricingData(), fetchSource, signal);
    else {
      const res = await fetchSource(url, { headers: { Accept: 'application/json' }, signal });
      if (!res.ok) { await res.body?.cancel(); throw new Error(`pricing fetch HTTP ${res.status}`); }
      converted = await res.json();
    }
    const validated = validatePricingData(converted);
    if (!validated.ok) throw new Error(validated.error);
    signal?.throwIfAborted();
    const changed = !isDeepStrictEqual(pricingPublicationData(validated.data), pricingPublicationData(remoteOverlay));
    const before = getPricingFingerprint();
    validated.data._meta = { ...validated.data._meta, checked_at: new Date().toISOString() };
    applyRemotePricingOverlay(validated.data);
    const ratesChanged = before !== getPricingFingerprint();
    if (dataDir) {
      try { await saveCachedPricingOverlay(dataDir, validated.data, () => !signal?.aborted); }
      catch { /* A disk write failure must not drop valid in-memory prices. */ }
    }
    return { changed, ratesChanged };
  } finally { await dispatcher?.close(); }
}

/**
 * Fetch at startup, then revalidate stale prices while the runtime is alive.
 * Failures keep the previous overlay (or builtin-only). Never throws to caller.
 * Returns a stop() function; `ready` waits for the optional first-fetch timeout.
 */
export function startPricingRefresh(
  opts: StartPricingRefreshOptions,
): PricingRefreshHandle {
  pricingRefreshStop?.();
  pricingRefreshStop = null;
  if (opts.dataDir) loadCachedPricingOverlay(opts.dataDir);
  let stopped = false;
  const manualFile = opts.dataDir ? manualPricingPath(opts.dataDir) : null;
  const onManualChange = () => {
    try { if (!stopped && opts.dataDir && loadManualPricing(opts.dataDir)) opts.onUpdate?.(getPricingStatus(), { ratesChanged: true }); }
    catch (error) { opts.onError?.(error); }
  };
  if (manualFile) watchFile(manualFile, { interval: 1000, persistent: false }, onManualChange);
  const overlayFile = opts.dataDir ? pricingOverlayPath(opts.dataDir) : null;
  const onOverlayChange = () => {
    if (stopped || !opts.dataDir) return;
    const before = getPricingFingerprint(), publication = pricingPublicationData(remoteOverlay);
    if (loadCachedPricingOverlay(opts.dataDir) && !isDeepStrictEqual(publication, pricingPublicationData(remoteOverlay))) {
      opts.onUpdate?.(getPricingStatus(), { ratesChanged: before !== getPricingFingerprint() });
    }
  };
  if (overlayFile) watchFile(overlayFile, { interval: 1000, persistent: false }, onOverlayChange);
  const stopWatches = () => {
    if (manualFile) unwatchFile(manualFile, onManualChange);
    if (overlayFile) unwatchFile(overlayFile, onOverlayChange);
  };
  const url = opts.url.trim();
  pricingRefreshUrl = url || null;
  if (!url) {
    const noop = (() => { stopped = true; stopWatches(); }) as PricingRefreshHandle;
    noop.ready = Promise.resolve(getPricingStatus().hasOverlay);
    noop.refreshIfStale = () => Promise.resolve(false);
    pricingRefreshStop = noop;
    return noop;
  }

  const ttlMs = opts.ttlMs && Number.isFinite(opts.ttlMs) && opts.ttlMs > 0 ? opts.ttlMs : DEFAULT_PRICING_TTL_MS;
  let inFlight: Promise<boolean> | null = null, controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requestTimeout: ReturnType<typeof setTimeout> | undefined;
  let lastSuccess: number | null = null, retryAt = 0;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const firstFetchTimeoutMs =
    opts.firstFetchTimeoutMs != null &&
    Number.isFinite(opts.firstFetchTimeoutMs) &&
    opts.firstFetchTimeoutMs > 0
      ? opts.firstFetchTimeoutMs
      : 0;

  const schedule = () => {
    clearTimeout(timer);
    if (stopped || opts.periodic === false) return;
    const due = Math.max(retryAt, lastSuccess === null ? Date.now() : lastSuccess + ttlMs);
    timer = setTimeout(() => { void refreshIfStale(); }, Math.max(1, due - Date.now()));
    timer.unref?.();
  };
  const refreshIfStale = (force = false): Promise<boolean> => {
    if (stopped) return Promise.resolve(false);
    if (inFlight) return inFlight;
    if (!force && (Date.now() < retryAt || lastSuccess !== null && Date.now() - lastSuccess < ttlMs)) return Promise.resolve(false);
    const active = new AbortController(); controller = active; pricingRefreshController = active;
    const networkTimeout = setTimeout(() => active.abort(new Error('pricing fetch timed out')), 30_000);
    requestTimeout = networkTimeout;
    networkTimeout.unref?.();
    const job = (async () => {
      try {
        const change = await fetchAndApplyOverlay(url, fetchImpl, opts.dataDir, active.signal, !opts.fetchImpl);
        if (stopped || active.signal.aborted) return false;
        lastSuccess = Date.now(); retryAt = 0; pricingCheckedAt = new Date(lastSuccess).toISOString();
        if (change.changed) opts.onUpdate?.(getPricingStatus(), { ratesChanged: change.ratesChanged });
        return true;
      } catch (err) {
        retryAt = Date.now() + 3_600_000;
        if (!stopped && (!active.signal.aborted || active.signal.reason?.message === 'pricing fetch timed out')) opts.onError?.(err);
        return false;
      } finally {
        clearTimeout(networkTimeout);
        if (pricingRefreshController === active) pricingRefreshController = null;
      }
    })().finally(() => { if (inFlight === job) inFlight = null; schedule(); });
    inFlight = job;
    return job;
  };
  const first = refreshIfStale(true);
  let waitTimer: ReturnType<typeof setTimeout> | undefined;
  const ready =
    firstFetchTimeoutMs > 0
      ? Promise.race([
          first,
          new Promise<boolean>((resolve) => {
            waitTimer = setTimeout(() => resolve(false), firstFetchTimeoutMs);
          }),
        ]).finally(() => clearTimeout(waitTimer))
      : Promise.resolve(getPricingStatus().hasOverlay);

  const stop = (() => {
    stopped = true; stopWatches(); clearTimeout(timer); clearTimeout(requestTimeout);
    controller?.abort();
  }) as PricingRefreshHandle;
  stop.ready = ready;
  stop.refreshIfStale = () => refreshIfStale();
  pricingRefreshStop = stop;
  return stop;
}

/**
 * Resolve pricing URL/TTL from env + config + package bake.
 * Env overrides for the process only (does not rewrite config).
 * Empty strings are treated as unset.
 */
export function resolvePricingRefreshConfig(opts?: {
  url?: string | null;
  ttlMs?: number | null;
}): { url: string | null; ttlMs: number } {
  const envUrl = process.env.TUD_PRICING_URL?.trim() || process.env.PRICING_URL?.trim() || '';
  const configUrl = opts?.url?.trim() || '';
  const bakedUrl = BAKED_PRICING_URL.trim();
  const url = envUrl || configUrl || bakedUrl || null;

  const envTtlRaw = process.env.TUD_PRICING_TTL_MS?.trim() || process.env.PRICING_TTL_MS?.trim();
  let ttlMs = BAKED_PRICING_TTL_MS > 0 ? BAKED_PRICING_TTL_MS : DEFAULT_PRICING_TTL_MS;
  if (envTtlRaw) {
    const n = Number.parseInt(envTtlRaw, 10);
    if (Number.isFinite(n) && n > 0) ttlMs = n;
  } else if (opts?.ttlMs != null && Number.isFinite(opts.ttlMs) && opts.ttlMs > 0) {
    ttlMs = opts.ttlMs;
  }

  return { url, ttlMs };
}

export function getModelPricing(model: string, opts?: { source?: string }): ModelPricing {
  const result = currentModelMatch(model, opts?.source);
  return toModelPricing(result.value);
}

/** Display evidence retains absent rates; absence is not an explicit free rate. */
export function getModelPricingRates(model:string,opts?:{source?:string}):ModelPricingRates|null {
  return currentModelMatch(model, opts?.source).value;
}

export function isModelPriced(model: string, source?: string): boolean {
  const result = currentModelMatch(model, source);
  return result.source === 'manual' || hasNonZeroPricing(result.value);
}

/** Match server/API cost precision: keep 8 decimals until UI rounds to cents. */
export function roundCostUsd(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

export function computeRowCost(row: QueueBucket): number {
  if (
    row.source === 'cursor' &&
    row.reported_cost_usd != null &&
    Number.isFinite(row.reported_cost_usd) &&
    row.reported_cost_usd > 0
  ) {
    return row.reported_cost_usd;
  }

  if (row.pricing_requests?.length) return requestAwareCost(row).cost;
  const pricing = getModelPricing(row.model, { source: row.source });
  const reasoningIncludedInOutput = row.source === 'codex' || row.source === 'every-code';
  const reasoningCost = reasoningIncludedInOutput
    ? 0
    : (row.reasoning_output_tokens || 0) * pricing.output;

  return (
    ((row.input_tokens || 0) * pricing.input +
      (row.output_tokens || 0) * pricing.output +
      (row.cached_input_tokens || 0) * pricing.cache_read +
      (row.cache_creation_input_tokens || 0) * pricing.cache_write +
      reasoningCost) /
    1_000_000
  );
}

export type CostKind = 'reported' | 'model_estimate' | 'default_estimate' | 'unpriced';

export interface RowCostExplanation {
  manualPricing?: boolean;
  /** Category amounts from the same effective rates as the cost calculation. */
  items?: TokenCostItem[];
  requestPricing?: { requests: number; ruleReferences: string[]; legacyTokens: number; serviceTiers: string[] };
  source: string;
  model: string;
  matchedModel: string | null;
  matchMethod: string;
  priceTable: 'overlay' | 'builtin' | null;
  /** Table publication timestamp, never the time this process loaded the table. */
  priceUpdatedAt: string | null;
  costKind: CostKind;
  /** Known amount only; null means none of the consumed token fields has a price. */
  costUsd: number | null;
  tokens: number;
  unpricedTokens: number;
}

/** Explain the same calculation as computeRowCost without turning missing rates into free usage. */
export function explainRowCost(row: QueueBucket): RowCostExplanation {
  const tokens = computeTokens(row);
  if (row.source === 'cursor' && Number.isFinite(row.reported_cost_usd) && (row.reported_cost_usd ?? 0) > 0) {
    return {
      source: row.source, model: row.model, matchedModel: null,
      matchMethod: 'reported', priceTable: null, priceUpdatedAt: null,
      costKind: 'reported', costUsd: row.reported_cost_usd!, tokens, unpricedTokens: 0,
    };
  }
  const match = currentModelMatch(row.model, row.source);
  const table = match.table === 'overlay' ? remoteOverlay : builtinPricing;
  const published = table?._meta?.generated_at ?? table?._meta?.updated_at;
  const priceUpdatedAt = typeof published === 'string' && Number.isFinite(Date.parse(published))
    ? published : null;
  const fields: Array<[number, keyof ModelPricingRates]> = [
    [row.input_tokens ?? 0, 'input'],
    [row.output_tokens ?? 0, 'output'],
    [row.cached_input_tokens ?? 0, 'cache_read'],
    [row.cache_creation_input_tokens ?? 0, 'cache_write'],
    [row.reasoning_output_tokens ?? 0, 'output'],
  ];
  let unpricedTokens = fields.reduce((sum, [count, field]) => {
    const rate = match.value?.[field];
    return sum + (count > 0 && !(typeof rate === 'number' && Number.isFinite(rate) && rate >= 0) ? count : 0);
  }, 0);
  const requestCost = row.pricing_requests?.length ? requestAwareCost(row) : null;
  if (requestCost) unpricedTokens = requestCost.unpricedTokens;
  const entirelyUnpriced = tokens > 0 && unpricedTokens >= tokens;
  return {
    source: row.source, model: row.model, matchedModel: match.matchedModel ?? null,
    ...(match.source === 'manual' ? { manualPricing: true } : {}),
    matchMethod: match.source, priceTable: match.table ?? null, priceUpdatedAt,
    costKind: entirelyUnpriced || !match.value ? 'unpriced' : match.source === 'default' ? 'default_estimate' : 'model_estimate',
    costUsd: entirelyUnpriced || !match.value ? null : computeRowCost(row),
    tokens, unpricedTokens,
    items: requestCost?.items ?? [
      tokenCostItem('input', row.input_tokens ?? 0, match.value?.input),
      tokenCostItem('output', (row.output_tokens ?? 0) + (row.source === 'codex' || row.source === 'every-code' ? 0 : row.reasoning_output_tokens ?? 0), match.value?.output),
      tokenCostItem('cache_read', row.cached_input_tokens ?? 0, match.value?.cache_read),
      tokenCostItem('cache_write', row.cache_creation_input_tokens ?? 0, match.value?.cache_write),
    ],
    ...(requestCost ? { requestPricing: requestCost.evidence } : {}),
  };
}

/** Annotated request quantities replace the same quantities in the legacy bucket. */
function requestAwareCost(row: QueueBucket) {
  const match = currentModelMatch(row.model, row.source);
  const base = match.value ?? {};
  const rules = [...builtinRequestRules(match.matchedModel ?? '', row.source, base), ...tableRequestRules()]
    .filter(rule => rule.source === row.source && (rule.model === match.matchedModel || rule.model === row.model));
  const remainder = { ...row, pricing_requests: undefined };
  let cost = 0, unpricedTokens = 0;
  const items: TokenCostItem[] = [];
  const references = new Set<string>(), tiers = new Set<string>();
  let requests = 0;
  for (const fact of row.pricing_requests ?? []) {
    if (!fact.id || !Number.isFinite(Date.parse(fact.timestamp)) || !TOKEN_FIELDS.every(key => Number.isFinite(fact[key]) && fact[key] >= 0)) continue;
    if ([fact.requestInputTokens, fact.cacheWrite5mTokens, fact.cacheWrite1hTokens].some(n => n !== undefined && (!Number.isFinite(n) || n < 0))) continue;
    // Historical partial annotations cannot spend quantities they did not contribute.
    if (TOKEN_FIELDS.some(key => fact[key] > (remainder[key] ?? 0))) continue;
    for (const key of TOKEN_FIELDS) remainder[key] = (remainder[key] ?? 0) - fact[key];
    const priced = priceRequest(fact, base, rules);
    cost += priced.cost; unpricedTokens += priced.unpricedTokens; requests++;
    items.push(...priced.items);
    priced.ruleReferences.forEach(ref => references.add(ref)); tiers.add(fact.serviceTier ?? 'unknown');
  }
  const legacyTokens = computeTokens(remainder);
  if (legacyTokens) {
    const legacy = explainRowCost(remainder);
    cost += legacy.costUsd ?? 0; unpricedTokens += legacy.unpricedTokens;
    items.push(...legacy.items ?? []);
  }
  return { cost: roundCostUsd(cost), unpricedTokens, items, evidence: { requests, ruleReferences: [...references], legacyTokens, serviceTiers: [...tiers] } };
}

/**
 * Sum the five token fields instead of trusting `row.total_tokens`:
 * zcode buckets historically stored the provider total (input + output,
 * excluding reasoning), which made panel aggregates undercount reasoning
 * versus the server's ingest recompute (issue #181). Summing here also
 * self-heals existing zcode buckets that will never see a fresh snapshot.
 *
 * Each field is null-coalesced: queue JSONL loads without normalization
 * (queue/index.ts casts parsed lines directly), so rows written before
 * `reasoning_output_tokens` joined the schema would otherwise NaN the sum.
 */
export function computeTokens(row: QueueBucket): number {
  return (
    (row.input_tokens ?? 0) +
    (row.output_tokens ?? 0) +
    (row.cached_input_tokens ?? 0) +
    (row.cache_creation_input_tokens ?? 0) +
    (row.reasoning_output_tokens ?? 0)
  );
}

export { ZERO_PRICING };
