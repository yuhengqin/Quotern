import type { PricingCatalogRow } from './pricing-data.ts';
import { getModelProvider, type ModelProvider } from './model-provider.ts';

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

export type PricingSortKey = 'model' | 'input' | 'output' | 'cacheRead' | 'cacheWrite';

export type PricingSortDirection = 'ascending' | 'descending';

export interface PricingSortDescriptor {
  column: PricingSortKey;
  direction: PricingSortDirection;
}

export const DEFAULT_PRICING_SORT: PricingSortDescriptor = {
  column: 'input',
  direction: 'descending',
};

/** The price source may include a provider namespace such as `azure/gpt-5.4`. */
export function getPricingModelName(model: string): string {
  const segments = model.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? model;
}

export function filterAndSortPricingCatalog(
  rows: PricingCatalogRow[],
  query: string,
  sort: PricingSortDescriptor,
): PricingCatalogRow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = normalizedQuery
    ? rows.filter((row) => row.model.toLocaleLowerCase().includes(normalizedQuery))
    : rows;

  return [...filtered].sort((a, b) => {
    let comparison: number;
    if (sort.column === 'model') {
      comparison = getPricingModelName(a.model).localeCompare(getPricingModelName(b.model));
    } else {
      const left = a[sort.column];
      const right = b[sort.column];
      // Unavailable prices stay at the end even when sorting descending.
      if (left == null && right != null) return 1;
      if (right == null && left != null) return -1;
      comparison = left == null || right == null ? 0 : left - right;
    }
    if (comparison !== 0) return sort.direction === 'descending' ? -comparison : comparison;

    // Keep all sorts predictable when the displayed values are the same.
    return a.model.localeCompare(b.model);
  });
}

const PRICING_PROVIDERS: Record<string, Omit<ModelProvider, 'key'>> = {
  anthropic: { label: 'Anthropic（Claude）', icon: 'claude' },
  openai: { label: 'OpenAI', icon: 'openai' },
  google: { label: 'Google', icon: 'google' },
  alibaba: { label: 'Alibaba（Qwen）', icon: 'alibaba' },
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
  if (namespace.endsWith('-cn') || namespace === 'zhipuai') return '中国';
  if (['alibaba', 'minimax', 'moonshotai', 'zai'].includes(namespace)) return '国际';
  return null;
}

export function formatPricingRate(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value < 0) return '—';
  return `$${new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 }).format(value)}`;
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
