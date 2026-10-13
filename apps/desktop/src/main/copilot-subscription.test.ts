import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  createCopilotSubscriptionReader,
  fetchCopilotSubscription,
  parseCopilotCredentials,
  readCopilotVscodeUser,
  type CopilotCredentials,
} from './copilot-subscription';

const credentials: CopilotCredentials = { user: 'alice', tokens: ['oauth-alice'] };
function quotaResponse(remaining = 97) {
  return new Response(JSON.stringify({
    copilot_plan: 'individual', access_type_sku: 'free_limited_copilot', token_based_billing: true,
    quota_reset_date_utc: '2026-10-01T00:00:00Z',
    quota_snapshots: { chat: { percent_remaining: remaining, entitlement: 200, unlimited: false } },
  }));
}

test('selects the VS Code account and excludes unrelated GitHub hosts and credentials', () => {
  const values = [{
    'github.com:one': { user: 'bob', oauth_token: 'oauth-bob' },
    'github.com:two': { user: 'Alice', oauth_token: 'oauth-alice' },
    'github.com:three': { user: 'alice', oauth_token: 'oauth-alice' },
    'github.com.evil:one': { user: 'alice', oauth_token: 'do-not-use' },
    'github.enterprise.com': { user: 'alice', oauth_token: 'enterprise-token' },
    'github.com:pat': { user: 'alice', token: 'not-a-copilot-session' },
  }];
  assert.deepEqual(parseCopilotCredentials(values, 'ALICE'), credentials);
  assert.equal(parseCopilotCredentials(values, null), null);
  assert.equal(parseCopilotCredentials(values, 'unknown'), null);
  assert.deepEqual(parseCopilotCredentials([{ 'github.com': { user: 'alice', oauth_token: 'oauth-alice' } }], null), credentials);
  assert.equal(parseCopilotCredentials([null, [], { 'github.com': { user: 'alice', oauth_token: '\r\ninjected' } }], null), null);
});

test('reads only the Copilot account hint from a read-only VS Code database', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'copilot-account-'));
  try {
    const filename = path.join(directory, 'state.vscdb');
    const database = new DatabaseSync(filename);
    database.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');
    database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('github.copilot-github', 'alice');
    database.close();
    assert.equal(readCopilotVscodeUser(filename), 'alice');
    assert.equal(readCopilotVscodeUser(path.join(directory, 'missing.vscdb')), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('requests the fixed GitHub endpoint and returns only normalized quota data', async () => {
  const snapshot = await fetchCopilotSubscription(credentials, async (url, init) => {
    assert.equal(url, 'https://api.github.com/copilot_internal/user');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer oauth-alice');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    return quotaResponse();
  });
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.planLabel, 'Free');
  assert.equal(snapshot.limits[0]?.remainingPercent, 97);
  assert.equal(JSON.stringify(snapshot).includes('oauth-alice'), false);
});

test('tries another session only for the same selected account after auth failure', async () => {
  let requests = 0;
  const snapshot = await fetchCopilotSubscription({ user: 'alice', tokens: ['old-token', 'new-token'] }, async () => {
    requests++;
    return requests === 1 ? new Response(null, { status: 401 }) : quotaResponse();
  });
  assert.equal(snapshot.status, 'ready');
  assert.equal(requests, 2);
  const expired = await fetchCopilotSubscription(credentials, async () => new Response(null, { status: 403 }));
  assert.equal(expired.status, 'not-signed-in');
  assert.deepEqual(expired.limits, []);
});

test('rejects a successful response with no actual allowance reading', async () => {
  await assert.rejects(fetchCopilotSubscription(credentials, async () => new Response(JSON.stringify({
    quota_snapshots: { premium_interactions: { entitlement: 300 } },
  }))), /no supported allowance/);
});

test('caches successful requests, marks network failures stale, and clears expired sessions', async () => {
  let requests = 0;
  let status = 200;
  const read = createCopilotSubscriptionReader(async () => credentials, async () => {
    requests++;
    return status === 200 ? quotaResponse() : new Response(null, { status });
  });
  await read();
  await read();
  assert.equal(requests, 1);
  status = 429;
  assert.equal((await read({ forceRefresh: true })).stale, true);
  status = 401;
  assert.equal((await read({ forceRefresh: true })).status, 'not-signed-in');
  status = 500;
  assert.equal((await read()).status, 'temporarily-unavailable');
  assert.equal((await read()).stale, false);
});

test('never reuses cached quota after the account changes or signs out', async () => {
  let active: CopilotCredentials | null = credentials;
  let fail = false;
  const read = createCopilotSubscriptionReader(async () => active, async () => {
    if (fail) throw new Error('offline');
    return quotaResponse();
  });
  assert.equal((await read()).status, 'ready');
  active = { user: 'bob', tokens: ['oauth-bob'] };
  fail = true;
  assert.equal((await read()).status, 'temporarily-unavailable');
  active = null;
  assert.equal((await read()).status, 'not-signed-in');
  active = credentials;
  assert.equal((await read()).status, 'temporarily-unavailable');
});

test('coalesces simultaneous quota requests for one session', async () => {
  let requests = 0;
  let finish!: (response: Response) => void;
  const read = createCopilotSubscriptionReader(async () => credentials, async () => {
    requests++;
    return new Promise<Response>((resolve) => { finish = resolve; });
  });
  const first = read();
  const second = read();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(requests, 1);
  finish(quotaResponse());
  assert.deepEqual(await first, await second);
});

test('discards a previous account response that completes after an account switch', async () => {
  let active = credentials;
  let finishAlice!: (response: Response) => void;
  const read = createCopilotSubscriptionReader(async () => active, async (_url, init) => {
    if (new Headers(init?.headers).get('Authorization') === 'Bearer oauth-alice') {
      return new Promise<Response>((resolve) => { finishAlice = resolve; });
    }
    return quotaResponse(42);
  });
  const alice = read();
  await new Promise<void>((resolve) => setImmediate(resolve));
  active = { user: 'bob', tokens: ['oauth-bob'] };
  assert.equal((await read()).limits[0]?.remainingPercent, 42);
  finishAlice(quotaResponse(97));
  assert.equal((await alice).status, 'temporarily-unavailable');
  assert.equal((await read()).limits[0]?.remainingPercent, 42);
});
