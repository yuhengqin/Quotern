import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodexSubscriptionReader } from '../src/quota/readers/codex-subscription.js';
import { normalizeQuotaSnapshot } from '../src/quota/shared/quota-analysis.js';

const now = Date.parse('2026-11-10T01:00:00Z');
const auth = JSON.stringify({ tokens: { access_token: 'fixture-token', account_id: 'account-a' } });
const usage = (count: number) => Response.json({ rate_limit: { primary_window: { used_percent: 22, limit_window_seconds: 18000 } }, rate_limit_reset_credits: { available_count: count } });

test('Codex reads account-scoped reset expiry, omitting expired, used and invalid credits', async () => {
  const urls: string[] = [];
  const read = createCodexSubscriptionReader({ readAuth: async () => auth, now: () => now, fetch: async (url, init) => {
    urls.push(url);
    assert.equal(new Headers(init.headers).get('ChatGPT-Account-Id'), 'account-a');
    if (url.endsWith('/usage')) return usage(2);
    return Response.json({ credits: [
      { id: 'later', status: 'available', expires_at: '2026-11-12T01:00:00Z' },
      { id: 'spent', status: 'used', expires_at: '2026-11-11T01:00:00Z' },
      { id: 'earlier', status: 'available', expires_at: '2026-11-11T01:00:00.100Z' },
      { id: 'expired', status: 'available', expires_at: '2026-11-09T01:00:00Z' },
      { id: 'bad', status: 'available', expires_at: 'someday' },
    ] });
  } });
  const snapshot = await read();
  assert.equal(urls[1]?.split('/').at(-1), 'rate-limit-reset-credits');
  assert.equal(normalizeQuotaSnapshot('codex', 'Codex', snapshot).resetCredits, 2);
  assert.deepEqual(Reflect.get(normalizeQuotaSnapshot('codex', 'Codex', snapshot), 'resetCreditExpirations'), [Date.parse('2026-11-11T01:00:00.100Z') / 1000, Date.parse('2026-11-12T01:00:00Z') / 1000]);
});

test('Codex detail failures do not invalidate the quota or count, and cooldown is scoped to the account', async () => {
  let attempts = 0;
  let account = 'account-a';
  const read = createCodexSubscriptionReader({ readAuth: async () => JSON.stringify({ tokens: { access_token: 'fixture-token', account_id: account } }), now: () => now, fetch: async url => {
    if (url.endsWith('/usage')) return usage(1);
    attempts++;
    return new Response('{}', { status: 429, headers: { 'Retry-After': '60' } });
  } });
  const snapshot = await read();
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.resetCredits, 1);
  assert.equal(Reflect.get(snapshot, 'resetCreditExpirations'), null);
  await read({ forceRefresh: true });
  assert.equal(attempts, 1);
  account = 'account-b';
  await read({ forceRefresh: true });
  assert.equal(attempts, 2);
});
