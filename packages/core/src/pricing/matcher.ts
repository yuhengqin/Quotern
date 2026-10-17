export interface ModelPricingRates {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}

export interface PricingModelMetadata {
  display_name?: string;
  canonical_model_id?: string;
  release_date?: string;
  /** models.dev for synchronized dates; an announcement URL for manual corrections. */
  release_date_source?: string;
  context_window?: number;
  context_window_source?: string;
  featured?: boolean;
}

export interface PricingData {
  _meta?: Record<string, unknown>;
  exact: Record<string, ModelPricingRates>;
  model_metadata?: Record<string, PricingModelMetadata>;
  /** Subscription catalog only: never used as per-token rates by the matcher. */
  subscription_models?: Record<string, PricingModelMetadata>;
  alias?: Record<string, string>;
  fuzzy?: Array<{ match: string; ref: string }>;
  sourceAlias?: Record<string, Record<string, string>>;
  /** Used when exact/alias/fuzzy all miss (stacked lookup applies remote then builtin). */
  default?: ModelPricingRates;
}

export interface LookupPricingOptions {
  /**
   * Extra exact table consulted when resolving alias / fuzzy / sourceAlias refs
   * (e.g. builtin exact while matching against a remote overlay).
   */
  resolveExactExtra?: Record<string, ModelPricingRates>;
}

export interface LookupResult {
  hit: boolean;
  source: string;
  value: ModelPricingRates | null;
  matchedModel?: string;
  table?: 'overlay' | 'builtin';
}

const SUFFIX_STRIP_PATTERNS = [
  /-xhigh-fast$/,
  /-high-fast$/,
  /-medium-fast$/,
  /-low-fast$/,
  /-xhigh$/,
  /-high$/,
  /-medium$/,
  /-low$/,
  /-fast$/,
];

function stripReasoningSuffix(model: string): string {
  for (const re of SUFFIX_STRIP_PATTERNS) {
    if (re.test(model)) return model.replace(re, '');
  }
  return model;
}

function normalizeClaudeModel(model: string): string {
  const base = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model;
  let m = base
    .trim()
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (/^claude-(sonnet|opus|haiku)-\d+\.\d+/.test(m)) {
    return m.replace(/^(claude-(?:sonnet|opus|haiku)-\d+)\.(\d+)/, '$1-$2');
  }
  if (/^(sonnet|opus|haiku)-\d+[.-]\d+/.test(m)) {
    return m
      .replace(/^(sonnet|opus|haiku)-/, 'claude-$1-')
      .replace(/^(claude-(?:sonnet|opus|haiku)-\d+)\.(\d+)/, '$1-$2');
  }
  if (/^claude-(?:[4-9]|\d{2,})[.-]\d+-(?:sonnet|opus|haiku)/.test(m)) {
    return m.replace(/^claude-(\d+)[.-](\d+)-(sonnet|opus|haiku)/, 'claude-$3-$1-$2');
  }
  return m;
}

const SOURCE_MODEL_NORMALIZERS: Record<string, (model: string) => string> = {
  claude: normalizeClaudeModel,
};

export function isModelReleaseDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(value)) return false;
  const date = new Date(`${value.length === 7 ? `${value}-01` : value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, value.length) === value;
}

/** Resolve identity for usage ranking, without cost-estimation fuzzy/default guesses. */
export function resolvePricingModelId(model: string, data: PricingData, source?: string | null): string | null {
  if (typeof model !== 'string' || !model.trim()) return null;
  const keys = Object.keys(data.exact);
  const exactId = (name: string): string | null => {
    const lower = name.toLowerCase();
    return keys.find(key => key.toLowerCase() === lower) ?? null;
  };
  const raw = model.trim();
  const direct = exactId(raw);
  if (direct) return direct;
  // A gateway may retain the complete canonical provider/model path.
  const hosted = keys.filter(key => key.includes('/') && raw.toLowerCase().endsWith(`/${key.toLowerCase()}`));
  if (hosted.length === 1) return hosted[0]!;
  const normalize = source ? SOURCE_MODEL_NORMALIZERS[source.toLowerCase()] : undefined;
  const normalized = normalize ? normalize(raw) : raw;
  const aliasFor = (table: Record<string, string> | undefined): string | null => {
    if (!table || typeof table !== 'object') return null;
    const entry = Object.entries(table).find(([key]) => key.toLowerCase() === normalized.toLowerCase());
    return typeof entry?.[1] === 'string' ? exactId(entry[1]) : null;
  };
  const scoped = source && data.sourceAlias
    ? Object.entries(data.sourceAlias).find(([key]) => key.toLowerCase() === source.toLowerCase())?.[1]
    : undefined;
  const alias = aliasFor(scoped) ?? aliasFor(data.alias);
  if (alias) return alias;

  // Effort modifiers do not change model identity; fast/flex/batch variants do.
  const effortStripped = normalized.replace(/-(?:xhigh|high|medium|low)(?=-fast$|$)/i, '');
  const candidates = [...new Set([normalized, buildDotRestoredModel(normalized), effortStripped, buildDotRestoredModel(effortStripped)].filter(Boolean))];
  for (const candidate of candidates) {
    const exact = exactId(candidate);
    if (exact) return exact;
    if (candidate.includes('/')) continue;
    const matches = keys.filter(key => key.toLowerCase().endsWith(`/${candidate.toLowerCase()}`));
    if (matches.length === 1) return matches[0]!;
  }
  return null;
}

function buildDotRestoredModel(model: string): string {
  const lower = model.toLowerCase();
  const restored = lower.replace(/(\d+)-(\d+)/g, '$1.$2');
  return restored === lower ? '' : restored;
}

function lookupExactCaseInsensitive(
  table: Record<string, ModelPricingRates>,
  model: string,
): { key: string; value: ModelPricingRates } | null {
  if (!table || !model) return null;
  if (table[model]) return { key: model, value: table[model]! };
  const lower = model.toLowerCase();
  for (const key of Object.keys(table)) {
    if (key.toLowerCase() === lower) return { key, value: table[key]! };
  }
  return null;
}

function lookupContainedExactCaseInsensitive(
  table: Record<string, ModelPricingRates>,
  model: string,
): { key: string; value: ModelPricingRates } | null {
  if (!table || !model) return null;
  const lower = model.toLowerCase();
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key.toLowerCase())) return { key, value: table[key]! };
  }
  return null;
}

const sortedKeysCache = new WeakMap<Record<string, ModelPricingRates>, string[]>();

function getSortedKeys(table: Record<string, ModelPricingRates>): string[] {
  let cached = sortedKeysCache.get(table);
  if (!cached) {
    cached = Object.keys(table).sort((a, b) => b.length - a.length);
    sortedKeysCache.set(table, cached);
  }
  return cached;
}

function resolveExactRate(
  ref: string,
  exact: Record<string, ModelPricingRates>,
  extra?: Record<string, ModelPricingRates>,
): ModelPricingRates | null {
  if (exact[ref]) return exact[ref]!;
  if (extra?.[ref]) return extra[ref]!;
  return null;
}

export function lookupPricing(
  model: string,
  data: PricingData,
  source?: string | null,
  opts?: LookupPricingOptions,
): LookupResult {
  if (!model || typeof model !== 'string') {
    return { hit: false, source: 'empty', value: null };
  }

  const exact = data.exact || {};
  const extra = opts?.resolveExactExtra;
  const normalize = source ? SOURCE_MODEL_NORMALIZERS[source.toLowerCase()] : undefined;
  const lookupModel = normalize ? normalize(model) : model;
  const lower = lookupModel.toLowerCase();
  const dotForm = buildDotRestoredModel(lookupModel);

  const resolveRef = (ref: string): LookupResult | null => {
    const value = resolveExactRate(ref, exact, extra);
    return value ? { hit: true, source: 'alias', value, matchedModel: ref } : null;
  };

  // 1. exact
  if (exact[lookupModel]) {
    return { hit: true, source: 'exact', value: exact[lookupModel]!, matchedModel: lookupModel };
  }
  const dotExact = lookupExactCaseInsensitive(exact, dotForm);
  if (dotExact) return { hit: true, source: 'exact-dot', value: dotExact.value, matchedModel: dotExact.key };
  const containedExact = lookupContainedExactCaseInsensitive(exact, dotForm);
  if (containedExact) {
    return { hit: true, source: 'exact-contained', value: containedExact.value, matchedModel: containedExact.key };
  }

  // 2. source-scoped alias
  if (source && data.sourceAlias?.[source.toLowerCase()]?.[lookupModel]) {
    const ref = data.sourceAlias[source.toLowerCase()]![lookupModel]!;
    const aliased = resolveRef(ref);
    if (aliased) return { ...aliased, source: `sourceAlias:${source}` };
  }

  // 3. global alias
  if (data.alias?.[lookupModel]) {
    const aliased = resolveRef(data.alias[lookupModel]!);
    if (aliased) return { ...aliased, source: 'alias' };
  }

  // 4. suffix strip (reasoning-effort suffixes: -high / -low / -fast …)
  const stripped = stripReasoningSuffix(lookupModel);
  if (stripped !== lookupModel && exact[stripped]) {
    return { hit: true, source: 'suffix-strip', value: exact[stripped]!, matchedModel: stripped };
  }

  // 5. provider-prefix strip — exact table is the source of truth, so an
  // exact-derived hit (e.g. `anthropic/claude-fable-5` for `claude-fable-5`)
  // must win over a fuzzy guess that could shadow it. Prefer canonical
  // two-segment keys (`provider/model`) over nested hosts, then
  // lexicographically smallest.
  const suffix = `/${lower}`;
  let best: string | null = null;
  let bestSegments = Infinity;
  for (const key of Object.keys(exact)) {
    if (key.length > suffix.length && key.toLowerCase().endsWith(suffix)) {
      const segments = key.split('/').length;
      if (segments < bestSegments || (segments === bestSegments && (best === null || key < best))) {
        best = key;
        bestSegments = segments;
      }
    }
  }
  if (best) return { hit: true, source: 'prefix-strip', value: exact[best]!, matchedModel: best };

  // 6. fuzzy
  if (Array.isArray(data.fuzzy)) {
    for (const { match, ref } of data.fuzzy) {
      if (!match || !ref) continue;
      const rate = resolveExactRate(ref, exact, extra);
      if (!rate) continue;
      const needle = match.toLowerCase();
      if (lower.includes(needle) || (dotForm && dotForm.includes(needle))) {
        return { hit: true, source: 'fuzzy', value: rate, matchedModel: ref };
      }
    }
  }

  // 7. reverse substring
  for (const key of getSortedKeys(exact)) {
    const keyLower = key.toLowerCase();
    if (lower.includes(keyLower) || (dotForm && dotForm.includes(keyLower))) {
      return { hit: true, source: 'fuzzy-litellm', value: exact[key]!, matchedModel: key };
    }
  }

  return { hit: false, source: 'miss', value: null };
}

/**
 * Overlay-first lookup: remote → builtin → default (remote.default then builtin.default).
 */
export function lookupPricingStacked(
  model: string,
  overlay: PricingData | null | undefined,
  builtin: PricingData,
  source?: string | null,
): LookupResult {
  if (overlay) {
    const remote = lookupPricing(model, overlay, source, {
      resolveExactExtra: builtin.exact,
    });
    if (remote.hit) {
      const usesBuiltinRate = remote.matchedModel !== undefined &&
        !Object.prototype.hasOwnProperty.call(overlay.exact, remote.matchedModel);
      return { ...remote, table: usesBuiltinRate ? 'builtin' : 'overlay' };
    }
  }

  const local = lookupPricing(model, builtin, source);
  if (local.hit) return { ...local, table: 'builtin' };

  const fallback = overlay?.default ?? builtin.default;
  if (fallback) {
    return { hit: true, source: 'default', value: fallback, table: overlay?.default ? 'overlay' : 'builtin' };
  }

  return { hit: false, source: 'miss', value: null };
}

export function hasNonZeroPricing(rates: ModelPricingRates | null): boolean {
  if (!rates) return false;
  return (
    (rates.input ?? 0) > 0 ||
    (rates.output ?? 0) > 0 ||
    (rates.cache_read ?? 0) > 0 ||
    (rates.cache_write ?? 0) > 0
  );
}
