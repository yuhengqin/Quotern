import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalSubscriptionPlanLabel,
  visibleSubscriptionPlanLabel,
} from './subscription-plan';

test('normalizes official plan ids into generic subscription tiers', () => {
  assert.equal(canonicalSubscriptionPlanLabel('personal_professional'), 'Pro');
  assert.equal(canonicalSubscriptionPlanLabel('pro_plus'), 'Pro+');
  assert.equal(canonicalSubscriptionPlanLabel('Max_20x'), 'Max 20x');
  assert.equal(canonicalSubscriptionPlanLabel('Google AI Ultra'), 'Ultra');
  assert.equal(canonicalSubscriptionPlanLabel('teams'), 'Team');
});

test('retains non-equivalent official plan names', () => {
  assert.equal(canonicalSubscriptionPlanLabel('SuperGrok Heavy'), 'SuperGrok Heavy');
  assert.equal(canonicalSubscriptionPlanLabel('Future Tier'), 'Future Tier');
});

test('keeps paid and organization subscription plan labels', () => {
  assert.equal(visibleSubscriptionPlanLabel('Plus'), 'Plus');
  assert.equal(visibleSubscriptionPlanLabel(' Max 5x '), 'Max 5x');
  assert.equal(visibleSubscriptionPlanLabel('Team'), 'Team');
  assert.equal(visibleSubscriptionPlanLabel('Future Tier'), 'Future Tier');
});

test('hides absent and free subscription plan labels', () => {
  assert.equal(visibleSubscriptionPlanLabel(null), null);
  assert.equal(visibleSubscriptionPlanLabel(undefined), null);
  assert.equal(visibleSubscriptionPlanLabel('   '), null);
  assert.equal(visibleSubscriptionPlanLabel('Free'), null);
  assert.equal(visibleSubscriptionPlanLabel(' FREE '), null);
});

test('allows an explicitly supported Free plan badge without changing other cards', () => {
  assert.equal(visibleSubscriptionPlanLabel('free', true), 'Free');
  assert.equal(visibleSubscriptionPlanLabel('Free'), null);
  assert.equal(visibleSubscriptionPlanLabel(null, true), null);
});
