import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billingStatusMessage } from './billing-status.ts';
test('partial pagination preserves permission/throttle errors as well as the known subtotal', () => {
  assert.equal(billingStatusMessage('partial', 'HTTP_429'), 'limited');
  assert.equal(billingStatusMessage('partial', 'HTTP_403'), 'denied');
  assert.equal(billingStatusMessage('partial', 'TIMEOUT'), 'unavailable');
  assert.equal(billingStatusMessage('partial', 'MISSING_AMOUNT'), null);
  assert.equal(billingStatusMessage('ready', null), null);
});
