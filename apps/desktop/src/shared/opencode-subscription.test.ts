import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapOpenCodeUsage,
  openCodePlanLabel,
  openCodeRemainingPercent,
} from './opencode-subscription';

test('maps OpenCode Go usage windows with explicit durations', () => {
  const result = mapOpenCodeUsage({
    plan: 'go',
    windows: [
      { windowDurationMins: 300, usedPercent: 35, nextResetTime: 1_900_000_000 },
      { windowDurationMins: 10_080, usedPercent: 0.2, nextResetTime: 1_900_086_400 },
    ],
  });
  assert.equal(result.planLabel, 'Go');
  assert.deepEqual(result.limits.map((limit) => [limit.id, limit.label, limit.usedPercent]), [
    ['five-hour', '5h', 35],
    ['weekly', '7d', 20],
  ]);
});

test('falls back to primary/secondary named windows', () => {
  const result = mapOpenCodeUsage({
    plan: 'PRO',
    primary: { usedPercent: 12, windowDurationMins: 300 },
    secondary: { usedPercent: 41, windowDurationMins: 10_080 },
  });
  assert.equal(result.planLabel, 'Pro');
  assert.deepEqual(result.limits.map((limit) => limit.id), ['five-hour', 'weekly']);
});

test('drops unknown windows when the duration cannot be classified', () => {
  const result = mapOpenCodeUsage({ windows: [{ usedPercent: 50 }] });
  assert.deepEqual(result.limits, []);
});

test('returns an empty snapshot for malformed payloads', () => {
  assert.deepEqual(mapOpenCodeUsage(null), { planLabel: null, limits: [] });
});

test('normalizes OpenCode plan labels and keeps unknown values verbatim', () => {
  assert.equal(openCodePlanLabel('go'), 'Go');
  assert.equal(openCodePlanLabel('PRO'), 'Pro');
  assert.equal(openCodePlanLabel('Custom'), 'Custom');
  assert.equal(openCodePlanLabel(null), null);
});

test('clamps OpenCode remaining percentage to [0, 100]', () => {
  assert.equal(openCodeRemainingPercent(0), 100);
  assert.equal(openCodeRemainingPercent(60), 40);
  assert.equal(openCodeRemainingPercent(150), 0);
  assert.equal(openCodeRemainingPercent(Number.NaN), 0);
});
