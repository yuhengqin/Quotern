import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMoney } from './format.ts';
test('billing uses shared money precision and distinguishes missing, zero and tiny values', () => {
  assert.equal(formatMoney(null, 'usd', 'en'), '—');
  assert.equal(formatMoney(0, 'usd', 'en'), '$0');
  assert.equal(formatMoney(.001, 'usd', 'en'), '<$0.01');
  assert.equal(formatMoney(1.4221, 'usd', 'en'), '$1.42');
  assert.equal(formatMoney(0, 'cny', 'zh-CN'), '¥0');
  assert.equal(formatMoney(Infinity, 'eur', 'en'), '—');
});
