/**
 * CLI / Desktop 先使用内置价格和有效磁盘缓存，再从 models.dev 更新一次。
 *
 * 用户显式配置的 Quotern 格式覆盖表优先于默认来源。成功拉到的覆盖层会写到
 * `~/.quotern/pricing-overlay.json`，下次启动先同步读盘再带超时拉网上。
 * 接口不可用时保留磁盘上一版；没有上一版时使用内置底表。
 */
/** Retired automatic source; migrate only this exact config value. */
export const LEGACY_BAKED_PRICING_URL =
  'https://raw.githubusercontent.com/yuhengqin/Quotern/main/packages/core/src/pricing/pricing.json';
export { MODELS_DEV_URL as BAKED_PRICING_URL } from './models-dev.mjs';
export const BAKED_PRICING_TTL_MS = 60_000;
