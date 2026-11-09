import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTrayPanel } from './tray-panel';

test('tray panel normalization only preserves a valid mode', () => {
  assert.deepEqual(normalizeTrayPanel({ pinned: true, x: -800.3, y: 25.4, mode: 'summary' }), { mode: 'summary' });
  assert.deepEqual(normalizeTrayPanel({ pinned: false, mode: 'unsupported' }), {});
  assert.deepEqual(normalizeTrayPanel(null), {});
});
