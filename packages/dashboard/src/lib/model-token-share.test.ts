import assert from 'node:assert/strict';
import test from 'node:test';
import { buildModelTokenShare, buildModelRibbonGeometry } from './model-token-share.ts';

const rows = Array.from({ length: 8 }, (_, index) => ({
  id: `model-${index}`, label: `model-${index}`, color: `var(--chart-${index + 1})`,
  tokens: (8 - index) * 100, costUsd: index === 7 ? 99.004 : index / 1000,
  durationMinutes: 0,
}));

test('Top5 plus Other preserves all model values and the complete list', () => {
  const view = buildModelTokenShare(rows, 'tokens', new Set());
  assert.equal(view.items.length, 6);
  assert.equal(view.chartRows.length, 8);
  assert.equal(view.items[5].isOther, true);
  assert.equal(view.items[5].count, 3);
  assert.equal(view.items.reduce((sum, item) => sum + item.value, 0), view.total);
  assert.ok(Math.abs(view.items.reduce((sum, item) => sum + item.share, 0) - 100) < 1e-10);
  assert.equal(view.items[5].costUsd, 99.004 + 0.005 + 0.006);
});

test('cost ranking uses raw costs and preserves the model color', () => {
  const view = buildModelTokenShare(rows, 'cost', new Set());
  assert.equal(view.items[0].id, 'model-7');
  assert.equal(view.items[0].color, rows[7].color);
  assert.equal(view.items[0].value, 99.004);
  assert.deepEqual(view.chartRows.map(row => row.id), ['model-7', 'model-6', 'model-5', 'model-4', 'model-3', 'model-2', 'model-1', 'model-0']);
});

test('hidden models stay recoverable while all shares use only visible values', () => {
  const view = buildModelTokenShare(rows, 'tokens', new Set(['model-0', 'model-7']));
  assert.equal(view.hasHiddenRows, true);
  assert.equal(view.total, 2700);
  assert.equal(view.items[0].hidden, true);
  assert.equal(view.items[0].share, 0);
  assert.equal(view.items[5].tokens, 500);
  assert.equal(view.chartRows.length, 8);
  assert.ok(Math.abs(view.items.reduce((sum, item) => sum + item.share, 0) - 100) < 1e-10);
});

test('empty, all hidden and zero totals do not invent shares', () => {
  assert.deepEqual(buildModelTokenShare([], 'tokens', new Set()).items, []);
  for (const view of [buildModelTokenShare(rows, 'tokens', new Set(rows.map(row => row.id))), buildModelTokenShare(rows.map(row => ({ ...row, costUsd: 0 })), 'cost', new Set())]) {
    assert.equal(view.total, 0);
    assert.ok(view.items.every(item => item.share === 0));
  }
});

test('a real model with the synthetic Other id remains a separate model', () => {
  const view = buildModelTokenShare(rows.map((row, index) => index === 0 ? { ...row, id: '__other__' } : row), 'tokens', new Set());
  assert.equal(view.items[0].isOther, false);
  assert.notEqual(view.items[0].key, view.items[5].key);
});

test('unknown costs remain distinguishable from a known zero or subtotal', () => {
  const view = buildModelTokenShare([{ ...rows[0], costUsd: Number.NaN }, { ...rows[1], costUsd: 0.004 }], 'cost', new Set());
  assert.equal(view.hasUnknownCosts, true);
  assert.equal(view.hasKnownCosts, true);
  assert.equal(view.total, 0.004);
  const unknown = buildModelTokenShare([{ ...rows[0], costUsd: Number.NaN }], 'cost', new Set());
  assert.equal(unknown.hasKnownCosts, false);
  const zero = buildModelTokenShare([{ ...rows[0], costUsd: 0 }], 'cost', new Set());
  assert.equal(zero.hasUnknownCosts, false);
  assert.equal(zero.hasKnownCosts, true);
});

test('ribbon endpoints preserve a 999:1 ratio and fit their actual rows', () => {
  const geometry = buildModelRibbonGeometry(120, 100, [{ y: 0, height: 48 }, { y: 48, height: 52 }], [99.9, 0.1]);
  assert.ok(Math.abs(geometry.bands[0].thickness / geometry.bands[1].thickness - 999) < 1e-9);
  geometry.bands.forEach((band, index) => {
    const row = [{ y: 0, height: 48 }, { y: 48, height: 52 }][index];
    assert.ok(band.endY >= row.y && band.endY + band.thickness <= row.y + row.height);
  });
  assert.equal(buildModelRibbonGeometry(0, 0, [], []).bands.length, 0);
});
