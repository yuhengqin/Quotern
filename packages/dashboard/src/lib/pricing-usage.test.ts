import assert from 'node:assert/strict';
import { it } from 'node:test';
import { addPricingUsage } from './pricing-catalog.ts';
import type { ModelBreakdownRow, PricingCatalogRow } from './api.ts';

const rows: PricingCatalogRow[] = [
  { model: 'openai/gpt-6.1-sol', input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  { model: 'openai/gpt-6.1-sol-fast', input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  { model: 'anthropic/claude-opus-5-5', input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
];
const usage = (model: string, source: string, tokens: number): ModelBreakdownRow => ({ model, source, tokens, costUsd: 0, pct: 0 });

it('combines aliases across Agents while preserving distinct pricing variants', () => {
  const result = addPricingUsage(rows, [
    usage('gpt-6.1-sol', 'codex', 100),
    usage('auto', 'pi', 200),
    usage('gpt-6.1-sol-fast', 'codex', 400),
    usage('Claude Opus 5.5', 'claude', 500),
    usage('future-gpt-99', 'codex', 90000),
    usage('gpt-6.1-sol', 'codex', Number.NaN),
  ], { sourceAlias: { pi: { auto: 'openai/gpt-6.1-sol' } } });
  assert.deepEqual(result.map(row => [row.model, row.usageTokens]), [
    ['openai/gpt-6.1-sol', 300], ['openai/gpt-6.1-sol-fast', 400], ['anthropic/claude-opus-5-5', 500],
  ]);
  assert.equal('usageTokens' in rows[0]!, false);
});
