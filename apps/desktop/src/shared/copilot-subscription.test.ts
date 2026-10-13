import assert from 'node:assert/strict';
import test from 'node:test';
import { mapCopilotSubscription } from './copilot-subscription';

test('maps current Copilot Free credits and inline suggestions, preferring its SKU', () => {
  assert.deepEqual(mapCopilotSubscription({
    copilot_plan: 'individual',
    access_type_sku: 'free_limited_copilot',
    token_based_billing: true,
    quota_reset_date_utc: '2026-10-01T00:00:00Z',
    quota_reset_date: '2026-09-30',
    quota_snapshots: {
      chat: { percent_remaining: 100, entitlement: 200, unlimited: false },
      completions: { percent_remaining: 98.3, entitlement: 2000, unlimited: false },
      premium_interactions: { percent_remaining: 0, entitlement: 0, unlimited: false },
    },
  }), {
    planLabel: 'Free',
    limits: [
      { id: 'chat', label: '额度', remainingPercent: 100, unlimited: false, resetsAt: 1_790_812_800 },
      { id: 'completions', label: '内联建议', remainingPercent: 98.3, unlimited: false, resetsAt: 1_790_812_800 },
    ],
  });
});

test('paid credit plans use premium interactions and their own reset timestamp', () => {
  assert.deepEqual(mapCopilotSubscription({
    copilot_plan: 'individual_pro',
    token_based_billing: true,
    quota_reset_date_utc: '2026-10-01T00:00:00Z',
    quota_snapshots: {
      chat: { percent_remaining: 97, entitlement: 100 },
      completions: { percent_remaining: 80, entitlement: 2000 },
      premium_interactions: { percent_remaining: '67.5', quota_reset_at: 1_790_800_000 },
    },
  }), {
    planLabel: 'Pro+',
    limits: [{ id: 'premium_interactions', label: '额度', remainingPercent: 67.5, unlimited: false, resetsAt: 1_790_800_000 }],
  });
});

test('legacy paid plans expose premium requests and omit unlimited base features', () => {
  assert.deepEqual(mapCopilotSubscription({
    copilot_plan: 'business',
    quota_reset_date: '2026-10-01',
    quota_snapshots: {
      chat: { unlimited: true },
      completions: { entitlement: '-1' },
      premium_interactions: { entitlement: '300', remaining: 240 },
    },
  }), {
    planLabel: 'Business',
    limits: [{ id: 'premium_interactions', label: '高级请求', remainingPercent: 80, unlimited: false, resetsAt: 1_790_812_800 }],
  });
});

test('unlimited quotas carry no fake percentage and report exhausted organization pools', () => {
  for (const unlimitedFields of [{ unlimited: true }, { entitlement: '-1' }]) {
    assert.deepEqual(mapCopilotSubscription({
      copilot_plan: 'enterprise',
      token_based_billing: true,
      quota_snapshots: { premium_interactions: { ...unlimitedFields, percent_remaining: 100, has_quota: false } },
    }).limits, [{
      id: 'premium_interactions', label: '额度', remainingPercent: null, unlimited: true, exhausted: true, resetsAt: null,
    }]);
  }
  assert.deepEqual(mapCopilotSubscription({
    quota_snapshots: { premium_interactions: { unlimited: true, has_quota: true } },
  }).limits, [{
    id: 'premium_interactions', label: '高级请求', remainingPercent: null, unlimited: true, resetsAt: null,
  }]);
});

test('supports legacy Free monthly quotas without inventing absent readings', () => {
  assert.deepEqual(mapCopilotSubscription({
    access_type_sku: 'free_limited_copilot',
    limited_user_reset_date: '2026-10-01',
    monthly_quotas: { chat: 50, completions: 2000 },
    limited_user_quotas: { chat: 0, completions: null },
  }), {
    planLabel: 'Free',
    limits: [{ id: 'chat', label: '聊天消息', remainingPercent: 0, unlimited: false, resetsAt: 1_790_812_800 }],
  });
});

test('a modern unallocated category overrides a legacy quota', () => {
  assert.deepEqual(mapCopilotSubscription({
    monthly_quotas: { chat: 50 },
    limited_user_quotas: { chat: 25 },
    quota_snapshots: { chat: { entitlement: '0', percent_remaining: 0 } },
  }).limits, []);
});

test('uses the explicit remaining percentage before counts and never derives it from credits_used', () => {
  assert.equal(mapCopilotSubscription({
    quota_snapshots: { premium_interactions: { entitlement: 300, quota_remaining: 150, remaining: 300, percent_remaining: 60, credits_used: 999 } },
  }).limits[0].remainingPercent, 60);
  assert.equal(mapCopilotSubscription({
    quota_snapshots: { premium_interactions: { entitlement: 300, quota_remaining: 150, remaining: 300 } },
  }).limits[0].remainingPercent, 50);
  assert.equal(mapCopilotSubscription({
    quota_snapshots: { premium_interactions: { entitlement: 300, credits_used: 100 } },
  }).limits[0].remainingPercent, null);
});

test('keeps unknown readings unknown, clamps percentages, and ignores invalid timestamps', () => {
  for (const value of [null, undefined, '', ' ', false, [], {}, 'oops', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(mapCopilotSubscription({
      quota_snapshots: { premium_interactions: { entitlement: 300, percent_remaining: value, quota_reset_at: value } },
    }).limits[0].remainingPercent, null);
  }
  for (const [value, expected] of [[-10, 0], [140, 100], [0, 0]] as const) {
    assert.equal(mapCopilotSubscription({
      quota_snapshots: { premium_interactions: { percent_remaining: value } },
    }).limits[0].remainingPercent, expected);
  }
  assert.equal(mapCopilotSubscription({
    quota_reset_date_utc: 'invalid',
    quota_reset_date: '2026-10-01',
    quota_snapshots: { premium_interactions: { percent_remaining: 40, quota_reset_at: -1 } },
  }).limits[0].resetsAt, 1_790_812_800);
});

test('rejects malformed snapshots and does not retain fields outside the subscription contract', () => {
  for (const value of [null, undefined, [], false, 'invalid', 12]) {
    assert.deepEqual(mapCopilotSubscription(value), { planLabel: null, limits: [] });
  }
  assert.deepEqual(mapCopilotSubscription({
    oauth_token: 'must-not-leak',
    quota_snapshots: { chat: [], completions: null, premium_interactions: {} },
  }), { planLabel: null, limits: [] });
});

test('recognizes Student, Pro, Pro+, Max and managed plan identifiers', () => {
  for (const [copilot_plan, expected] of [
    ['individual', 'Pro'], ['individual_edu', 'Student'], ['individual_pro', 'Pro+'],
    ['individual_max', 'Max'], ['business', 'Business'], ['enterprise', 'Enterprise'],
  ]) {
    assert.equal(mapCopilotSubscription({ copilot_plan }).planLabel, expected);
  }
  assert.equal(mapCopilotSubscription({ copilot_plan: 'individual', access_type_sku: 'free_educational_quota' }).planLabel, 'Student');
});
