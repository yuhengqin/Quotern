import assert from 'node:assert/strict';
import test from 'node:test';
import { mapMiniMaxOfficialQuota, officialProviders, readOfficialProvider } from './official-providers.js';

test('DeepSeek requires an explicit key and never requests a page-only provider', async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected request'); };
  try {
    assert.equal((await readOfficialProvider('deepseek') as { status: string }).status, 'not-signed-in');
    assert.equal((await readOfficialProvider('cursor') as { status: string }).status, 'unsupported-account');
    assert.equal(calls, 0);
  } finally { globalThis.fetch = old; }
});

test('DeepSeek preserves currencies and uses only the fixed official endpoint', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(input, 'https://api.deepseek.com/user/balance');
    assert.equal(init?.redirect, 'error');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer synthetic-key');
    assert.ok(init?.signal);
    return Response.json({ is_available: true, balance_infos: [
      { currency: 'CNY', total_balance: '12.50', granted_balance: '2.50', topped_up_balance: '10.00' },
      { currency: 'USD', total_balance: '3.25', granted_balance: '0.25', topped_up_balance: '3.00' },
    ] });
  };
  try {
    const result = await readOfficialProvider('deepseek', 'synthetic-key') as { status: string; limits: Array<{currency: string; remaining: number}> };
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.limits.map(({currency, remaining}) => ({currency, remaining})), [{currency:'CNY',remaining:12.5},{currency:'USD',remaining:3.25}]);
  } finally { globalThis.fetch = old; }
});

test('DeepSeek rejects unsuccessful and malformed responses', async () => {
  const old = globalThis.fetch;
  try {
    for (const response of [new Response('', {status: 401}), Response.json({is_available: true, balance_infos: [{currency:'USD',total_balance:'bad'}]}), Response.json({is_available: true, balance_infos: []})]) {
      globalThis.fetch = async () => response;
      assert.notEqual((await readOfficialProvider('deepseek', 'synthetic-key') as {status:string}).status, 'ready');
    }
  } finally { globalThis.fetch = old; }
});

test('MiniMax projects only valid documented remaining percentages', () => {
  const result = mapMiniMaxOfficialQuota({base_resp:{status_code:0},model_remains:[{model_name:'general',current_interval_remaining_percent:70,current_weekly_remaining_percent:40}, {model_name:'video',current_interval_remaining_percent:101}]});
  assert.deepEqual(result.limits, [{id:'general-interval',label:'general',remainingPercent:70,resetsAt:null}, {id:'general-weekly',label:'general',remainingPercent:40,resetsAt:null}]);
  assert.equal(mapMiniMaxOfficialQuota({available_amount:'4.2'}).status, 'unsupported-account');
  assert.notEqual(mapMiniMaxOfficialQuota({model_remains:'bad'}).status, 'ready');
});

test('provider destinations include API guides and official usage pages', () => {
  assert.equal(officialProviders.deepseek.destination, 'guide');
  assert.equal(officialProviders.minimax.method, 'official-cli');
  assert.equal(officialProviders.codex.destination, 'usage');
});
