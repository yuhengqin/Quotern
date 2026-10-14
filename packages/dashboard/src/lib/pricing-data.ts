import type { PricingData } from 'quotern-core';
import { isModelReleaseDate } from 'quotern-core/pricing-matcher';
import bundledPricing from 'quotern-core/pricing-data' with { type: 'json' };

export interface PricingCatalogRow {
  model: string;
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

export const PRICING_CATALOG_URL =
  'https://raw.githubusercontent.com/yuhengqin/Quotern/main/packages/core/src/pricing/pricing.json';

/** Public prices need no dashboard credentials; the bundle also works offline. */
export async function fetchPricingCatalog(): Promise<PricingCatalogResponse> {
  try {
    const res = await fetch(PRICING_CATALOG_URL, { signal: AbortSignal.timeout(3_000) });
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
  return raw as PricingData;
}

function pricingDataToCatalog(
  data: PricingData,
  source: PricingCatalogResponse['source'],
  updatedAt: string | null,
): PricingCatalogResponse {
  const generatedAt = data._meta?.generated_at;
  return {
    units: 'usd_per_million_tokens',
    generatedAt: typeof generatedAt === 'string' && Number.isFinite(Date.parse(generatedAt)) ? generatedAt : null,
    updatedAt,
    source,
    models: Object.entries(data.exact).map(([model, rates]) => {
      const metadata = data.model_metadata?.[model];
      const contextWindow = metadata?.context_window;
      return {
        model,
        input: rates.input ?? null,
        output: rates.output ?? null,
        cacheRead: rates.cache_read ?? null,
        cacheWrite: rates.cache_write ?? null,
        ...(isModelReleaseDate(metadata?.release_date)
          ? { releaseDate: metadata!.release_date } : {}),
        ...(typeof contextWindow === 'number' && Number.isSafeInteger(contextWindow) && contextWindow > 0
          ? { contextWindow } : {}),
        ...(typeof metadata?.featured === 'boolean'
          ? { featured: metadata.featured } : {}),
      };
    }).sort((a, b) => a.model.localeCompare(b.model)),
    ...((data.alias || data.sourceAlias) ? { matching: {
      ...(data.alias ? { alias: data.alias } : {}),
      ...(data.sourceAlias ? { sourceAlias: data.sourceAlias } : {}),
    } } : {}),
  };
}
