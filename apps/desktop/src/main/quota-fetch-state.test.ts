import assert from 'node:assert/strict';
import test from 'node:test';
import { captureQuotaRead, observeQuotaResponse, quotaReadRetryAfter } from './quota-fetch-state';

test('Retry-After travels through a provider stale fallback without exposing request metadata', async () => {
  const snapshot = await captureQuotaRead(async () => {
    observeQuotaResponse(new Response('', { status: 429, headers: { 'retry-after': '600' } }));
    return { status: 'ready', stale: true };
  });
  assert.equal(quotaReadRetryAfter(snapshot), 600);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), { status: 'ready', stale: true });
});
test('parallel provider reads keep independent cooldown metadata', async () => {
  const [a, b] = await Promise.all([captureQuotaRead(async () => { observeQuotaResponse(new Response('', { status: 503, headers: { 'retry-after': '99999' } })); await Promise.resolve(); return {}; }), captureQuotaRead(async () => ({}))]);
  assert.equal(quotaReadRetryAfter(a), 3600);
  assert.equal(quotaReadRetryAfter(b), null);
});
