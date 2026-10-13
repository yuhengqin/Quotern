import assert from 'node:assert/strict';
import test from 'node:test';
import { mapWorkBuddyResources, workBuddyRemainingPercent } from './workbuddy-subscription';

test('maps WorkBuddy resources and aggregates used/limit fallback', () => {
  const result = mapWorkBuddyResources({
    plan: 'Pro',
    resources: [
      { id: 'credits', used: 250, total: 1_000, expireAt: 1_900_000_000 },
      { name: 'fast-request', usedPercent: 50, nextResetTime: 1_900_086_400 },
      { unit: 'tokens', usedPercent: 0.2, expiresAt: 1_900_172_800 },
    ],
  });
  assert.equal(result.planLabel, 'Pro');
  assert.deepEqual(result.limits.map((limit) => [limit.id, limit.label, limit.usedPercent, limit.resetsAt]), [
    ['credits', 'credits', 25, 1_900_000_000],
    ['fast-request', 'fast-request', 50, 1_900_086_400],
    ['tokens', 'tokens', 20, 1_900_172_800],
  ]);
});

test('falls back to nested data.resources', () => {
  const result = mapWorkBuddyResources({
    data: {
      tier: 'Starter',
      packages: [{ name: 'base-pack', usedPercent: 80 }],
    },
  });
  assert.equal(result.planLabel, 'Starter');
  assert.equal(result.limits[0]?.label, 'base-pack');
});

test('returns an empty snapshot when no resources are present', () => {
  assert.deepEqual(mapWorkBuddyResources(null), { planLabel: null, limits: [] });
});

test('clamps WorkBuddy remaining percentage to [0, 100]', () => {
  assert.equal(workBuddyRemainingPercent(0), 100);
  assert.equal(workBuddyRemainingPercent(50), 50);
  assert.equal(workBuddyRemainingPercent(150), 0);
  assert.equal(workBuddyRemainingPercent(Number.NaN), 0);
});
