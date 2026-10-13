import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasCustomWorkBuddyConfiguration,
  parseWorkBuddyCredentials,
} from './workbuddy-subscription';

test('accepts WorkBuddy IDE session tokens but rejects BYOK API keys', () => {
  assert.deepEqual(parseWorkBuddyCredentials({ token: 'workbuddy-ide-session-1234567890' }), {
    token: 'workbuddy-ide-session-1234567890',
  });
  assert.deepEqual(parseWorkBuddyCredentials({ session: { token: 'workbuddy-intl-session-0987654321' } }), {
    token: 'workbuddy-intl-session-0987654321',
  });
  assert.equal(parseWorkBuddyCredentials({ apiKey: 'sk-byok-workbuddy-key' }), null);
  assert.equal(parseWorkBuddyCredentials({ token: 'short' }), null);
  assert.equal(parseWorkBuddyCredentials(null), null);
});

test('accepts only the official WorkBuddy API hosts', () => {
  assert.equal(hasCustomWorkBuddyConfiguration({}), false);
  // Until Phase 3 confirms the official host, any non-empty base URL is
  // considered custom-provider so no traffic leaves the box by accident.
  assert.equal(hasCustomWorkBuddyConfiguration({ WORKBUDDY_BASE_URL: 'https://proxy.example/v1' }), true);
});
