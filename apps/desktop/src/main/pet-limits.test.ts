import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectPetLimits } from './pet-limits.js';

test('pet limit rows include only current, finite, partial allowance readings', () => {
  assert.deepEqual(collectPetLimits({
    codex: { status: 'ready', stale: false, fiveHour: { usedPercent: 82, resetsAt: 123 }, weekly: { usedPercent: 100, resetsAt: 456 } },
    claude: { status: 'ready', stale: true, fiveHour: { usedPercent: 51 } },
    copilot: { status: 'ready', stale: false, limits: [{ label: 'Premium', remainingPercent: 25, unlimited: false, resetsAt: null }] },
    kimiCode: { status: 'not-signed-in', limits: [{ label: 'Weekly', usedPercent: 90 }] },
  }), [
    { provider: 'Codex', window: '5h', usedPercent: 82, resetAt: 123 },
    { provider: 'GitHub Copilot', window: 'Premium', usedPercent: 75, resetAt: null },
  ]);
});
