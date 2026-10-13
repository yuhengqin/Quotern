import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSubscriptionChannelEnabled,
  isSubscriptionChannelVisibility,
  type SubscriptionChannelVisibility,
} from './subscription-channels';

test('treats missing visibility keys as enabled by default', () => {
  const visibility: SubscriptionChannelVisibility = { claude: false };
  assert.equal(isSubscriptionChannelEnabled(visibility, 'codex'), true);
  assert.equal(isSubscriptionChannelEnabled(visibility, 'claude'), false);
  assert.equal(isSubscriptionChannelEnabled(visibility, 'copilot'), true);
  assert.equal(isSubscriptionChannelEnabled({ copilot: false }, 'copilot'), false);
});

test('accepts only known channel boolean maps', () => {
  assert.equal(
    isSubscriptionChannelVisibility({ cursor: true, kimi: false, copilot: true }),
    true,
  );
  assert.equal(isSubscriptionChannelVisibility({ unknown: true }), false);
  assert.equal(isSubscriptionChannelVisibility({ cursor: 'yes' }), false);
  assert.equal(isSubscriptionChannelVisibility(null), false);
});
