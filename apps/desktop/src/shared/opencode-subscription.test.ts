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
      { windowDurationMins: 44_640, usedPercent: 99, nextResetTime: 1_902_678_400 },
    ],
  });
  assert.equal(result.planLabel, 'Go');
  assert.deepEqual(result.limits.map((limit) => [limit.id, limit.label, limit.usedPercent]), [
    ['five-hour', '5h', 35],
    ['weekly', '7d', 20],
    ['monthly', '月限额', 99],
  ]);
});

test('maps official Go usage with rolling, weekly and calendar-month windows', () => {
  // Official v1.19.0 /zen/go/v1/usage: percent is already on the 0–100 scale.
  const result = mapOpenCodeUsage({ usage: {
    rolling: { status: 'ok', percent: 1, resetsAt: '2030-01-02T05:00:00Z' },
    weekly: { status: 'ok', percent: 0.5, resetsAt: '2030-01-07T00:00:00Z' },
    monthly: { status: 'rate-limited', percent: 100, resetsAt: '2030-01-31T12:00:00Z' },
  } });
  assert.equal(result.planLabel, 'Go');
  assert.deepEqual(result.limits.map(row => [row.id, row.usedPercent, row.resetsAt]), [
    ['five-hour', 1, Date.parse('2030-01-02T05:00:00Z') / 1000],
    ['weekly', 0.5, Date.parse('2030-01-07T00:00:00Z') / 1000],
    ['monthly', 100, Date.parse('2030-01-31T12:00:00Z') / 1000],
  ]);
  assert.equal(result.limits[2].durationSeconds, null, 'a monthly reset does not reveal the subscription anchor or exact cycle duration');
});

test('supports the earlier Go usage schema and relative reset seconds without changing percent units', () => {
  const now = 1_900_000_000;
  const result = mapOpenCodeUsage({
    rollingUsage: { status: 'ok', usagePercent: 0, resetInSec: 18_000 },
    weeklyUsage: { status: 'ok', usagePercent: 1, resetInSec: 60 },
    monthlyUsage: { status: 'ok', usagePercent: 99, resetInSec: 0 },
  }, now);
  assert.deepEqual(result.limits.map(row => [row.id, row.usedPercent, row.resetsAt]), [
    ['five-hour', 0, now + 18_000], ['weekly', 1, now + 60], ['monthly', 99, now],
  ]);
});

test('retains a named monthly legacy pool and rejects missing readings rather than inventing zero', () => {
  const result = mapOpenCodeUsage({ plan: 'Go', monthly: { usedPercent: 42, resetsAt: 1_900_000_000 } });
  assert.deepEqual(result.limits.map(row => row.id), ['monthly']);
  assert.deepEqual(mapOpenCodeUsage({ usage: { monthly: { percent: null }, rolling: { percent: '' } } }).limits, []);
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
