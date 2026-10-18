import assert from 'node:assert/strict';
import test from 'node:test';
import { registerMessages } from 'quotern-i18n';
import { usageMessages } from '../i18n/usage-messages.ts';
import { formatSubscriptionResetTime } from './subscription-time.ts';

registerMessages(usageMessages);

test('quota reset labels localize relative days while preserving provider instant', () => {
  const now = new Date(2026, 9, 17, 10, 0);
  const tomorrow = new Date(2026, 9, 18, 12, 30).getTime() / 1000;
  assert.equal(formatSubscriptionResetTime(tomorrow, now, false, 'en'), 'Tomorrow 12:30');
  assert.equal(formatSubscriptionResetTime(tomorrow, now, false, 'ja'), '明日 12:30');
  assert.equal(formatSubscriptionResetTime(tomorrow, now, false, 'ko'), '내일 12:30');
});
