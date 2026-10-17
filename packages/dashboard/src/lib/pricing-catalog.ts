import type { PricingCatalogRow } from './pricing-data.ts';
import { getModelProvider, type ModelProvider } from './model-provider.ts';
import { isModelReleaseDate, resolvePricingModelId, type PricingData } from 'quotern-core/pricing-matcher';
import type { ModelBreakdownRow } from './api.ts';
import { formatConvertedPricingRate, type PricingCurrency } from './pricing-currency.ts';
import { pricingMessages } from '../i18n/pricing-messages.ts';

export const PRICING_PAGE_SIZE = 100;

/**
 * Providers that expose upstream models through a gateway or reseller.
 * Keep these out of the public catalog view so the table focuses on the
 * model vendor's direct prices. The core pricing matcher still retains all
 * entries because usage can legitimately come from these providers.
 */
export const PRICING_GATEWAY_PREFIXES = new Set([
  '302ai',
  'abacus',
  'aihubmix',
  'cloudflare-ai-gateway',
  'crossmodel',
  'edenai',
  'empiriolabs',
  'fastrouter',
  'helicone',
  'impossibl',
  'jiekou',
  'kilo',
  'llmgateway',
  'llmtr',
  'merge-gateway',
  'nano-gpt',
  'neon',
  'ofox',
  'openrouter',
  'opencode',
  'opencode-go',
  'orcarouter',
  'poe',
  'pioneer',
  'requesty',
  'routing-run',
  'siliconflow',
  'siliconflow-cn',
  'submodel',
  'synthetic',
  'venice',
  'vercel',
  'xpersona',
  'zenmux',
]);

export function isGatewayPricingModel(model: string): boolean {
  const prefix = model.trim().split('/', 1)[0]?.toLocaleLowerCase();
  return prefix ? PRICING_GATEWAY_PREFIXES.has(prefix) : false;
}

export function filterDirectPricingCatalog(rows: PricingCatalogRow[]): PricingCatalogRow[] {
  return rows.filter((row) => !isGatewayPricingModel(row.model));
}

export type PricingSortKey = 'latest' | 'usage' | 'model' | 'inputOutput' | 'cache' | 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'contextWindow' | 'releaseDate';

export type PricingSortDirection = 'ascending' | 'descending';

export interface PricingSortDescriptor {
  column: PricingSortKey;
  direction: PricingSortDirection;
}

export const DEFAULT_PRICING_SORT: PricingSortDescriptor = {
  column: 'usage',
  direction: 'descending',
};

export function addPricingUsage(
  rows: PricingCatalogRow[],
  usage: ModelBreakdownRow[],
  matching?: Pick<PricingData, 'alias' | 'sourceAlias'>,
): PricingCatalogRow[] {
  // Adding plan routes must not make previously unique API model IDs ambiguous.
  // A subscription's usage needs its explicit channel ID; never copy API usage
  // into every plan that happens to serve the same canonical model.
  const data: PricingData = { ...matching, exact: Object.fromEntries(rows.filter(row => row.billingMode !== 'subscription').map(row => [row.model, {}])) };
  const subscriptionIds = new Map(rows.filter(row => row.billingMode === 'subscription').map(row => [row.model.toLowerCase(), row.model]));
  const totals = new Map<string, number>();
  for (const row of usage) {
    if (!Number.isFinite(row.tokens) || row.tokens <= 0) continue;
    const id = subscriptionIds.get(row.model.trim().toLowerCase()) ?? resolvePricingModelId(row.model, data, row.source);
    if (id) totals.set(id, (totals.get(id) ?? 0) + row.tokens);
  }
  return rows.map(row => ({ ...row, usageTokens: totals.get(row.model) ?? 0 }));
}

function compareLatest(a: PricingCatalogRow, b: PricingCatalogRow): number {
  const aDate = isModelReleaseDate(a.releaseDate) ? a.releaseDate : '';
  const bDate = isModelReleaseDate(b.releaseDate) ? b.releaseDate : '';
  return Number(Boolean(b.featured)) - Number(Boolean(a.featured))
    || bDate.localeCompare(aDate)
    || a.model.localeCompare(b.model);
}

/** The price source may include a provider namespace such as `azure/gpt-5.4`. */
export function getPricingModelName(model: string, displayName?: string): string {
  if (displayName?.trim()) return displayName.trim();
  const segments = model.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? model;
}

export function filterAndSortPricingCatalog<T extends PricingCatalogRow>(
  rows: T[],
  query: string,
  sort: PricingSortDescriptor,
): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = normalizedQuery
    ? rows.filter((row) => [row.model, row.displayName, row.canonicalModelId]
      .some(value => value?.toLocaleLowerCase().includes(normalizedQuery)))
    : rows;

  return [...filtered].sort((a, b) => {
    if (sort.column === 'latest') return compareLatest(a, b);
    if (sort.column === 'usage') return (b.usageTokens ?? 0) - (a.usageTokens ?? 0) || compareLatest(a, b);

    if (sort.column === 'model') {
      const comparison = getPricingModelName(a.model, a.displayName).localeCompare(getPricingModelName(b.model, b.displayName));
      if (comparison !== 0) return sort.direction === 'descending' ? -comparison : comparison;
    } else if (sort.column === 'releaseDate') {
      const left = isModelReleaseDate(a.releaseDate) ? a.releaseDate : null;
      const right = isModelReleaseDate(b.releaseDate) ? b.releaseDate : null;
      if (left == null && right != null) return 1;
      if (right == null && left != null) return -1;
      if (left && right && left !== right) {
        const comparison = left.localeCompare(right);
        return sort.direction === 'descending' ? -comparison : comparison;
      }
    } else {
      const comparisons: Array<[number | null, number | null]> = sort.column === 'inputOutput'
        ? [[a.input, b.input], [a.output, b.output]]
        : sort.column === 'cache'
          ? [[a.cacheRead, b.cacheRead], [a.cacheWrite, b.cacheWrite]]
          : [[a[sort.column] ?? null, b[sort.column] ?? null]];
      for (const [left, right] of comparisons) {
        const priceColumn = ['inputOutput', 'cache', 'input', 'output', 'cacheRead', 'cacheWrite'].includes(sort.column);
        const aValue = priceColumn && a.billingMode === 'subscription' ? null : left;
        const bValue = priceColumn && b.billingMode === 'subscription' ? null : right;
        if (aValue == null && bValue != null) return 1;
        if (bValue == null && aValue != null) return -1;
        if (aValue == null || bValue == null || aValue === bValue) continue;
        const comparison = aValue - bValue;
        return sort.direction === 'descending' ? -comparison : comparison;
      }
    }
    return a.model.localeCompare(b.model);
  });
}

const PRICING_PROVIDERS: Record<string, Omit<ModelProvider, 'key'>> = {
  anthropic: { label: 'Anthropic（Claude）', icon: 'claude' },
  openai: { label: 'OpenAI', icon: 'openai' },
  google: { label: 'Google', icon: 'google' },
  alibaba: { label: 'Alibaba（百炼）', icon: 'alibaba' },
  moonshot: { label: 'Moonshot（Kimi）', icon: 'moonshot' },
  minimax: { label: 'MiniMax', icon: 'minimax' },
  deepseek: { label: 'DeepSeek', icon: 'deepseek' },
  mistral: { label: 'Mistral', icon: 'mistral' },
  xai: { label: 'xAI', icon: 'grok' },
  zhipu: { label: 'Zhipu AI（智谱）', icon: 'zhipu' },
  bytedance: { label: 'ByteDance（Doubao）', icon: 'doubao' },
  xiaomi: { label: 'Xiaomi（MiMo）', icon: 'unknown' },
  meta: { label: 'Meta', icon: 'meta' },
  tencent: { label: 'Tencent', icon: 'hunyuan' },
  stepfun: { label: 'StepFun', icon: 'stepfun' },
  cursor: { label: 'Cursor', icon: 'unknown' },
  inclusionai: { label: 'Ant Group（Ling）', icon: 'unknown' },
  meituan: { label: 'Meituan（LongCat）', icon: 'unknown' },
  sapiens: { label: 'Sapiens', icon: 'unknown' },
};

const PRICING_PROVIDER_ALIASES: Record<string, string> = {
  'alibaba-cn': 'alibaba', 'minimax-cn': 'minimax',
  'kimi-code-plan-cn': 'moonshot', 'kimi-code-plan-global': 'moonshot',
  'zai-coding-plan': 'zhipu', 'zhipuai-coding-plan': 'zhipu',
  'minimax-coding-plan': 'minimax', 'minimax-cn-coding-plan': 'minimax',
  'alibaba-coding-plan': 'alibaba', 'alibaba-coding-plan-cn': 'alibaba',
  'alibaba-token-plan': 'alibaba', 'alibaba-token-plan-cn': 'alibaba',
  'volcengine-coding-plan': 'bytedance', 'tencent-coding-plan': 'tencent', 'tencent-token-plan': 'tencent',
  'stepfun-ai-step-plan': 'stepfun', 'stepfun-step-plan': 'stepfun',
  'xiaomi-token-plan-cn': 'xiaomi', 'xiaomi-token-plan-sgp': 'xiaomi', 'xiaomi-token-plan-ams': 'xiaomi',
  moonshotai: 'moonshot', 'moonshotai-cn': 'moonshot',
  zai: 'zhipu', zhipuai: 'zhipu', volcengine: 'bytedance',
  claude: 'anthropic', codex: 'openai', kimi: 'moonshot', qwen: 'alibaba',
  grok: 'xai', hunyuan: 'tencent', doubao: 'bytedance',
};

/** Price catalogs identify the supplier by namespace, rather than the Agent or family. */
export function getPricingProvider(model: string): ModelProvider {
  const namespace = model.includes('/') ? model.split('/')[0].toLowerCase() : getModelProvider(model).key;
  const key = PRICING_PROVIDER_ALIASES[namespace] ?? namespace;
  const provider = PRICING_PROVIDERS[key];
  if (provider) return { key, ...provider };
  return { key, label: namespace === 'unknown' ? '其他提供商' : namespace, icon: 'unknown' };
}

export function getPricingChannel(model: string): string | null {
  const namespace = model.split('/')[0].toLowerCase();
  const subscriptionRegions: Record<string, string> = {
    'kimi-code-plan-cn': '中国', 'kimi-code-plan-global': '国际',
    'zai-coding-plan': '国际', 'zhipuai-coding-plan': '中国',
    'minimax-coding-plan': '国际', 'minimax-cn-coding-plan': '中国',
    'alibaba-coding-plan': '国际', 'alibaba-coding-plan-cn': '中国',
    'alibaba-token-plan': '国际', 'alibaba-token-plan-cn': '中国',
    'volcengine-coding-plan': '中国', 'tencent-coding-plan': '中国', 'tencent-token-plan': '中国',
    'stepfun-ai-step-plan': '国际', 'stepfun-step-plan': '中国',
    'xiaomi-token-plan-cn': '中国', 'xiaomi-token-plan-sgp': '新加坡', 'xiaomi-token-plan-ams': '欧洲',
  };
  if (subscriptionRegions[namespace]) return subscriptionRegions[namespace];
  if (namespace.endsWith('-cn') || namespace === 'zhipuai') return '中国';
  if (['alibaba', 'minimax', 'moonshotai', 'zai'].includes(namespace)) return '国际';
  return null;
}

export function formatPricingRate(value: number | null, currency: PricingCurrency = 'USD', exchangeRate: number | null = null, locale = 'en-US'): string {
  return formatConvertedPricingRate(value, currency, exchangeRate, locale);
}

export function formatCatalogPricingRate(row: PricingCatalogRow, key: 'input' | 'output' | 'cacheRead' | 'cacheWrite', currency: PricingCurrency = 'USD', exchangeRate: number | null = null, locale: keyof typeof pricingMessages = 'zh-CN'): string {
  if (row.billingMode === 'subscription') return key === 'input' ? pricingMessages[locale]['pricing.list.subscriptionOnly'] : '—';
  return formatPricingRate(row[key], currency, exchangeRate, locale);
}

export function getPageCount(totalItems: number, pageSize = PRICING_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

export function getPricingPage<T>(rows: T[], page: number, pageSize = PRICING_PAGE_SIZE): T[] {
  const safePage = Math.min(Math.max(page, 1), getPageCount(rows.length, pageSize));
  const start = (safePage - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

export function getPaginationItems(
  totalPages: number,
  currentPage: number,
): Array<number | 'ellipsis'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items: Array<number | 'ellipsis'> = [1];
  if (currentPage > 3) items.push('ellipsis');

  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);
  for (let page = start; page <= end; page += 1) items.push(page);

  if (currentPage < totalPages - 2) items.push('ellipsis');
  items.push(totalPages);
  return items;
}
