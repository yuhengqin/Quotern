export interface ModelPricingRates {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}

export interface PricingData {
  _meta?: Record<string, unknown>;
  exact: Record<string, ModelPricingRates>;
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

function buildDotRestoredModel(model: string): string {
  const lower = model.toLowerCase();
  const restored = lower.replace(/(\d+)-(\d+)/g, '$1.$2');
  return restored === lower ? '' : restored;
}

function lookupExactCaseInsensitive(
  table: Record<string, ModelPricingRates>,
  model: string,
): ModelPricingRates | null {
  if (!table || !model) return null;
  if (table[model]) return table[model];
  const lower = model.toLowerCase();
  for (const key of Object.keys(table)) {
    if (key.toLowerCase() === lower) return table[key]!;
  }
  return null;
}

function lookupContainedExactCaseInsensitive(
  table: Record<string, ModelPricingRates>,
  model: string,
): ModelPricingRates | null {
  if (!table || !model) return null;
  const lower = model.toLowerCase();
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key.toLowerCase())) return table[key]!;
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
    return value ? { hit: true, source: 'alias', value } : null;
  };

  // 1. exact
  if (exact[lookupModel]) {
    return { hit: true, source: 'exact', value: exact[lookupModel]! };
  }
  const dotExact = lookupExactCaseInsensitive(exact, dotForm);
  if (dotExact) return { hit: true, source: 'exact-dot', value: dotExact };
  const containedExact = lookupContainedExactCaseInsensitive(exact, dotForm);
  if (containedExact) return { hit: true, source: 'exact-contained', value: containedExact };

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
    return { hit: true, source: 'suffix-strip', value: exact[stripped]! };
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
  if (best) return { hit: true, source: 'prefix-strip', value: exact[best]! };

  // 6. fuzzy
  if (Array.isArray(data.fuzzy)) {
    for (const { match, ref } of data.fuzzy) {
      if (!match || !ref) continue;
      const rate = resolveExactRate(ref, exact, extra);
      if (!rate) continue;
      const needle = match.toLowerCase();
      if (lower.includes(needle) || (dotForm && dotForm.includes(needle))) {
        return { hit: true, source: 'fuzzy', value: rate };
      }
    }
  }

  // 7. reverse substring
  for (const key of getSortedKeys(exact)) {
    const keyLower = key.toLowerCase();
    if (lower.includes(keyLower) || (dotForm && dotForm.includes(keyLower))) {
      return { hit: true, source: 'fuzzy-litellm', value: exact[key]! };
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
    if (remote.hit) return remote;
  }

  const local = lookupPricing(model, builtin, source);
  if (local.hit) return local;

  const fallback = overlay?.default ?? builtin.default;
  if (fallback) {
    return { hit: true, source: 'default', value: fallback };
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
