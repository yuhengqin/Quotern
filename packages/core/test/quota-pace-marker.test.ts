import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quotaPaceMarker } from '../src/quota/shared/quota-presentation.js';

test('pace marker converts expected usage to remaining and suppresses stale or expired readings', () => {
  const window = { id: 'week', label: 'week', usedPercent: 30, resetsAt: 200 };
  const analysis = { paceDifference: 20, paceBasis: 'uniform' as const, etaAt: null, trend: [] };
  assert.equal(quotaPaceMarker(window, analysis, false, 100), 50);
  assert.equal(quotaPaceMarker(window, { ...analysis, paceDifference: -20 }, false, 100), 90);
  assert.equal(quotaPaceMarker(window, analysis, true, 100), null);
  assert.equal(quotaPaceMarker(window, analysis, false, 200), null);
  assert.equal(quotaPaceMarker(window, { ...analysis, paceDifference: null }, false, 100), null);
});
