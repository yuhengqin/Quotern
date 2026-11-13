import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotificationActivation, forwardNotificationActivation, NOTIFICATION_ACTIVATION_FLAG } from './activation.js';

test('the actual local pipe forwards only valid live notification actions without a normal app startup', async t => {
  const received: unknown[] = [];
  const bridge = await createNotificationActivation('quotern-test', (id, action) => { received.push([id, action]); });
  t.after(() => bridge.dispose());
  const url = bridge.url('notice one', 'snooze');
  assert.equal(await forwardNotificationActivation(['electron', 'app', NOTIFICATION_ACTIVATION_FLAG, bridge.pipe, url]), true);
  assert.deepEqual(received, [['notice one', 'snooze']]);
  const forged = new URL(url); forged.searchParams.set('token', 'wrong');
  assert.equal(await forwardNotificationActivation(['electron', 'app', NOTIFICATION_ACTIVATION_FLAG, bridge.pipe, forged.toString()]), false);
  assert.equal(received.length, 1);
  assert.equal(await forwardNotificationActivation(['electron', 'app']), false);
});
