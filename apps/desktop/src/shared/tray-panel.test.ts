import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTrayPanel } from './tray-panel';

test('tray summary mode survives normalization without changing pin or screen coordinates', () => {
  assert.deepEqual(normalizeTrayPanel({ pinned: true, x: -800.3, y: 25.4, mode: 'summary' }), { pinned: true, x: -800, y: 25, mode: 'summary' });
  assert.deepEqual(normalizeTrayPanel({ pinned: false, mode: 'unsupported' }), { pinned: false });
  assert.deepEqual(normalizeTrayPanel(null), { pinned: false });
});
