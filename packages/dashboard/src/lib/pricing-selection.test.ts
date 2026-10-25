import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupPricingCatalog } from './pricing-groups.ts';
import { filterSessionPricingGroups, parsePricingSearch } from './pricing-selection.ts';

const row = (model: string) => ({ model, input: 1, output: 2, cacheRead: 0, cacheWrite: null });
const groups = groupPricingCatalog([row('openai/gpt-a'), row('openai/gpt-a-fast'), row('anthropic/claude-b'), row('one/ambiguous'), row('two/ambiguous')]);

test('pricing URLs preserve a deduplicated explicit source/model selection', () => {
  const models = [{ source: 'codex', model: 'auto' }, { source: 'claude', model: 'auto' }];
  assert.deepEqual(parsePricingSearch({ q: 'foo', models: JSON.stringify([...models, models[0]]) }), { q: 'foo', models });
  assert.deepEqual(parsePricingSearch({ models: 'invalid' }), { q: '' });
  assert.deepEqual(parsePricingSearch({ models: [{ source: 'codex' }] }), { q: '' });
});

test('session selection matches multiple identities and source aliases without fuzzy or sibling matches', () => {
  const selection = [{ source: 'codex', model: 'auto' }, { source: 'claude', model: 'auto' }];
  const result = filterSessionPricingGroups(groups, selection, { sourceAlias: { codex: { auto: 'openai/gpt-a' }, claude: { auto: 'anthropic/claude-b' } } });
  assert.deepEqual(result.groups.map(group => group.model).sort(), ['anthropic/claude-b', 'openai/gpt-a']);
  assert.deepEqual(result.unmatched, []);
});

test('unresolved and ambiguous session models show no unrelated catalog rows', () => {
  const selection = [{ source: 'codex', model: 'missing' }, { source: 'codex', model: 'ambiguous' }];
  assert.deepEqual(filterSessionPricingGroups(groups, selection), { groups: [], unmatched: selection });
  assert.equal(filterSessionPricingGroups(groups, []).groups.length, groups.length);
});

test('a selected model retains its own grouped regional channels without selecting other models', () => {
  const regional = groupPricingCatalog([{ ...row('moonshotai/kimi-k3'), canonicalModelId: 'moonshotai/kimi-k3' }, { ...row('moonshotai-cn/kimi-k3'), canonicalModelId: 'moonshotai/kimi-k3' }, { ...row('kimi-code-plan-cn/k3'), canonicalModelId: 'moonshotai/kimi-k3', billingMode: 'subscription' as const }, row('openai/gpt-a-fast')]);
  const filtered = filterSessionPricingGroups(regional, [{ source: 'codex', model: 'moonshotai/kimi-k3' }]);
  assert.equal(filtered.groups.length, 1);
  assert.equal(filtered.groups[0].entries.length, 3);
});
