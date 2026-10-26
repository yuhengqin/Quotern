import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGeminiSubscriptionReader } from '../src/quota/readers/gemini-subscription.js';
import { captureQuotaRead, quotaReadAttempts, quotaReadRetryAfter } from '../src/quota/readers/quota-fetch-state.js';
import { normalizeQuotaSnapshot } from '../src/quota/shared/quota-analysis.js';
import { quotaEvidence } from '../src/quota/readers/quota-identity.js';

const now = 1792800000000;
const settings = JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } });
const credentials = (token = 'fixture-secret', expiry = now + 60000) => JSON.stringify({ access_token: token, expiry_date: expiry, refresh_token: 'never-use-this' });
const bucket = { modelId: 'gemini-fixture-pro', tokenType: 'REQUESTS', remainingFraction: .42, resetTime: new Date(now + 86400000).toISOString() };
function reader(fetch: (url: string, init: RequestInit) => Promise<Response>, options: Record<string, unknown> = {}) {
  return createGeminiSubscriptionReader({ readSettings: async () => settings, readCredentials: async () => credentials(), fetch, now: () => now, ...options });
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test('Gemini queries only loadCodeAssist and retrieveUserQuota and preserves model buckets without guessing cycles', async () => {
  const calls: { url: string; body: any }[] = [];
  const read = reader(async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    assert.equal((init.headers as any).Authorization, 'Bearer fixture-secret');
    return calls.length === 1 ? json({ cloudaicompanionProject: 'fixture-project', currentTier: { name: 'Free' }, paidTier: { name: 'Paid' } })
      : json({ buckets: [bucket, { ...bucket, modelId: 'gemini-fixture-flash', remainingFraction: 0 }, { modelId: 'unknown' }] });
  });
  const result = await captureQuotaRead(() => read({ forceRefresh: true }));
  assert.equal(result.status, 'ready'); assert.equal(result.planLabel, 'Paid');
  assert.deepEqual(calls.map(c => c.url.split(':').at(-1)), ['loadCodeAssist', 'retrieveUserQuota']);
  assert.deepEqual(calls[1].body, { project: 'fixture-project' });
  assert.equal(result.windows.length, 2); assert.equal(result.windows[0].usedPercent, 58.00000000000001);
  assert.equal(result.windows[1].usedPercent, 100);
  const normalized = normalizeQuotaSnapshot('gemini', 'Gemini CLI', result);
  assert.equal(normalized.windows[0].durationSeconds, null); assert.equal(normalized.windows[0].periodSeconds, null);
  assert.equal(normalized.windows[0].analysisEligible, false);
  assert.equal(quotaEvidence(result)?.identityVerified, false);
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|never-use-this|fixture-project/);
});

test('Gemini accepts commented CLI settings while preserving comment markers inside strings', async () => {
  const commented = `{
    // Existing Gemini CLI settings allow comments.
    "security": { "auth": { /* selected Google login */ "selectedType": "oauth-personal" } },
    "unused": "https://example.test/path/*literal*/?quoted=\\\"//literal\\\""
  }`;
  let calls = 0, reads = 0;
  const result = await reader(async url => { calls++; return url.endsWith('loadCodeAssist') ? json({ cloudaicompanionProject: 'fixture-project' }) : json({ buckets: [bucket] }); },
    { readSettings: async () => commented, readCredentials: async () => { reads++; return credentials(); } })();
  assert.equal(result.status, 'ready'); assert.equal(result.windows[0].usedPercent, 58.00000000000001);
  assert.equal(calls, 2); assert.equal(reads, 1);
});

test('Gemini still rejects malformed comments or strings before reading credentials', async () => {
  for (const raw of ['{/* unterminated', '{"security":"unterminated // comment}', '{"security":1/*comment*/2}']) {
    let reads = 0;
    const result = await captureQuotaRead(() => reader(async () => { throw new Error('no network'); },
      { readSettings: async () => raw, readCredentials: async () => { reads++; return credentials(); } })());
    assert.equal(result.status, 'access-denied'); assert.equal(reads, 0);
    assert.equal(quotaReadAttempts(result)[0].code, 'INVALID_CREDENTIALS');
  }
});

test('Gemini rejects expired, malformed, missing and unsupported credentials without network or token refresh', async () => {
  for (const options of [
    { readCredentials: async () => credentials('token', now - 1) },
    { readCredentials: async () => '{bad' },
    { readCredentials: async () => JSON.stringify({ access_token: 'token' }) },
    { readSettings: async () => '{}' },
    { readSettings: async () => JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } } }) },
    { encryptedStorage: true },
  ]) {
    let calls = 0;
    const result = await captureQuotaRead(() => reader(async () => { calls++; return json({}); }, options)());
    assert.notEqual(result.status, 'ready'); assert.equal(calls, 0);
    assert.equal(result.windows.length, 0); assert.ok(quotaReadAttempts(result).some(a => a.code));
  }
});

test('Gemini missing project, malformed fractions and failed HTTP never become exhausted quota', async () => {
  for (const status of [401, 403, 429, 500]) {
    const result = await captureQuotaRead(() => reader(async () => new Response('secret body', { status, headers: { 'retry-after': '120' } }))());
    assert.equal(result.windows.length, 0); assert.notEqual(result.status, 'ready');
    assert.equal(quotaReadAttempts(result)[1].httpStatus, status);
    if (status === 429) assert.equal(quotaReadRetryAfter(result), 120);
  }
  const noProject = await captureQuotaRead(() => reader(async () => json({ currentTier: { name: 'Free' } }))());
  assert.equal(quotaReadAttempts(noProject).at(-1)?.code, 'MISSING_PROJECT');
  let calls = 0;
  const malformed = await reader(async () => ++calls === 1 ? json({ cloudaicompanionProject: 'fixture-project' }) : json({ buckets: [null, {}, { ...bucket, remainingFraction: null }, { ...bucket, remainingFraction: '0' }, { ...bucket, remainingFraction: 2 }] }))();
  assert.notEqual(malformed.status, 'ready'); assert.deepEqual(malformed.windows, []);
});

test('Gemini same credential failure retains stale windows, but changed credentials cannot inherit them', async () => {
  let token = 'first', failing = false;
  const read = reader(async url => failing ? json({}, 503) : url.endsWith('loadCodeAssist') ? json({ cloudaicompanionProject: 'fixture-project' }) : json({ buckets: [bucket] }),
    { readCredentials: async () => credentials(token) });
  assert.equal((await read({ forceRefresh: true })).status, 'ready');
  failing = true;
  assert.equal((await read({ forceRefresh: true })).stale, true);
  token = 'second';
  const changed = await read({ forceRefresh: true });
  assert.equal(changed.windows.length, 0); assert.equal(changed.stale, false);
});

test('Gemini uses the configured project only for an already initialized currentTier', async () => {
  for (const initialized of [true, false]) {
    const calls: any[] = [];
    const result = await reader(async (url, init) => {
      calls.push(JSON.parse(String(init.body)));
      return url.endsWith('loadCodeAssist') ? json(initialized ? { currentTier: { id: 'standard-tier' } } : {}) : json({ buckets: [bucket] });
    }, { project: 'configured-project' })();
    assert.equal(result.status === 'ready', initialized);
    assert.equal(calls.length, initialized ? 2 : 1);
    if (initialized) assert.deepEqual(calls[1], { project: 'configured-project' });
  }
});

test('Gemini classifies timeout and bounded malformed response without leaking payloads', async () => {
  const timed = await captureQuotaRead(() => reader(async () => { throw new DOMException('private URL', 'TimeoutError'); })());
  assert.equal(quotaReadAttempts(timed).at(-1)?.code, 'TIMEOUT');
  const huge = await captureQuotaRead(() => reader(async () => new Response('x'.repeat(1024 * 1024 + 1)))());
  assert.equal(quotaReadAttempts(huge).at(-1)?.code, 'INVALID_RESPONSE');
  assert.equal(huge.windows.length, 0);
});
