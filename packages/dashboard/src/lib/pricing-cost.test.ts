import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as display from './pricing-display.ts';
import { formatContextWindow } from './pricing-filters.ts';
import { formatAchievementAmount } from '../achievements/view-model.ts';

test('scenario totals and differences use cost precision after currency conversion', () => {
  const cost = (display as any).formatPricingCost;
  assert.equal(typeof cost, 'function');
  assert.equal(cost(30.268, 'CNY', 7.2, 'en'), '¥217.93');
  assert.equal(cost(0.0001, 'CNY', 7.2, 'en'), '<¥0.01');
  assert.equal(cost(-0.0001, 'USD', null, 'en'), '>-$0.01');
  assert.equal(cost(0, 'USD', null, 'en'), '$0');
  assert.equal(cost(1, 'CNY', null, 'en'), '—');
  assert.equal(cost(null, 'USD', null, 'en'), '—');
  assert.equal(cost(Infinity, 'USD', null, 'en'), '—');
  assert.equal(cost(1.4, 'USD', null, 'en'), '$1.4');
});

test('pricing context, usage and achievement amounts respect saved Token units', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let mode = 'international';
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => mode } });
  try {
    assert.equal(formatContextWindow(1_048_576, 'zh-CN'), '1M');
    assert.equal(display.formatPricingTokens(187_200_000, 'zh-CN'), '187.2M');
    assert.equal(formatAchievementAmount(187_200_000, 'tokens', 'zh-CN'), '187.2M');
    mode = 'localized';
    assert.equal(formatContextWindow(1_048_576, 'zh-CN'), '104.9万');
    assert.equal(formatAchievementAmount(187_200_000, 'tokens', 'zh-CN'), '1.872亿');
    assert.equal(formatContextWindow(undefined), '—');
    assert.equal(formatAchievementAmount(0.001, 'cost', 'zh-CN'), '<$0.01');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
