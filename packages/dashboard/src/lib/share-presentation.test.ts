import test from 'node:test';
import assert from 'node:assert/strict';
import { shareDimensions, cumulativeShareTokens, shareCostState } from './share-presentation.ts';

test('all share formats use the same design and export aspect, preserving the original PNG size', () => {
  for (const aspect of ['2:3', '1:1', '4:5', '9:16'] as const) {
    const size = shareDimensions(aspect);
    const [x, y] = aspect.split(':').map(Number);
    assert.ok(Math.abs(size.width / size.height - x / y) < 0.001);
    assert.ok(Math.abs(size.exportWidth / size.exportHeight - x / y) < 0.001);
    assert.equal(Math.max(size.exportWidth, size.exportHeight), 2048);
  }
  assert.equal(shareDimensions('2:3').exportWidth, 1365);
});

test('cumulative token series uses observed calendar dates, aggregates duplicates and handles one point', () => {
  assert.deepEqual(cumulativeShareTokens([{ date: '2026-11-03', tokens: 20 }, { date: '2026-11-01', tokens: 5 }, { date: '2026-11-01', tokens: 7 }]), [{ date: '2026-11-01', tokens: 12 }, { date: '2026-11-03', tokens: 32 }]);
  assert.deepEqual(cumulativeShareTokens([{ date: '2026-11-01', tokens: 5 }]), [{ date: '2026-11-01', tokens: 5 }]);
  assert.deepEqual(cumulativeShareTokens([]), []);
});

test('share cost distinguishes no evidence, entirely unpriced, partial and known zero', () => {
  assert.deepEqual(shareCostState(null), { kind: 'unknown', value: null });
  assert.deepEqual(shareCostState({ tokens: 20, unpricedTokens: 20, knownCostUsd: 0 }), { kind: 'unknown', value: null });
  assert.deepEqual(shareCostState({ tokens: 20, unpricedTokens: 10, knownCostUsd: 0.02 }), { kind: 'partial', value: 0.02 });
  assert.deepEqual(shareCostState({ tokens: 20, unpricedTokens: 0, knownCostUsd: 0 }), { kind: 'complete', value: 0 });
});
