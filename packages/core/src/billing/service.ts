import { createHash } from 'node:crypto';
import { emptyPlatformCosts, readOpenAICosts, validCostProjects, type BillingFetch, type PlatformCosts } from './openai-costs.js';

export function createBillingService(options: { settings?(): { apiKey?: string; projects?: readonly string[] }; fetch?: BillingFetch; now?(): number } = {}) {
  const cache = new Map<string, PlatformCosts>(), flights = new Map<string, Promise<PlatformCosts>>();
  let identity = '';
  const select = (days: number) => {
    if (![7, 30, 90].includes(days)) throw new Error('INVALID_BILLING_RANGE');
    const settings = options.settings?.() ?? { apiKey: process.env.OPENAI_ADMIN_KEY, projects: process.env.QUOTERN_OPENAI_COST_PROJECT_IDS?.split(',').map(p => p.trim()) ?? [] };
    const hash = createHash('sha256').update(JSON.stringify(settings)).digest('hex');
    if (hash !== identity) { identity = hash; cache.clear(); }
    const endTime = Math.floor(options.now?.() ?? Date.now() / 1000), startTime = Math.floor(endTime / 86400) * 86400 - (days - 1) * 86400;
    return { settings, hash, startTime, endTime, key: `${hash}:${days}:${startTime}` };
  };
  const get = (days: number) => {
    const context = select(days), projects = context.settings.projects ?? [], stored = cache.get(context.key);
    const platform = stored ?? emptyPlatformCosts(context.startTime, context.endTime, validCostProjects(projects) ? projects : []);
    if (!stored) {
      if (!context.settings.apiKey?.trim()) { platform.status = 'not-configured'; platform.code = 'ADMIN_KEY_REQUIRED'; }
      else if (!validCostProjects(projects)) { platform.status = 'unavailable'; platform.code = 'INVALID_CONFIGURATION'; }
    }
    return { platform, stale: platform.fetchedAt !== null && context.endTime - platform.fetchedAt > 1800 };
  };
  return { get, async refresh(days: number) {
    const context = select(days);
    const existing = flights.get(context.key); if (existing) { await existing; return get(days); }
    const task = readOpenAICosts({ ...context.settings, startTime: context.startTime, endTime: context.endTime, fetch: options.fetch })
      .then(result => { if (identity === context.hash) { cache.set(context.key, result); while (cache.size > 6) cache.delete(cache.keys().next().value!); } return result; })
      .finally(() => flights.delete(context.key));
    flights.set(context.key, task); await task; return get(days);
  } };
}
export type BillingService = ReturnType<typeof createBillingService>;
