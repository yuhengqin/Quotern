/**
 * CLI / Desktop 默认使用内置价格；有效的磁盘覆盖缓存仍优先。
 *
 * 用户显式配置远端地址时，启动时拉一次（不轮询）。成功拉到的覆盖层会写到
 * `~/.quotern/pricing-overlay.json`，下次启动先同步读盘再带超时拉网上。
 * 接口不可用时保留磁盘上一版；没有上一版时使用内置底表。
 */
/** Retired automatic source; migrate only this exact config value. */
export const LEGACY_BAKED_PRICING_URL =
  'https://raw.githubusercontent.com/yuhengqin/Quotern/main/packages/core/src/pricing/pricing.json';
export const BAKED_PRICING_URL = '';
export const BAKED_PRICING_TTL_MS = 60_000;
