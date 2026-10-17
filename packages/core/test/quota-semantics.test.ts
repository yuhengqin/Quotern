import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeQuotaSnapshot } from '../src/quota/shared/quota-analysis.js';
import { quotaDisplayDetails, quotaForecasts, quotaTrendWindows, sortQuotaWindows } from '../src/quota/shared/quota-presentation.js';
import { mapGrokBilling } from '../src/quota/shared/grok-subscription.js';
import { mapKimiUsage } from '../src/quota/shared/kimi-subscription.js';
import type { QuotaAnalysis, QuotaWindow } from '../src/quota/shared/quota.js';

const now = 1_900_000_000;

test('normalization preserves legacy detail text and exposes unlimited versus exhausted meaning', () => {
  const { details } = normalizeQuotaSnapshot('copilot', 'Copilot', { limits: [
    { id: 'chat', label: 'Chat', unlimited: true, resetsAt: null },
    { id: 'completions', label: 'Completions', unlimited: true, exhausted: true, resetsAt: null },
  ] });
  assert.deepEqual(details, [
    { id: 'chat', label: 'Chat', text: '无限', valueKind: 'unlimited', resetsAt: null },
    { id: 'completions', label: 'Completions', text: '已用尽', valueKind: 'exhausted', resetsAt: null },
  ]);
});

test('Copilot detail merging uses entitlement meaning even when display text changes', () => {
  const unlimited = normalizeQuotaSnapshot('copilot', 'Copilot', { limits: [
    { id: 'chat', label: 'Chat', unlimited: true },
    { id: 'completions', label: 'Completions', unlimited: true },
  ] }).details.map(detail => ({ ...detail, text: 'Unlimited' }));
  assert.deepEqual(quotaDisplayDetails('copilot', unlimited), [
    { id: 'chat-completions', label: '聊天与代码补全', text: '无限', valueKind: 'unlimited', resetsAt: null },
  ]);

  const exhausted = normalizeQuotaSnapshot('copilot', 'Copilot', { limits: [
    { id: 'chat', label: 'Chat', unlimited: true },
    { id: 'completions', label: 'Completions', unlimited: true, exhausted: true },
  ] }).details.map(detail => ({ ...detail, text: 'Unlimited' }));
  assert.equal(quotaDisplayDetails('copilot', exhausted).length, 2);
});

const accountWindows = (): QuotaWindow[] => normalizeQuotaSnapshot('codex', 'Codex', { windows: [
  { id: 'account:18000', label: 'Quick allowance', usedPercent: 40, resetsAt: null, durationSeconds: 18_000 },
  { id: 'account:604800', label: 'Long allowance', usedPercent: 30, resetsAt: now + 604_800, durationSeconds: 604_800 },
] }).windows;

test('period metadata and presentation order do not depend on a translated window label', () => {
  const windows = accountWindows();
  assert.deepEqual(windows.map(window => (window as QuotaWindow & { periodSeconds?: number | null }).periodSeconds), [18_000, 604_800]);
  assert.deepEqual(sortQuotaWindows(windows).map(window => window.id), ['account:604800', 'account:18000']);
  assert.deepEqual(windows.map(window => window.label), ['Quick allowance', 'Long allowance']);
});

test('an unrelated numeric identifier is not mistaken for a cycle length', () => {
  const { windows } = normalizeQuotaSnapshot('codex', 'Codex', { windows: [
    { id: 'profile:1234', label: 'Account 1234', usedPercent: 20, resetsAt: null },
  ] });
  assert.equal((windows[0] as QuotaWindow & { periodSeconds?: number | null }).periodSeconds, null);
});

test('trend and forecast decisions group account periods without reading labels', () => {
  const windows = accountWindows();
  assert.deepEqual([...quotaTrendWindows('codex', windows)], ['account:18000']);
  const forecast: QuotaAnalysis = { etaAt: now + 3600, paceDifference: null, paceBasis: 'uniform', trend: [] };
  assert.equal(quotaForecasts('codex', windows, { 'account:604800': forecast }, now).size, 0);
});

test('Grok session period keeps its measured duration when its display label is translated', () => {
  const snapshot = mapGrokBilling({ config: { usagePeriods: [
    { type: 'SESSION', start: (now - 3600) * 1000, end: (now + 3600) * 1000, usagePercent: 40 },
  ] } });
  const { windows } = normalizeQuotaSnapshot('grok', 'Grok', {
    ...snapshot, limits: snapshot.limits.map(limit => ({ ...limit, label: 'Two-hour pool' })),
  });
  assert.equal((windows[0] as QuotaWindow & { periodSeconds?: number | null }).periodSeconds, 7200);
  assert.equal(windows[0].label, 'Two-hour pool');
});

test('Kimi keeps an account cycle and a named pool with the same duration', () => {
  const limits = mapKimiUsage({
    usages: { limit_5h: { used_ratio: 0.25 } },
    limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { name: 'Model A', used: 95, limit: 100 } }],
  });
  assert.deepEqual(limits.map(limit => [limit.id, limit.usedPercent]), [
    ['limit_5h', 25], ['model-a', 95],
  ]);
});

test('Kimi orders measured cycles by length when their labels are not period codes', () => {
  const limits = mapKimiUsage({
    usages: { limit_5h: { used_ratio: 0.25 } },
    limits: [{ window: { duration: 120, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { name: 'Short pool', used: 30, limit: 100 } }],
  });
  assert.deepEqual(limits.map(limit => limit.label), ['Short pool', '5h']);
});

test('Kimi keeps differently named custom pools distinct even when their periods match', () => {
  const limits = mapKimiUsage({ limits: [
    { window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { name: 'Model A', used: 20, limit: 100 } },
    { window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { name: 'Model B', used: 30, limit: 100 } },
  ] });
  assert.deepEqual(limits.map(limit => limit.label), ['Model A', 'Model B']);
});
