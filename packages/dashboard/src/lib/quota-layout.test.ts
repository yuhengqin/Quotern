import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeQuotaOrder, moveQuotaProvider, quotaDropTarget } from './quota-layout.ts';

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
