import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeDetailUsage, type DetailMember } from './session-detail.ts';
import { shouldShowUsageTotal, visibleServiceTiers } from './session-detail-presentation.ts';

const member = (): DetailMember => ({ source: 'codex', sessionId: 'one', tokens: 100, costUsd: 1, knownCostUsd: 1, costKind: 'estimated', relationKind: 'own', detailsComplete: true, agentRole: null, agentNickname: null, models: [{ model: 'one', tokens: 100, costUsd: 1, knownCostUsd: 1, costKind: 'estimated', requests: 2, input_tokens: 70, cached_input_tokens: 10, cache_creation_input_tokens: 0, output_tokens: 15, reasoning_output_tokens: 5, serviceTiers: ['standard'] }] });

test('a single fully allocated model has no duplicate total, including unknown categories and zero cost', () => {
  const row = member();
  assert.equal(shouldShowUsageTotal(summarizeDetailUsage([row])), false);
  row.costUsd = row.knownCostUsd = row.models![0].costUsd = row.models![0].knownCostUsd = 0;
  row.models![0].cached_input_tokens = null;
  assert.equal(shouldShowUsageTotal(summarizeDetailUsage([row])), false);
});

test('totals remain when multiple models or missing model allocation add information', () => {
  const one = member(), two = member();
  two.models![0].model = 'two';
  assert.equal(shouldShowUsageTotal(summarizeDetailUsage([one, two])), true);
  one.tokens = 120;
  assert.equal(shouldShowUsageTotal(summarizeDetailUsage([one])), true);
  one.models = [];
  assert.equal(shouldShowUsageTotal(summarizeDetailUsage([one])), true);
});

test('a session amount or known subtotal that differs from its only model retains the total', () => {
  const row = member(); row.costUsd = 5; row.knownCostUsd = 5; row.unallocatedCostUsd = 5;
  assert.equal(shouldShowUsageTotal(summarizeDetailUsage([row])), true);
  row.costUsd = null; row.knownCostUsd = 0.5;
  row.models![0].costUsd = null; row.models![0].knownCostUsd = 0.25;
  assert.equal(shouldShowUsageTotal(summarizeDetailUsage([row])), true);
});

test('default and unknown tiers never create labels; non-default tiers remain distinct', () => {
  assert.deepEqual(visibleServiceTiers(['standard', 'unknown', '', ' Standard ']), []);
  assert.deepEqual(visibleServiceTiers(['standard', 'fast', 'unknown', 'fast', 'flex', 'batch']), ['fast', 'flex', 'batch']);
});
