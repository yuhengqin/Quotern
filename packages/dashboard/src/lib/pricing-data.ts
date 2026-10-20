import type { PricingData } from 'quotern-core';
import type { PricingModelMetadata } from 'quotern-core/pricing-matcher';
import { isModelReleaseDate } from 'quotern-core/pricing-matcher';
import bundledPricing from 'quotern-core/pricing-data' with { type: 'json' };

export interface PricingCatalogRow {
  model: string;
  displayName?: string;
  canonicalModelId?: string;
  billingMode?: 'api' | 'subscription';
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  releaseDate?: string;
  contextWindow?: number;
  featured?: boolean;
  usageTokens?: number;
}

export interface PricingCatalogResponse {
  units: string;
  generatedAt: string | null;
  updatedAt: string | null;
  source: 'published' | 'bundled';
  models: PricingCatalogRow[];
  matching?: Pick<PricingData, 'alias' | 'sourceAlias'>;
}

export const PRICING_CATALOG_URL = import.meta.env?.VITE_PRICING_URL?.trim() || '';

/** Public prices need no dashboard credentials; the bundle also works offline. */
export async function fetchPricingCatalog(url = PRICING_CATALOG_URL): Promise<PricingCatalogResponse> {
  if (!url.trim()) return pricingDataToCatalog(bundledPricing as PricingData, 'bundled', null);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3_000), credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const published = parsePricingData(await res.json());
    const bundled = bundledPricing as PricingData;
    const publishedAt = published._meta?.generated_at;
    const bundledAt = bundled._meta?.generated_at;
    if (typeof publishedAt === 'string' && typeof bundledAt === 'string'
      && Number.isFinite(Date.parse(publishedAt)) && Number.isFinite(Date.parse(bundledAt))
      && Date.parse(publishedAt) < Date.parse(bundledAt)) {
      return pricingDataToCatalog(bundled, 'bundled', null);
    }
    return pricingDataToCatalog(published, 'published', res.headers.get('last-modified'));
  } catch {
    return pricingDataToCatalog(bundledPricing as PricingData, 'bundled', null);
  }
}

function parsePricingData(raw: unknown): PricingData {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('模型价格数据格式错误：响应必须是对象');
  }
  const exact = (raw as { exact?: unknown }).exact;
  if (exact === null || typeof exact !== 'object' || Array.isArray(exact) || Object.keys(exact).length === 0) {
    throw new Error('模型价格数据格式错误：exact 必须包含价格记录');
  }
  for (const [model, rates] of Object.entries(exact)) {
    if (rates === null || typeof rates !== 'object' || Array.isArray(rates)) {
      throw new Error(`模型价格数据格式错误：exact.${model} 必须是对象`);
    }
    for (const key of ['input', 'output', 'cache_read', 'cache_write'] as const) {
      const rate = (rates as Record<string, unknown>)[key];
      if (rate !== undefined && (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0)) {
        throw new Error(`模型价格数据格式错误：exact.${model}.${key} 必须是非负数字`);
      }
    }
  }
  const subscriptions = (raw as PricingData).subscription_models;
  if (subscriptions !== undefined) {
    if (subscriptions === null || typeof subscriptions !== 'object' || Array.isArray(subscriptions)) {
      throw new Error('模型订阅数据格式错误：subscription_models 必须是对象');
    }
    for (const [model, metadata] of Object.entries(subscriptions)) {
      if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new Error(`模型订阅数据格式错误：subscription_models.${model} 必须是对象`);
      }
    }
  }
  return raw as PricingData;
}

export function pricingDataToCatalog(
  data: PricingData,
  source: PricingCatalogResponse['source'],
  updatedAt: string | null,
): PricingCatalogResponse {
  const generatedAt = data._meta?.generated_at;
  const projectMetadata = (metadata?: PricingModelMetadata) => {
    const contextWindow = metadata?.context_window;
    return {
      ...(typeof metadata?.display_name === 'string' && metadata.display_name.trim()
        ? { displayName: metadata.display_name.trim() } : {}),
      ...(typeof metadata?.canonical_model_id === 'string' && metadata.canonical_model_id.trim()
        ? { canonicalModelId: metadata.canonical_model_id.trim() } : {}),
      ...(isModelReleaseDate(metadata?.release_date) ? { releaseDate: metadata!.release_date } : {}),
      ...(typeof contextWindow === 'number' && Number.isSafeInteger(contextWindow) && contextWindow > 0
        ? { contextWindow } : {}),
      ...(typeof metadata?.featured === 'boolean' ? { featured: metadata.featured } : {}),
    };
  };
  const subscriptions: PricingCatalogRow[] = Object.entries(data.subscription_models ?? {}).map(([model, metadata]) => ({
    model, ...projectMetadata(metadata), billingMode: 'subscription',
    input: null, output: null, cacheRead: null, cacheWrite: null,
  }));
  // Historical manual Kimi Code estimates stay available to cost lookup, but
  // their current public catalog entries are the explicit subscription routes.
  const replacedKimiIds = new Set(subscriptions.filter(row => row.model.startsWith('kimi-code-plan-'))
    .map(row => `moonshotai/${row.model.slice(row.model.indexOf('/') + 1)}`));
  return {
    units: 'usd_per_million_tokens',
    generatedAt: typeof generatedAt === 'string' && Number.isFinite(Date.parse(generatedAt)) ? generatedAt : null,
    updatedAt,
    source,
    models: [...Object.entries(data.exact).filter(([model]) => !replacedKimiIds.has(model) && !(model in (data.subscription_models ?? {}))).map(([model, rates]) => {
      const metadata = data.model_metadata?.[model];
      return {
        model,
        ...projectMetadata(metadata),
        input: rates.input ?? null,
        output: rates.output ?? null,
        cacheRead: rates.cache_read ?? null,
        cacheWrite: rates.cache_write ?? null,
      };
    }), ...subscriptions].sort((a, b) => a.model.localeCompare(b.model)),
    ...((data.alias || data.sourceAlias) ? { matching: {
      ...(data.alias ? { alias: data.alias } : {}),
      ...(data.sourceAlias ? { sourceAlias: data.sourceAlias } : {}),
    } } : {}),
  };
}
