import assert from 'node:assert/strict';
import test from 'node:test';
import { mapTraeEntitlements, traeRemainingPercent } from './trae-subscription';

test('maps TRAE entitlement packs and surfaces plan label', () => {
  const result = mapTraeEntitlements({
    plan: 'Pro',
    packs: [
      { type: 'basic', usedPercent: 30, nextResetTime: 1_900_000_000 },
      { type: 'bonus', usedPercent: 50, expireAt: 1_900_086_400 },
      { type: 'extra', usedPercent: 0.81, resetsAt: 1_900_172_800 },
    ],
  });
  assert.equal(result.planLabel, 'Pro');
  assert.deepEqual(result.limits.map((limit) => [limit.id, limit.label, limit.usedPercent, limit.resetsAt]), [
    ['basic', 'Basic', 30, 1_900_000_000],
    ['bonus', 'Bonus', 50, 1_900_086_400],
    ['extra', 'Extra', 81, 1_900_172_800],
  ]);
});

test('falls back to nested data.packs and ignores unrelated entries', () => {
  const result = mapTraeEntitlements({
    data: {
      plan: 'Starter',
      packs: [{ kind: 'basic', percentage: 22 }],
      bundles: [{ type: 'fast-request-legacy', percentage: 60 }],
    },
  });
  assert.equal(result.planLabel, 'Starter');
  assert.deepEqual(result.limits.map((limit) => limit.id), ['basic']);
});

test('returns an empty snapshot when no entitlements are present', () => {
  assert.deepEqual(mapTraeEntitlements(null), { planLabel: null, limits: [] });
  assert.deepEqual(mapTraeEntitlements({ packs: [{ type: 'unknown' }] }), { planLabel: null, limits: [] });
});

test('clamps TRAE remaining percentage to [0, 100]', () => {
  assert.equal(traeRemainingPercent(0), 100);
  assert.equal(traeRemainingPercent(45), 55);
  assert.equal(traeRemainingPercent(150), 0);
  assert.equal(traeRemainingPercent(Number.NaN), 0);
});
