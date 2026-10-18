import { fileURLToPath } from 'node:url';

const browserEntries = new Map([
  ['quotern-core/achievements', 'achievements/public.ts'],
  ['quotern-core/daily-model-key', 'daily-model-key.ts'],
  ['quotern-core/dashboard-trend', 'dashboard-trend.ts'],
  ['quotern-core/leaderboard', 'leaderboard.ts'],
  ['quotern-core/local-metrics', 'local-metrics.ts'],
  ['quotern-core/pricing-data', 'pricing/pricing.json'],
  ['quotern-core/pricing-matcher', 'pricing/matcher.ts'],
  ['quotern-core/project-label', 'project-label.ts'],
  ['quotern-core/timezone', 'timezone.ts'],
  ['quotern-core/quota/shared/quota-presentation', 'quota/shared/quota-presentation.ts'],
]);

/** Keep renderer HMR independent of clean Core builds. Node-only exports stay on dist. */
export function coreSourcePlugin() {
  return {
    name: 'quotern-core-source',
    apply: 'serve',
    enforce: 'pre',
    resolveId(id) {
      const entry = browserEntries.get(id);
      return entry ? fileURLToPath(new URL(`../packages/core/src/${entry}`, import.meta.url)).replaceAll('\\', '/') : null;
    },
  };
}
