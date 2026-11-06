import { readFileSync } from 'node:fs';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ModelPricingRates } from './matcher.js';
import { withDataTransaction } from '../data-transaction.js';

export interface ManualPricingDocument { version: 1; models: Record<string, ModelPricingRates> }
export interface ManualPricingState { document: ManualPricingDocument; revision: string }
const fields = new Set(['input', 'output', 'cache_read', 'cache_write']);
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const validId = (id: string) => id.length > 0 && id.length <= 200 && id === id.trim() && !/[\u0000-\u001f\u007f]/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
export const manualPricingPath = (dir: string) => join(dir, 'pricing-manual.json');

export function validateManualPricing(value: unknown): ManualPricingDocument {
  if (!record(value) || value.version !== 1 || Object.keys(value).some(key => !['version', 'models'].includes(key)) || !record(value.models) || Object.keys(value.models).length > 5000) throw new Error('INVALID_MANUAL_PRICING');
  const models: Record<string, ModelPricingRates> = {};
  for (const [id, rates] of Object.entries(value.models).sort(([a], [b]) => a.localeCompare(b))) {
    if (!validId(id) || !record(rates) || !Object.keys(rates).length || Object.keys(rates).some(key => !fields.has(key))
      || Object.values(rates).some(rate => typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1_000_000)) throw new Error('INVALID_MANUAL_PRICING');
    models[id] = Object.fromEntries([...fields].filter(key => rates[key] !== undefined).map(key => [key, rates[key]]));
  }
  const result: ManualPricingDocument = { version: 1, models };
  if (Buffer.byteLength(JSON.stringify(result)) > 1_000_000) throw new Error('INVALID_MANUAL_PRICING');
  return result;
}

let active: ManualPricingDocument = { version: 1, models: {} };
export function getManualPricing(): ManualPricingDocument { return active; }
export function applyManualPricing(value: ManualPricingDocument): void { active = validateManualPricing(value); }
const revision = (doc: ManualPricingDocument) => createHash('sha256').update(JSON.stringify(doc)).digest('hex');

export function readManualPricing(dataDir: string): ManualPricingState {
  let document: ManualPricingDocument;
  try {
    const raw = readFileSync(manualPricingPath(dataDir), 'utf8');
    if (Buffer.byteLength(raw) > 1_000_000) throw new Error('INVALID_MANUAL_PRICING');
    document = validateManualPricing(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    document = { version: 1, models: {} };
  }
  return { document, revision: revision(document) };
}

export function loadManualPricing(dataDir: string): boolean {
  const next = readManualPricing(dataDir);
  if (next.revision === revision(active)) return false;
  active = next.document; return true;
}

export async function updateManualPricing(dataDir: string, expectedRevision: string, model: string, rates: ModelPricingRates | null): Promise<ManualPricingState> {
  if (!validId(model)) throw new Error('INVALID_MANUAL_PRICING');
  return withDataTransaction(dataDir, async () => {
    const before = readManualPricing(dataDir);
    if (before.revision !== expectedRevision) throw new Error('PRICING_CONFLICT');
    const models = { ...before.document.models };
    if (rates === null) delete models[model]; else models[model] = rates;
    const document = validateManualPricing({ version: 1, models });
    const path = manualPricingPath(dataDir), temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, `${JSON.stringify(document)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
    finally { await unlink(temporary).catch(() => {}); }
    active = document;
    return { document, revision: revision(document) };
  });
}
