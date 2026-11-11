import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeQuotaOrder, moveQuotaProvider, quotaDropTarget, quotaLayoutGroups } from './quota-layout.ts';

test('moving a quota card inserts it at the destination rather than swapping the ends', () => {
  assert.deepEqual(moveQuotaProvider(['a', 'b', 'c', 'd'], 'a', 'c', 'after'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveQuotaProvider(['a', 'b', 'c', 'd'], 'd', 'b', 'before'), ['a', 'd', 'b', 'c']);
  assert.deepEqual(moveQuotaProvider(['a', 'b'], 'a', 'a', 'after'), ['a', 'b']);
  assert.deepEqual(moveQuotaProvider(['a', 'b'], 'missing', 'b', 'before'), ['a', 'b']);
});

test('saving the visible order retains hidden providers and adds newly discovered cards', () => {
  assert.deepEqual(mergeQuotaOrder(['hidden', 'a', 'offline', 'b'], ['b', 'c', 'a']), ['hidden', 'b', 'offline', 'c', 'a']);
  assert.deepEqual(mergeQuotaOrder([], ['b', 'a']), ['b', 'a']);
});

const grid = [
  { id: 'a', left: 0, top: 0, width: 100, height: 140 },
  { id: 'b', left: 110, top: 0, width: 100, height: 100 },
  { id: 'c', left: 0, top: 150, width: 100, height: 110 },
];
test('wrapped grid drops use inline position even on a final row with one card', () => {
  assert.deepEqual(quotaDropTarget(grid, 125, 50), { id: 'b', placement: 'before', axis: 'x' });
  assert.deepEqual(quotaDropTarget(grid, 90, 220), { id: 'c', placement: 'after', axis: 'x' });
  assert.deepEqual(quotaDropTarget(grid, 250, 80), { id: 'b', placement: 'after', axis: 'x' });
});
test('single-column drops use vertical position and empty grids have no destination', () => {
  assert.deepEqual(quotaDropTarget([grid[0], grid[2]], 70, 155), { id: 'c', placement: 'before', axis: 'y' });
  assert.deepEqual(quotaDropTarget([grid[0], grid[2]], 70, 300), { id: 'c', placement: 'after', axis: 'y' });
  assert.equal(quotaDropTarget([], 0, 0), null);
});

test('compact status rows use vertical insertion inside a mixed horizontal card grid', () => {
  const mixed = [
    { id: 'codex', left: 0, top: 0, width: 100, height: 180 },
    { id: 'claude', left: 110, top: 0, width: 100, height: 40, group: 'statuses' },
    { id: 'gemini', left: 110, top: 45, width: 100, height: 40, group: 'statuses' },
  ];
  assert.deepEqual(quotaDropTarget(mixed, 120, 75), { id: 'gemini', placement: 'after', axis: 'y' });
  assert.deepEqual(quotaDropTarget(mixed, 195, 48), { id: 'gemini', placement: 'before', axis: 'y' });
  assert.deepEqual(quotaDropTarget(mixed, 90, 100), { id: 'codex', placement: 'after', axis: 'x' });
});

test('status grouping retains cross-type order and only merges adjacent status entries', () => {
  const providers = [{ id: 'claude', status: true }, { id: 'codex', status: false }, { id: 'gemini', status: true }, { id: 'zcode', status: true }, { id: 'cursor', status: false }];
  const groups = quotaLayoutGroups(providers, provider => provider.status);
  assert.deepEqual(groups.map(group => group.providers.map(provider => provider.id)), [['claude'], ['codex'], ['gemini', 'zcode'], ['cursor']]);
  assert.deepEqual(groups.flatMap(group => group.providers.map(provider => provider.id)), ['claude', 'codex', 'gemini', 'zcode', 'cursor']);
});
