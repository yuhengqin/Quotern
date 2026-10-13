import assert from 'node:assert/strict';
import test from 'node:test';
import { deepSeekRemainingPercent, mapDeepSeekBalance } from './deepseek-subscription';

test('maps a DeepSeek balance_infos payload into a single CNY balance window', () => {
  const result = mapDeepSeekBalance({
    balance_infos: [
      { currency: 'CNY', total_balance: '12.50', granted_balance: '10.00', topped_up_balance: '2.50' },
    ],
    is_available: true,
  });
  assert.equal(result.planLabel, null);
  assert.equal(result.limits.length, 1);
  const [window] = result.limits;
  assert.equal(window?.id, 'balance-cny');
  assert.equal(window?.label, 'CNY 余额');
  assert.equal(window?.remaining, 12.5);
  assert.equal(window?.total, 12.5);
  assert.equal(window?.usedPercent, 0);
  assert.equal(window?.description, '余额 ¥12.50 / ¥12.50');
});

test('computes the used percentage from granted + topped-up when total is missing', () => {
  const result = mapDeepSeekBalance({
    granted_balance: 30,
    topped_up_balance: 20,
  });
  const [window] = result.limits;
  assert.equal(window?.total, 50);
  assert.equal(window?.remaining, 50);
  assert.equal(window?.usedPercent, 0);
  assert.equal(window?.description, '余额 ¥50.00 / ¥50.00');
});

test('returns zero-window snapshot when the DeepSeek payload is missing or malformed', () => {
  assert.deepEqual(mapDeepSeekBalance(null), { planLabel: null, limits: [] });
  assert.deepEqual(mapDeepSeekBalance({ balance_infos: 'oops' }), { planLabel: null, limits: [] });
});

test('clamps DeepSeek remaining percentage to [0, 100]', () => {
  assert.equal(deepSeekRemainingPercent(0), 100);
  assert.equal(deepSeekRemainingPercent(40), 60);
  assert.equal(deepSeekRemainingPercent(120), 0);
  assert.equal(deepSeekRemainingPercent(Number.NaN), 0);
});
