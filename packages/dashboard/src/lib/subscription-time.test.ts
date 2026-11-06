import assert from 'node:assert/strict';
import test from 'node:test';
import { registerMessages } from 'quotern-i18n';
import { usageMessages } from '../i18n/usage-messages.ts';
import { formatSubscriptionResetTime, formatSubscriptionCountdown } from './subscription-time.ts';

registerMessages(usageMessages);

test('quota reset labels localize relative days while preserving provider instant', () => {
  const now = new Date(2026, 9, 17, 10, 0);
  const tomorrow = new Date(2026, 9, 18, 12, 30).getTime() / 1000;
  assert.equal(formatSubscriptionResetTime(tomorrow, now, false, 'en'), 'Tomorrow 12:30');
  assert.equal(formatSubscriptionResetTime(tomorrow, now, false, 'ja'), '明日 12:30');
  assert.equal(formatSubscriptionResetTime(tomorrow, now, false, 'ko'), '내일 12:30');
});

test('countdown keeps days, hours and minutes and distinguishes due from unknown', () => {
  const now = new Date('2026-11-06T00:00:00Z');
  const at = now.getTime() / 1000;
  assert.equal(formatSubscriptionCountdown(at + 90060, now, 'en'), '1d 1h 1m');
  assert.equal(formatSubscriptionCountdown(at + 192 * 60, now, 'en'), '3h 12m');
  assert.equal(formatSubscriptionCountdown(at + 1, now, 'en'), '1m');
  assert.equal(formatSubscriptionCountdown(at - 1, now, 'en'), 'Awaiting update');
  assert.equal(formatSubscriptionCountdown(null, now, 'en'), null);
});
