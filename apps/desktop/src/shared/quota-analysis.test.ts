import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeQuota, quotaCycleChanged, evaluateQuotaAlerts, normalizeQuotaSnapshot } from './quota-analysis.js';
import type { QuotaSample, QuotaWindow } from './quota.js';

const now = Date.UTC(2026, 9, 16, 12) / 1000;
const window: QuotaWindow = { id: '5h', label: '5h', usedPercent: 40, resetsAt: now + 4 * 3600, durationSeconds: 5 * 3600 };
const samples: QuotaSample[] = [-60, -30, 0].map((minutes, i) => ({ at: now + minutes * 60, usedPercent: 10 + i * 15, resetsAt: window.resetsAt }));

test('normalizes dynamic windows without conflating unknown, unlimited and exhausted quotas', () => {
  const result = normalizeQuotaSnapshot('copilot', 'Copilot', { status: 'ready', fetchedAt: now, limits: [
    { id: 'premium', label: 'Premium', remainingPercent: 0, resetsAt: now + 3600 },
    { id: 'unknown', label: 'Unknown', remainingPercent: null },
    { id: 'unlimited', label: 'Unlimited', unlimited: true, remainingPercent: null },
  ] });
  assert.deepEqual(result.windows.map(row => [row.id, row.usedPercent]), [['premium', 100]]);
  assert.equal(result.fetchedAt, now);
});

test('stable IDs retain same-type model windows and reject invalid ratios', () => {
  const result = normalizeQuotaSnapshot('claude', 'Claude', { status: 'ready', windows: [
    { id: 'weekly', label: '7d', usedPercent: 10, resetsAt: now },
    { id: 'model:fable', label: '7d', groupLabel: 'Fable', usedPercent: 20, resetsAt: now },
    { id: 'bad', label: 'bad', usedPercent: 'oops' },
  ] });
  assert.deepEqual(result.windows.map(row => row.id), ['weekly', 'model:fable']);
});

test('ETA uses recent real samples and only warns before reset', () => {
  const result = analyzeQuota(window, samples, now, 'uniform', 'Asia/Shanghai');
  assert.equal(result.etaAt, now + 7200);
  assert.equal(result.paceDifference, -20);
  assert.equal(result.trend.length, 3);
  assert.equal(analyzeQuota({ ...window, resetsAt: now + 3600 }, samples, now, 'uniform', 'Asia/Shanghai').etaAt, null);
  assert.equal(analyzeQuota(window, samples.slice(1), now, 'uniform', 'Asia/Shanghai').etaAt, null);
});

test('old samples, stale current values and cycle resets cannot produce a current ETA', () => {
  assert.equal(analyzeQuota(window, samples, now + 7200, 'uniform', 'Asia/Shanghai').etaAt, null);
  const next = [{ at: now, usedPercent: 5, resetsAt: now + 86400 }];
  assert.equal(analyzeQuota({ ...window, resetsAt: now + 86400 }, [...samples, ...next], now, 'uniform', 'Asia/Shanghai').etaAt, null);
  assert.equal(quotaCycleChanged(samples[0], { ...samples[0], usedPercent: 1 }), false);
  assert.equal(quotaCycleChanged(samples[0], { ...samples[0], usedPercent: 1, resetsAt: now + 86400 }), true);
  assert.equal(quotaCycleChanged(samples[0], { ...samples[0], usedPercent: 96, resetsAt: now + 86400 }), true);
});

test('workday pace stays flat on weekends and automatic needs fourteen distinct dates', () => {
  const monday = Date.UTC(2026, 9, 12) / 1000;
  const saturday = monday + 5 * 86400;
  const sunday = saturday + 86400;
  const weekly = { ...window, id: 'weekly', durationSeconds: 7 * 86400, resetsAt: monday + 7 * 86400, usedPercent: 60 };
  const a = analyzeQuota(weekly, [], saturday, 'workdays', 'UTC');
  const b = analyzeQuota(weekly, [], sunday, 'workdays', 'UTC');
  assert.equal(a.paceDifference, b.paceDifference);
  assert.equal(analyzeQuota(weekly, [], saturday, 'automatic', 'UTC').paceDifference,
    analyzeQuota(weekly, [], saturday, 'uniform', 'UTC').paceDifference);
});

test('alerts establish baseline, cross once per cycle, and reset only on a genuine transition', () => {
  const low = { at: now, usedPercent: 60, resetsAt: now + 3600 };
  let result = evaluateQuotaAlerts(null, low, 'weekly');
  assert.deepEqual(result.alerts, []);
  result = evaluateQuotaAlerts(result.observation, { ...low, at: now + 60, usedPercent: 95 }, 'weekly');
  assert.deepEqual(result.alerts, ['threshold-70', 'threshold-90']);
  const same = evaluateQuotaAlerts(result.observation, { ...low, at: now + 60, usedPercent: 95 }, 'weekly');
  assert.deepEqual(same.alerts, []);
  const dip = evaluateQuotaAlerts(result.observation, { ...low, at: now + 120, usedPercent: 65 }, 'weekly');
  assert.deepEqual(evaluateQuotaAlerts(dip.observation, { ...low, at: now + 180, usedPercent: 95 }, 'weekly').alerts, []);
  assert.deepEqual(evaluateQuotaAlerts(result.observation, { at: now + 7200, usedPercent: 5, resetsAt: now + 10800 }, 'weekly').alerts, ['reset']);
});

test('usage recalculation without reset evidence never rearms alerts or announces a reset', () => {
  let previous = evaluateQuotaAlerts(null, { at: now, usedPercent: 68, resetsAt: null }, 'weekly');
  const alerts = [];
  for (const [i, usedPercent] of [75, 69, 75, 10, 95].entries()) {
    previous = evaluateQuotaAlerts(previous.observation, { at: now + (i + 1) * 60, usedPercent, resetsAt: null }, 'weekly');
    alerts.push(...previous.alerts);
  }
  assert.deepEqual(alerts, ['threshold-70', 'threshold-90']);
});

test('normalization preserves expiration and regional labels instead of promising a reset', () => {
  const qoder = normalizeQuotaSnapshot('qoder', 'Qoder', { limits: [{ id: 'credits', label: 'Credits', usedPercent: 20, resetsAt: now }] });
  assert.equal(qoder.windows[0].timeKind, 'expiry');
  assert.equal(normalizeQuotaSnapshot('zcode', 'ZCode', { provider: 'bigmodel' }).label, 'ZCode CN');
  assert.equal(normalizeQuotaSnapshot('minimax', 'MiniMax', { region: 'mainland' }).label, 'MiniMax CN');
});

test('automatic pace uses a sufficient observed history and local weekend boundaries matter', () => {
  const weekly = { ...window, durationSeconds: 604800, resetsAt: Date.UTC(2026, 9, 19, 4) / 1000 };
  const current = Date.UTC(2026, 9, 17, 2) / 1000;
  const sparse = Array.from({ length: 16 }, (_,i) => ({ at: current - (15 - i) * 86400, usedPercent: 10 + i * 2, resetsAt: weekly.resetsAt }));
  assert.equal(analyzeQuota(weekly, sparse, current, 'automatic', 'America/New_York').paceBasis, 'uniform');
  const history = sparse.flatMap(sample => [{ ...sample, at: sample.at - 3600 }, { ...sample, usedPercent: sample.usedPercent + 5 }]);
  assert.equal(analyzeQuota(weekly, history, current, 'automatic', 'America/New_York').paceBasis, 'automatic');
  assert.notEqual(analyzeQuota(weekly, [], current, 'workdays', 'America/New_York').paceDifference,
    analyzeQuota(weekly, [], current, 'workdays', 'Asia/Shanghai').paceDifference);
});
