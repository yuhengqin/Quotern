import assert from 'node:assert/strict';
import test from 'node:test';
import { readKimiOfficial } from './kimi-official';

const ok = (usages: unknown, extraUsage: unknown = null) => ({ code: 0, data: { kind: 'ok', quota: { usages, extraUsage } } });
const reply = (body: unknown, status = 200): typeof fetch => async () => new Response(JSON.stringify(body), { status });

test('uses only the fixed authenticated GET and maps official windows', async () => {
  let calls = 0;
  const request: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:58627/api/v1/oauth/usage');
    assert.equal(options?.method, 'GET');
    assert.deepEqual(options?.headers, { Authorization: 'Bearer secret-token' });
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal instanceof AbortSignal);
    return new Response(JSON.stringify(ok({
      limit5h: { usedRatio: 0.25, resetAt: '2026-11-21T08:00:00Z' },
      limit7d: { usedRatio: 1, resetAt: '2026-11-22T08:00:00+08:00' },
      monthTotal: { usedRatio: 0, resetAt: null },
      monthCode: { usedRatio: 0.4 },
    })));
  };
  const result = await readKimiOfficial('secret-token', request);
  assert.equal(calls, 1);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.limits, [
    { id: 'limit5h', label: '5h', usedPercent: 25, resetsAt: Date.parse('2026-11-21T08:00:00Z') / 1000 },
    { id: 'limit7d', label: '7d', usedPercent: 100, resetsAt: Date.parse('2026-11-22T00:00:00Z') / 1000 },
    { id: 'monthTotal', label: '月度共享额度', usedPercent: 0, resetsAt: null },
    { id: 'monthCode', label: '月度代码额度', usedPercent: 40, resetsAt: null },
  ]);
  assert.equal(JSON.stringify(result).includes('secret-token'), false);
});

test('does not request without a token and marks authorization failures expired', async () => {
  const never: typeof fetch = async () => { throw new Error('unexpected request'); };
  assert.equal((await readKimiOfficial('  ', never)).status, 'not-signed-in');
  for (const status of [401, 403]) {
    assert.equal((await readKimiOfficial('secret-token', reply({ message: 'secret-token' }, status))).status, 'expired');
    assert.equal((await readKimiOfficial('secret-token', reply({ code: 0, data: { kind: 'error', status, message: 'secret-token' } }))).status, 'expired');
  }
});

test('preserves nullable windows and wallet amounts without inventing percentages', async () => {
  for (const currency of ['USD', 'CNY']) {
    const result = await readKimiOfficial('token', reply(ok({ limit5h: null }, { currency, balanceCents: 1234 })));
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.limits, [{ id: `balance-${currency.toLowerCase()}`, label: `${currency} 余额`, currency, remaining: 12.34, resetsAt: null }]);
  }
  const noWallet = await readKimiOfficial('token', reply(ok({ limit5h: { usedRatio: 0, resetAt: '2026-02-30T00:00:00Z' } }, null)));
  assert.deepEqual(noWallet.limits, [{ id: 'limit5h', label: '5h', usedPercent: 0, resetsAt: null }]);
});

test('rejects malformed or failed responses without exposing remote text or token', async () => {
  const fixtures = [
    { code: 1, data: { kind: 'error', message: 'secret-token' } },
    { code: 0, data: { kind: 'error', message: 'secret-token' } },
    ok({ limit5h: { usedRatio: -0.1 } }), ok({ limit7d: { usedRatio: 1.1 } }),
    ok({ monthCode: { usedRatio: '0.5' } }), ok({}, { currency: 'EUR', balanceCents: 10 }),
    ok({}, { currency: 'USD', balanceCents: -1 }), ok({}),
  ];
  for (const fixture of fixtures) {
    const result = await readKimiOfficial('secret-token', reply(fixture));
    assert.equal(result.status, 'temporarily-unavailable');
    assert.equal(JSON.stringify(result).includes('secret-token'), false);
  }
  const thrown: typeof fetch = async () => { throw new Error('secret-token'); };
  assert.equal(JSON.stringify(await readKimiOfficial('secret-token', thrown)).includes('secret-token'), false);
  assert.equal((await readKimiOfficial('secret-token', reply({}, 500))).status, 'temporarily-unavailable');
});
