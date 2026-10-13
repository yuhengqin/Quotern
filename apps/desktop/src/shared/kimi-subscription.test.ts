import assert from 'node:assert/strict';
import test from 'node:test';
import { kimiRemainingPercent, mapKimiCodePlan, mapKimiDesktopSubscription, mapKimiUsage } from './kimi-subscription';

test('reads Code plan names without guessing from numeric membership levels', () => {
  for (const name of ['Free', 'Go', 'Plus', 'Pro', 'Max', 'Kimi Future']) {
    assert.equal(mapKimiCodePlan({ user_id: 'code-user', user_level_name: name, user_level: 20 }), name);
  }
  assert.equal(mapKimiCodePlan({ data: { user_level_name: ' plus ' } }), 'Plus');
  for (const value of [null, {}, { user_level: 20 }, { user_level_name: '' }, { user_level_name: 20 }]) {
    assert.equal(mapKimiCodePlan(value), null);
  }
});

test('keeps monthly shared total separate from its Code usage contribution', () => {
  const limits = mapKimiUsage({ usages: {
    limit_5h: { used_ratio: 0.25 },
    limit_7d: { used_ratio: 0.6 },
    limit_month_total: { used_ratio: 0.7, reset_time: '2030-01-01T00:00:00Z' },
    limit_month_code: { used_ratio: 0.4 },
  } });
  assert.deepEqual(limits.map(({ id, usedPercent }) => [id, usedPercent]), [
    ['limit_5h', 25], ['limit_7d', 60], ['limit_month_total', 70],
  ]);
  assert.equal(limits[2].label, '月度共享额度');
  assert.equal(limits[2].resetsAt, 1_893_456_000);
  assert.deepEqual(mapKimiUsage({ usages: { limit_month_code: { used_ratio: 0.4 } } }), []);
  assert.deepEqual(mapKimiUsage({ usages: { limit_month_total: { used_ratio: null } } }), []);
  assert.equal(mapKimiUsage({ usages: { limit_month_total: { used_ratio: 0 } } })[0].usedPercent, 0);
});

test('maps Kimi Code summary and rolling limits to compact windows', () => {
  const limits = mapKimiUsage({
    usage: { used: '20', limit: '100', resetTime: '2030-01-01T00:00:00Z' },
    limits: [
      {
        window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
        detail: { used: '30', limit: '120', resetTime: '2030-01-02T00:00:00Z' },
      },
    ],
  });

  assert.deepEqual(limits.map((limit) => [limit.label, limit.usedPercent]), [
    ['5h', 25],
    ['7d', 20],
  ]);
});

test('clamps Kimi remaining percentage', () => {
  assert.equal(kimiRemainingPercent(0), 100);
  assert.equal(kimiRemainingPercent(82.5), 17.5);
  assert.equal(kimiRemainingPercent(120), 0);
});

test('maps current Kimi Code ratio quotas without inventing missing windows', () => {
  const limits = mapKimiUsage({ usages: {
    limit_5h: { used_ratio: 0.25, reset_time: '2030-01-01T00:00:00Z' },
    limit_7d: { used_ratio: '0.6' },
  } });
  assert.deepEqual(limits.map(({ label, usedPercent }) => [label, usedPercent]), [
    ['5h', 25], ['7d', 60],
  ]);
  assert.equal(limits[0].resetsAt, 1_893_456_000);
  assert.equal(limits[1].resetsAt, null);
});

test('does not report unknown Kimi quota as unused', () => {
  assert.deepEqual(mapKimiUsage({ usages: {
    limit_5h: { used_ratio: null }, limit_7d: { used_ratio: '' },
  } }), []);
  assert.deepEqual(mapKimiUsage({ usage: { used: null, limit: 100 } }), []);
});

test('maps desktop Free membership and its actual shared allowance', () => {
  const result = mapKimiDesktopSubscription({
    subscription: { goods: { title: 'Free', membershipLevel: 'LEVEL_FREE' } },
    balances: [{
      feature: 'FEATURE_OMNI', type: 'SUBSCRIPTION', unit: 'UNIT_CREDIT',
      amountUsedRatio: 0.0923, expireTime: '2026-10-07T00:00:00Z',
    }],
  });
  assert.equal(result.planLabel, 'Free');
  assert.equal(result.limits.length, 1);
  assert.equal(result.limits[0].label, '订阅额度');
  assert.ok(Math.abs(result.limits[0].usedPercent - 9.23) < 1e-10);
  assert.equal(result.limits[0].resetsAt, Date.parse('2026-10-07T00:00:00Z') / 1000);
});

for (const [title, membershipLevel, numericLevel] of [
  ['Go', 'LEVEL_TRIAL', 15],
  ['Plus', 'LEVEL_BASIC', 20],
  ['Pro', 'LEVEL_INTERMEDIATE', 25],
  ['Max', 'LEVEL_ADVANCED', 27],
] as const) {
  test(`maps desktop ${title} membership with shared quota or a plan-only response`, () => {
    for (const level of [membershipLevel, numericLevel]) {
      const subscription = { goods: { title, membershipLevel: level, domain: 'DOMAIN_NEXUS' } };
      assert.deepEqual(mapKimiDesktopSubscription({
        subscription,
        balances: [{
          feature: 'FEATURE_OMNI', type: 'SUBSCRIPTION',
          amountUsedRatio: 0.375, expireTime: '2030-01-01T00:00:00Z',
        }],
      }), {
        planLabel: title,
        limits: [{ id: 'subscription', label: '订阅额度', usedPercent: 37.5, resetsAt: 1_893_456_000 }],
      });
      assert.deepEqual(mapKimiDesktopSubscription({ subscription, balances: [] }), {
        planLabel: title, limits: [],
      });
    }
  });
}

test('preserves an unknown desktop plan title without guessing its level or quota', () => {
  const subscription = { goods: { title: 'Kimi Future', membershipLevel: 'LEVEL_FUTURE', domain: 'DOMAIN_NEXUS' } };
  assert.deepEqual(mapKimiDesktopSubscription({ subscription, balances: [] }), {
    planLabel: 'Kimi Future', limits: [],
  });
  assert.deepEqual(mapKimiDesktopSubscription({
    subscription,
    balances: [{ feature: 'FEATURE_OMNI', type: 'SUBSCRIPTION', amountUsedRatio: 0.25 }],
  }), {
    planLabel: 'Kimi Future',
    limits: [{ id: 'subscription', label: '订阅额度', usedPercent: 25, resetsAt: null }],
  });
});

test('keeps desktop plan-only accounts without inventing quota or Free membership', () => {
  assert.equal(mapKimiDesktopSubscription({
    subscription: { goods: { title: 'Adagio', membershipLevel: 'LEVEL_FREE' } },
  }).planLabel, 'Free');
  assert.deepEqual(mapKimiDesktopSubscription({
    subscription: { goods: { title: 'Free' } }, balances: [],
  }), { planLabel: 'Free', limits: [] });
  assert.deepEqual(mapKimiDesktopSubscription({
    subscription: { goods: { membershipLevel: 0 } },
    balances: [{ feature: 'FEATURE_OMNI', type: 'SUBSCRIPTION', amountUsedRatio: null }],
  }), { planLabel: null, limits: [] });
  assert.deepEqual(mapKimiDesktopSubscription(null), { planLabel: null, limits: [] });
});

test('accepts protobuf snake case and numeric enums while excluding other balances', () => {
  const result = mapKimiDesktopSubscription({
    subscription: { goods: { title: 'Go' } },
    balances: [
      { feature: 'FEATURE_OMNI', type: 'BOOSTER', amountUsedRatio: 0.9 },
      { feature: 'FEATURE_KIMI_CODE', type: 'SUBSCRIPTION', amountUsedRatio: 0.7 },
      { feature: 100, type: 1, amount_used_ratio: '0.5', expire_time: '2030-01-01T00:00:00Z' },
    ],
  });
  assert.equal(result.planLabel, 'Go');
  assert.equal(result.limits.length, 1);
  assert.equal(result.limits[0].usedPercent, 50);
});

test('handles protobuf zero-default ratios only on a real desktop subscription balance', () => {
  const balance = { feature: 'FEATURE_OMNI', type: 'SUBSCRIPTION' };
  assert.equal(mapKimiDesktopSubscription({ balances: [balance] }).limits[0]?.usedPercent, 0);
  for (const amountUsedRatio of [null, '', 'invalid', Infinity]) {
    assert.deepEqual(mapKimiDesktopSubscription({ balances: [{ ...balance, amountUsedRatio }] }).limits, []);
  }
});
