import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenSettingsDetail } from './settings-navigation.js';

test('settings navigation carries the exact pet and a distinct request through the preload boundary', () => {
  for (const target of [{ kind: 'dsh' }, { kind: 'builtin', character: 'custom-cat' }]) {
    assert.deepEqual(parseOpenSettingsDetail({ tab: 'pet', pet: { target, requestId: 'menu-2' } }), { tab: 'pet', pet: { target, requestId: 'menu-2' } });
  }
  assert.deepEqual(parseOpenSettingsDetail({ tab: 'pet', pet: { target: { kind: 'builtin', character: '../bad' }, requestId: 'x' } }), { tab: 'pet' });
  assert.deepEqual(parseOpenSettingsDetail({ tab: 'about', pet: null }), { tab: 'about' });
  assert.deepEqual(parseOpenSettingsDetail(null), {});
});

test('settings navigation accepts the split Desktop sections and keeps the app destination', () => {
  for (const tab of ['appearance', 'integrations', 'data', 'app']) {
    assert.deepEqual(parseOpenSettingsDetail({ tab }), { tab });
  }
  assert.deepEqual(parseOpenSettingsDetail({ tab: 'unknown-section' }), {});
});
