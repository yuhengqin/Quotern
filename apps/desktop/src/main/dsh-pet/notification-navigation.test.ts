import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationNavigation } from './notification-navigation.js';

test('pending session navigation survives renderer absence and only the matching acknowledgement clears it', () => {
  const navigation = new NotificationNavigation();
  const first = navigation.open({ source: 'codex', sessionId: 'same' });
  assert.deepEqual(navigation.peek(), first);
  const second = navigation.open({ source: 'claude', sessionId: 'same' });
  navigation.acknowledge(first.navigationId);
  assert.deepEqual(navigation.peek(), second);
  navigation.acknowledge(second.navigationId);
  assert.equal(navigation.peek(), null);
});
