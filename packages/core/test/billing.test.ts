import test from 'node:test';
import assert from 'node:assert/strict';
import { readBillingReport, discoverBillingOrganizations, normalizeBillingCookie, parseConsoleDetails, usdFromCents } from '../src/quota/billing.js';

test('billing preserves zero and unknown, decimal cents, missing rows and default-workspace scope', () => {
  assert.equal(usdFromCents(0), 0); assert.equal(usdFromCents('12.345'), 0.12345);
  for (const value of [null, undefined, '', 'abc', Infinity]) assert.equal(usdFromCents(value), null);
  const report = parseConsoleDetails({ costs: { '2026-11-01': [{ key_id: 'key-a', model_name: 'sonnet Usage', total: '125.5' }, { key_id: 'key-b', model_name: 'haiku', total: null }] }, web_search_costs: { '2026-11-01': [{ key_id: 'key-a', total: 10 }] } }, '2026-11-01', '2026-12-01', new Map([['key-a', 'Work']]));
  assert.equal(report.totalUsd, 1.355); assert.equal(report.complete, false); assert.equal(report.unknownRows, 1);
  assert.equal(report.rows.find(row => row.model === 'sonnet')?.keyName, 'Work');
  assert.equal(parseConsoleDetails({ costs: {} }, '2026-11-01', '2026-12-01').totalUsd, 0);
  assert.throws(() => parseConsoleDetails({}, '2026-11-01', '2026-12-01'), /BILLING_INVALID_RESPONSE/);
  assert.equal(parseConsoleDetails({ costs: {}, has_more: true }, '2026-11-01', '2026-12-01').complete, false);
});

test('cookie normalization allowlists session cookies and rejects header injection', () => {
  assert.equal(normalizeBillingCookie('synthetic-session'), 'sessionKey=synthetic-session');
  assert.equal(normalizeBillingCookie('other=private; sessionKey=synthetic; cf_clearance=clear'), 'sessionKey=synthetic; cf_clearance=clear');
  for (const value of ['', 'x\r\nCookie: secret', 'sessionKey=x; sessionKey=y', 'other=x', 'x'.repeat(17000)]) assert.throws(() => normalizeBillingCookie(value), /BILLING_COOKIE_INVALID/);
});

test('extra usage endpoints fail independently, reject currency guesses, and retain stale previous values', async () => {
  const calls: string[] = [];
  const fetcher = (async (input, init) => {
    const url = String(input); calls.push(url);
    assert.equal(new Headers(init?.headers).get('Cookie'), 'sessionKey=synthetic');
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
    return url.endsWith('overage_spend_limit') ? Response.json({ is_enabled: true, used_credits: 125, monthly_credit_limit: 500, currency: 'USD' }) : new Response('', { status: 401 });
  }) as typeof fetch;
  const first = await readBillingReport('extra', 'org-1', 'sessionKey=synthetic', { fetch: fetcher, now: new Date('2026-11-06T00:00:00Z') });
  assert.equal(first.spend?.data?.usedUsd, 1.25); assert.equal(first.grants?.data, null); assert.equal(first.grants?.error, 'BILLING_AUTH');
  assert.ok(calls.every(url => url.startsWith('https://claude.ai/api/organizations/org-1/')));
  const failed = await readBillingReport('extra', 'org-1', 'sessionKey=synthetic', { previous: first, fetch: (async () => { throw new Error('must-not-leak-secret'); }) as typeof fetch });
  assert.equal(failed.spend?.data?.usedUsd, 1.25); assert.equal(failed.spend?.stale, true); assert.equal(failed.spend?.observedAt, first.spend?.observedAt);
  assert.ok(!JSON.stringify(failed).includes('must-not-leak-secret'));
  const unsupported = await readBillingReport('extra', 'org-1', 'sessionKey=synthetic', { fetch: (async () => Response.json({ currency: 'EUR', used_credits: 100 })) as typeof fetch });
  assert.equal(unsupported.spend?.error, 'BILLING_CURRENCY');
});

test('Console separates organization spend, prepaid credit and monthly detail with UTC year rollover', async () => {
  const urls: URL[] = [];
  const report = await readBillingReport('console', 'org-2', 'sessionKey=synthetic', { now: new Date('2026-12-31T23:30:00Z'), fetch: (async input => {
    const url = new URL(String(input)); urls.push(url);
    if (url.pathname.endsWith('/current_spend')) return Response.json({ amount: 5025, resets_at: 'invalid' });
    if (url.pathname.endsWith('/prepaid/credits')) return Response.json({ amount: 0, currency: 'USD' });
    if (url.pathname.endsWith('/api_keys')) return Response.json({ data: [{ id: 'k', name: 'Project', secret: 'do-not-return' }] });
    return Response.json({ costs: { '2026-12-01': [{ key_id: 'k', model_name: 'sonnet', total: 250 }] } });
  }) as typeof fetch });
  assert.equal(report.currentSpend?.data?.usd, 50.25); assert.equal(report.currentSpend?.data?.resetsAt, null);
  assert.equal(report.prepaid?.data?.usd, 0); assert.equal(report.details?.data?.totalUsd, 2.5);
  const detail = urls.find(url => url.pathname.endsWith('/usage_cost'))!;
  assert.equal(detail.searchParams.get('starting_on'), '2026-12-01'); assert.equal(detail.searchParams.get('ending_before'), '2027-01-01');
  assert.equal(detail.pathname, '/api/organizations/org-2/workspaces/default/usage_cost');
  assert.ok(!JSON.stringify(report).includes('do-not-return'));
});

test('organization discovery projects safe fields and bounded readers distinguish challenges and invalid JSON', async () => {
  assert.deepEqual(await discoverBillingOrganizations('extra', 'synthetic', (async () => Response.json([{ uuid: 'org-1', name: 'Work', secret: 'never' }])) as typeof fetch), [{ id: 'org-1', name: 'Work' }]);
  for (const [response, code] of [
    [new Response('<html>challenge</html>', { status: 403, headers: { 'cf-mitigated': 'challenge' } }), 'BILLING_CHALLENGE'],
    [new Response('', { status: 429 }), 'BILLING_RATE_LIMIT'],
    [new Response('not-json'), 'BILLING_INVALID_RESPONSE'],
    [new Response('x'.repeat(2 * 1024 * 1024 + 1)), 'BILLING_RESPONSE_TOO_LARGE'],
  ] as const) await assert.rejects(discoverBillingOrganizations('extra', 'synthetic', (async () => response) as typeof fetch), new RegExp(code));
});
