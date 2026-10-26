import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readOpenAICosts } from '../src/billing/openai-costs.js';
const startTime = 1792800000, endTime = startTime + 86400;
const page = (results: unknown[], more = false, cursor: string | null = null) => ({ object: 'page', data: [{ object: 'bucket', start_time: startTime, end_time: endTime, results }], has_more: more, next_page: cursor });
const amount = (value: number, currency = 'usd') => ({ amount: { value, currency }, project_id: 'proj_fixture', line_item: 'api usage' });
test('official costs pagination retains currency and scope and never reads a balance endpoint', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const result = await readOpenAICosts({ apiKey: 'secret-fixture', projects: ['proj_fixture'], startTime, endTime,
    fetch: async (url, init) => { calls.push({ url, init }); return Response.json(page([amount(calls.length === 1 ? 0 : .06)], calls.length === 1, calls.length === 1 ? 'next' : null)); } });
  assert.equal(result.status, 'ready'); assert.deepEqual(result.totals, [{ currency: 'usd', amount: .06 }]);
  assert.equal(result.balance, null); assert.equal(result.balanceStatus, 'unsupported');
  assert.equal(calls.length, 2); assert.match(calls[1].url, /page=next/); assert.match(calls[0].url, /project_ids/);
  assert.deepEqual(new URL(calls[0].url).searchParams.getAll('group_by[]'), ['project_id', 'line_item']);
  assert.equal(calls[0].init.redirect, 'error'); assert.doesNotMatch(JSON.stringify(result), /secret-fixture/);
});
test('normal token billing line items survive while credential-shaped labels stay hidden', async () => {
  const names = ['gpt-6-astra, input_tokens', 'gpt-6-astra, output_tokens', 'input_tokens', 'sk-fixture-secret', 'Bearer fixture-secret', 'token: fixture-secret'];
  const result = await readOpenAICosts({ apiKey: 'fixture', startTime, endTime, fetch: async () => Response.json(page(names.map(line_item => ({ ...amount(1), line_item })))) });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.rows.map(row => row.lineItem), ['gpt-6-astra, input_tokens', 'gpt-6-astra, output_tokens', 'input_tokens', null, null, null]);
});
test('prefixed credential assignments cannot escape billing label redaction', async () => {
  const names = ['access_token: abc.def.ghi', 'refresh_token: fixture-private', 'client_secret: fixture-private', 'OPENAI_API_KEY: fixture-private', 'id_token: abc.def.ghi'];
  const result = await readOpenAICosts({ apiKey: 'fixture', startTime, endTime, fetch: async () => Response.json(page(names.map(line_item => ({ ...amount(1), line_item })))) });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.rows.map(row => row.lineItem), [null, null, null, null, null]);
});
test('missing amounts and mixed currencies never become a single invented dollar total', async () => {
  const result = await readOpenAICosts({ apiKey: 'x', startTime, endTime, fetch: async () => Response.json(page([amount(1), amount(2, 'eur'), { amount: {} }])) });
  assert.equal(result.status, 'partial'); assert.equal(result.complete, false);
  assert.deepEqual(result.totals, [{ currency: 'eur', amount: 2 }, { currency: 'usd', amount: 1 }]);
  const zero = await readOpenAICosts({ apiKey: 'x', startTime, endTime, fetch: async () => Response.json(page([])) });
  assert.deepEqual(zero.totals, [{ currency: 'usd', amount: 0 }]);
});
test('auth, throttling, malformed pagination and oversized responses are bounded safe failures', async () => {
  for (const status of [401, 403, 429, 500]) {
    const result = await readOpenAICosts({ apiKey: 'secret', startTime, endTime, fetch: async () => new Response('Bearer private@example.com', { status }) });
    assert.equal(result.code, `HTTP_${status}`); assert.equal(result.complete, false); assert.deepEqual(result.totals, []);
    assert.doesNotMatch(JSON.stringify(result), /Bearer|private@example|secret/);
  }
  const repeated = await readOpenAICosts({ apiKey: 'x', startTime, endTime, fetch: async () => Response.json(page([amount(1)], true, 'same')) });
  assert.equal(repeated.complete, false); assert.equal(repeated.code, 'INVALID_RESPONSE');
  assert.equal(repeated.totals[0].amount, 1);
  const huge = await readOpenAICosts({ apiKey: 'x', startTime, endTime, fetch: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) });
  assert.equal(huge.code, 'RESPONSE_LIMIT');
});
test('missing key and invalid project configuration do not send a request', async () => {
  let calls = 0;
  const fetch = async () => { calls++; return Response.json(page([])); };
  assert.equal((await readOpenAICosts({ startTime, endTime, fetch })).status, 'not-configured');
  assert.equal((await readOpenAICosts({ apiKey: 'x', startTime, endTime, projects: ['not-a-project'], fetch })).code, 'INVALID_CONFIGURATION');
  assert.equal(calls, 0);
});
test('a failed later page keeps only the known subtotal and the actual failure code', async () => {
  let calls = 0;
  const result = await readOpenAICosts({ apiKey: 'x', startTime, endTime, fetch: async () => ++calls === 1 ? Response.json(page([amount(1)], true, 'next')) : new Response('private', { status: 429 }) });
  assert.equal(result.status, 'partial'); assert.equal(result.code, 'HTTP_429');
  assert.equal(result.complete, false); assert.deepEqual(result.totals, [{ currency: 'usd', amount: 1 }]);
});
