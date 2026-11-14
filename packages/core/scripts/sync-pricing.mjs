#!/usr/bin/env node
/** Incremental bundled pricing sync; uses the same conversion as runtime refresh. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { EnvHttpProxyAgent } from 'undici';
import { loadPricingSources, pricingPublicationData } from '../src/pricing/pricing-sources.mjs';

const PRICING_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'pricing', 'pricing.json');

async function main() {
  const current = JSON.parse(readFileSync(PRICING_PATH, 'utf8'));
  const dispatcher = new EnvHttpProxyAgent();
  let next;
  try {
    next = await loadPricingSources(current, (url, options) => fetch(url, { ...options, dispatcher }), AbortSignal.timeout(30_000));
  } finally { await dispatcher.close(); }

  const changes = Object.entries(next.exact).filter(([key, rate]) => current.exact?.[key]
    && !isDeepStrictEqual(current.exact[key], rate));
  const added = Object.keys(next.exact).filter(key => !(key in (current.exact ?? {}))).length;
  const removed = Object.keys(current.exact ?? {}).filter(key => !(key in next.exact));
  if (process.argv.includes('--if-changed')
    && isDeepStrictEqual(pricingPublicationData(next), pricingPublicationData(current))) {
    console.log('(no pricing or model metadata changes — file left unchanged)');
    return;
  }
  const generatedAt = next._meta.generated_at;
  next._meta.note = `${current._meta?.note ?? ''} Incremental models.dev sync on ${generatedAt.slice(0, 10)}: `
    + `kept=${Object.keys(next.exact).length} (added=${added}, changed=${changes.length}, removed=${removed.length}). `
    + 'Official-only: models.dev primary, LiteLLM direct-channel gap fill.';
  writeFileSync(PRICING_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`exact: ${Object.keys(current.exact ?? {}).length} -> ${Object.keys(next.exact).length}`);
  console.log(`subscription catalog: ${Object.keys(next.subscription_models).length} models (no per-token rates)`);
  console.log(`added: ${added}, changed: ${changes.length}, removed: ${removed.length}`);
  const report = next._meta.sync_report;
  console.log(`quality: carried=${report.carried}, missing fields=${report.missing_fields}, conflicts=${report.conflicts}, large changes=${report.large_changes}`);
  if (report.failed_sources.length) console.warn(`pricing sources unavailable: ${report.failed_sources.join(', ')}; retained last known prices`);
  for (const [key, rate] of changes) console.log(`  CHANGED ${key}: ${JSON.stringify(current.exact[key])} -> ${JSON.stringify(rate)}`);
  for (const key of removed) console.log(`  REMOVED ${key} (was ${JSON.stringify(current.exact[key])})`);
  if (!changes.length && !removed.length) console.log('(no price changes — table is already up to date)');
}

main().catch(err => { console.error(err); process.exit(1); });
