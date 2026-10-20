#!/usr/bin/env node
/** Incremental bundled pricing sync; uses the same conversion as runtime refresh. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { EnvHttpProxyAgent } from 'undici';
import { mergeModelsDevPricing, MODELS_DEV_URL } from '../src/pricing/models-dev.mjs';

const PRICING_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'pricing', 'pricing.json');

async function main() {
  const current = JSON.parse(readFileSync(PRICING_PATH, 'utf8'));
  const dispatcher = new EnvHttpProxyAgent();
  let catalog;
  try {
    const res = await fetch(MODELS_DEV_URL, {
      headers: { Accept: 'application/json' }, dispatcher, signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`models.dev fetch failed: HTTP ${res.status}`);
    }
    catalog = await res.json();
  } finally { await dispatcher.close(); }

  const next = mergeModelsDevPricing(current, catalog);
  const changes = Object.entries(next.exact).filter(([key, rate]) => current.exact?.[key]
    && !isDeepStrictEqual(current.exact[key], rate));
  const added = Object.keys(next.exact).filter(key => !(key in (current.exact ?? {}))).length;
  const removed = Object.keys(current.exact ?? {}).filter(key => !(key in next.exact));
  if (process.argv.includes('--if-changed')
    && isDeepStrictEqual(next.exact, current.exact ?? {})
    && isDeepStrictEqual(next.model_metadata, current.model_metadata ?? {})
    && isDeepStrictEqual(next.subscription_models, current.subscription_models ?? {})) {
    console.log('(no pricing or model metadata changes — file left unchanged)');
    return;
  }
  const generatedAt = next._meta.generated_at;
  next._meta.note = `${current._meta?.note ?? ''} Incremental models.dev sync on ${generatedAt.slice(0, 10)}: `
    + `kept=${Object.keys(next.exact).length} (added=${added}, changed=${changes.length}, removed=${removed.length}). `
    + 'Official-only: cross-vendor hosting and cloud-partnership channels dropped.';
  writeFileSync(PRICING_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`exact: ${Object.keys(current.exact ?? {}).length} -> ${Object.keys(next.exact).length}`);
  console.log(`subscription catalog: ${Object.keys(next.subscription_models).length} models (no per-token rates)`);
  console.log(`added: ${added}, changed: ${changes.length}, removed: ${removed.length}`);
  for (const [key, rate] of changes) console.log(`  CHANGED ${key}: ${JSON.stringify(current.exact[key])} -> ${JSON.stringify(rate)}`);
  for (const key of removed) console.log(`  REMOVED ${key} (was ${JSON.stringify(current.exact[key])})`);
  if (!changes.length && !removed.length) console.log('(no price changes — table is already up to date)');
}

main().catch(err => { console.error(err); process.exit(1); });
