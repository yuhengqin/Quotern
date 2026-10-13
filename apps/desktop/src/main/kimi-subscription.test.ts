import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { KimiDesktopContext } from './kimi-desktop-context';
import {
  createKimiSubscriptionReader,
  createKimiSubscriptionsReader,
  hasCustomKimiConfiguration,
  kimiDesktopPlatform,
  loadKimiAccount,
  parseKimiCredentials,
  parseKimiDesktopToken,
  type KimiAccount,
} from './kimi-subscription';

function jwt(claims: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
}

const desktopAccount: KimiAccount = {
  source: 'desktop', userId: 'alice', accessToken: 'desktop-alice',
  expiresAt: Date.now() + 3_600_000, origin: 'https://www.kimi.com', planLabel: 'Free',
};
const codeAccount: KimiAccount = {
  ...desktopAccount, source: 'code', userId: 'code-user', accessToken: 'code-token',
  origin: 'https://api.kimi.com/coding/v1', planLabel: null,
};

function codeUsageResponse(used = 25): Response {
  return new Response(JSON.stringify({ usage: { used, limit: 100 } }));
}

function codePlanResponse(plan = 'Pro'): Response {
  return new Response(JSON.stringify({ user_id: 'code-user', user_level_name: plan }));
}

function subscriptionResponse(
  ratio = 0.0923,
  withQuota = true,
  goods: { title: string; membershipLevel: string | number; domain?: string } = { title: 'Free', membershipLevel: 'LEVEL_FREE' },
): Response {
  return new Response(JSON.stringify({
    subscription: { goods, status: 'SUBSCRIPTION_STATUS_ACTIVE' },
    balances: withQuota ? [{ feature: 'FEATURE_OMNI', type: 'SUBSCRIPTION', unit: 'UNIT_CREDIT', amountUsedRatio: ratio, expireTime: '2026-10-07T00:00:00Z' }] : [],
  }));
}

test('parses only the Kimi Code OAuth fields needed for quota', () => {
  assert.deepEqual(parseKimiCredentials({
    access_token: 'access-token',
    refresh_token: 'must-not-be-exposed',
    expires_at: 1_900_000_000,
  }), {
    accessToken: 'access-token',
    expiresAt: 1_900_000_000_000,
  });
  assert.equal(parseKimiCredentials({ access_token: '' }), null);
  assert.equal(parseKimiCredentials({ access_token: 'unsafe\r\ntoken' }), null);
});

test('accepts only the official Kimi Code API domains', () => {
  assert.equal(hasCustomKimiConfiguration({}), false);
  assert.equal(hasCustomKimiConfiguration({ KIMI_CODE_BASE_URL: 'https://api.kimi.ai/coding/v1/' }), false);
  assert.equal(hasCustomKimiConfiguration({ KIMI_CODE_BASE_URL: 'https://proxy.example/v1' }), true);
});

test('matches the official desktop platform headers across operating systems', () => {
  assert.equal(kimiDesktopPlatform('darwin'), 'mac');
  assert.equal(kimiDesktopPlatform('win32'), 'windows');
  assert.equal(kimiDesktopPlatform('linux'), 'web');
});

test('reads only the matching desktop account and treats token membership as cached metadata', () => {
  const accessToken = jwt({ sub: 'alice', exp: 2_000_000_000, membership: { level: 10 } });
  const credentials = parseKimiDesktopToken(accessToken, 'alice');
  assert.deepEqual(credentials, { accessToken, userId: 'alice', expiresAt: 2_000_000_000_000, planLabel: 'Free' });
  assert.equal(parseKimiDesktopToken(accessToken, 'bob'), null);
  assert.equal(parseKimiDesktopToken('invalid', 'alice'), null);
  assert.equal(parseKimiDesktopToken(jwt({ sub: 'alice' }), 'alice'), null);
  for (const level of [0, 2, 12]) {
    const parsed = parseKimiDesktopToken(jwt({ sub: 'alice', exp: 2_000_000_000, membership: { level } }), 'alice');
    assert.equal(parsed?.planLabel, level === 12 ? 'Free' : null);
  }
});

test('desktop loader ignores persisted credentials and reads only its own current account', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'kimi-account-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { desktopDataDir: path.join(root, 'profile'), desktopShareDir: path.join(root, 'share'), codeHome: path.join(root, 'code'), platform: 'darwin' as const, env: {}, readDesktopContext: async () => null };
  assert.equal((await loadKimiAccount(options) as { status: string }).status, 'not-installed');
  await mkdir(options.codeHome);
  assert.equal((await loadKimiAccount(options) as { status: string }).status, 'not-installed');
  await mkdir(path.join(options.desktopShareDir, 'daimon'), { recursive: true });
  const config = JSON.stringify({ credentials: { kimiWeb: {
    accessToken: jwt({ sub: 'previous-account', exp: 2_000_000_000, membership: { level: 10 } }), userId: 'previous-account', refreshToken: 'never-use',
  } } });
  const configPath = path.join(options.desktopShareDir, 'daimon', 'config.json');
  await writeFile(configPath, config);
  let requests = 0;
  const signedOut = createKimiSubscriptionReader(() => loadKimiAccount(options), async () => { requests++; return subscriptionResponse(); });
  assert.equal((await signedOut()).status, 'not-signed-in');
  assert.match((await signedOut()).message ?? '', /打开 Kimi/);
  assert.equal(requests, 0);
  const closedWithCustomCode = await loadKimiAccount({ ...options, env: { KIMI_CODE_BASE_URL: 'https://proxy.example' } });
  assert.match((closedWithCustomCode as { message: string }).message, /打开 Kimi/);
  const context: KimiDesktopContext = {
    accessToken: jwt({ sub: 'alice', exp: 2_000_000_000, membership: { level: 10 } }), userId: 'alice', region: 'overseas', validateIdentity: async () => true,
  };
  const account = await loadKimiAccount({ ...options, readDesktopContext: async () => context, env: { KIMI_CODE_BASE_URL: 'https://proxy.example' } });
  assert.equal((account as KimiAccount).source, 'desktop');
  assert.equal((account as KimiAccount).userId, 'alice');
  assert.equal((account as KimiAccount).origin, 'https://www.kimi.ai');
  assert.equal((account as KimiAccount).planLabel, 'Free');
  assert.equal(await readFile(configPath, 'utf8'), config);
  for (const region of [undefined, 'https://proxy.example']) {
    const invalid = await loadKimiAccount({ ...options, readDesktopContext: async () => ({ ...context, region } as KimiDesktopContext) });
    assert.equal((invalid as { status: string }).status, 'temporarily-unavailable');
  }
  const syncing = await loadKimiAccount({ ...options, readDesktopContext: async () => { throw new Error('context changed'); } });
  assert.equal((syncing as { status: string }).status, 'temporarily-unavailable');
});

for (const [platform, pipe, status, message] of [
  ['darwin', undefined, 'not-signed-in', /打开 Kimi/],
  ['linux', undefined, 'not-signed-in', /打开 Kimi/],
  ['win32', undefined, 'temporarily-unavailable', /暂不支持自动连接 Windows/],
  ['win32', '   ', 'temporarily-unavailable', /暂不支持自动连接 Windows/],
  ['win32', String.raw`\\.\pipe\kimi-work-00000000-0000-4000-8000-000000000000`, 'not-signed-in', /打开 Kimi/],
] as const) {
  test(`desktop account without live context on ${platform} with pipe ${JSON.stringify(pipe)}`, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'kimi-account-platform-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const options = {
      desktopDataDir: path.join(root, 'profile'), desktopShareDir: path.join(root, 'share'),
      platform, env: pipe === undefined ? {} : { KIMI_WORK_CONTEXT_IPC: pipe },
      readDesktopContext: async () => null,
    };
    let requests = 0;
    const read = createKimiSubscriptionReader(() => loadKimiAccount(options), async () => {
      requests++;
      return subscriptionResponse();
    });
    assert.equal((await read()).status, 'not-installed');
    await mkdir(options.desktopDataDir);
    const snapshot = await read();
    assert.equal(snapshot.status, status);
    assert.match(snapshot.message ?? '', message);
    assert.equal(snapshot.planLabel, null);
    assert.deepEqual(snapshot.limits, []);
    assert.equal(requests, 0);
  });
}

test('preserves managed Code configuration and distinguishes a real custom provider', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'kimi-code-account-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { source: 'code' as const, desktopDataDir: path.join(root, 'profile'), desktopShareDir: path.join(root, 'share'), codeHome: path.join(root, 'code'), env: {}, readDesktopContext: async () => { throw new Error('must not read desktop context for Code'); } };
  await mkdir(path.join(options.codeHome, 'credentials'), { recursive: true });
  await writeFile(path.join(options.codeHome, 'credentials', 'kimi-code.json'), JSON.stringify({ access_token: 'code-session', expires_at: 2_000_000_000 }));
  const configPath = path.join(options.codeHome, 'config.toml');
  await writeFile(configPath, 'default_model = "kimi"\n[models.kimi]\nprovider = "managed:kimi-code"\n');
  assert.equal((await loadKimiAccount(options) as KimiAccount).source, 'code');
  await writeFile(configPath, 'default_model = "kimi"\n[models."kimi"]\nprovider = "custom-provider"\n');
  assert.equal((await loadKimiAccount(options) as { status: string }).status, 'custom-provider');
  await rm(configPath);
  assert.equal((await loadKimiAccount(options) as { status: string }).status, 'not-signed-in');
});

test('queries the fixed membership endpoint without redirects and emits no account secrets', async () => {
  const read = createKimiSubscriptionReader(async () => desktopAccount, async (url, init) => {
    assert.equal(url, 'https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscription');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.body, '{}');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Connect-Protocol-Version'), '1');
    assert.equal(new Headers(init?.headers).get('X-Language'), 'zh-CN');
    assert.equal(new Headers(init?.headers).get('x-msh-platform'), kimiDesktopPlatform(process.platform));
    assert.equal(new Headers(init?.headers).get('R-Timezone'), Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer desktop-alice');
    assert.ok(init?.signal);
    return subscriptionResponse();
  });
  const snapshot = await read();
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.source, 'desktop');
  assert.equal(snapshot.planLabel, 'Free');
  assert.ok(Math.abs(snapshot.limits[0]!.usedPercent - 9.23) < 0.0001);
  assert.equal(snapshot.stale, false);
  assert.equal(JSON.stringify(snapshot).includes('alice'), false);
});

test('Free remains visible without quota and never invents a percentage', async () => {
  const read = createKimiSubscriptionReader(async () => desktopAccount, async () => subscriptionResponse(0, false));
  const snapshot = await read();
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.planLabel, 'Free');
  assert.deepEqual(snapshot.limits, []);
  assert.ok(snapshot.message);
  assert.equal(snapshot.stale, false);
});

for (const [title, membershipLevel, numericLevel] of [
  ['Go', 'LEVEL_TRIAL', 15],
  ['Plus', 'LEVEL_BASIC', 20],
  ['Pro', 'LEVEL_INTERMEDIATE', 25],
  ['Max', 'LEVEL_ADVANCED', 27],
  ['Kimi Future', 'LEVEL_FUTURE', 99],
] as const) {
  test(`${title} starts without subscription data on failure, preserves successful data offline and clears it on expiry`, async () => {
    const token = jwt({ sub: 'paid-user', exp: 2_000_000_000, membership: { level: numericLevel, domain: 'DOMAIN_NEXUS' } });
    const credentials = parseKimiDesktopToken(token, 'paid-user');
    assert.ok(credentials);
    assert.equal(credentials.planLabel, null);
    const account: KimiAccount = { ...credentials, source: 'desktop', origin: 'https://www.kimi.com' };
    const goods = { title, membershipLevel, domain: 'DOMAIN_NEXUS' };
    let mode: 'offline' | 'ready' | 'expired' = 'offline';
    let usedRatio = 0.25;
    const read = createKimiSubscriptionReader(async () => account, async () => {
      if (mode === 'offline') throw new Error('offline');
      if (mode === 'expired') return new Response(null, { status: 401 });
      return subscriptionResponse(usedRatio, true, goods);
    });

    const unavailable = await read();
    assert.equal(unavailable.status, 'temporarily-unavailable');
    assert.equal(unavailable.planLabel, null);
    assert.deepEqual(unavailable.limits, []);
    assert.equal(unavailable.fetchedAt, null);
    assert.equal(unavailable.stale, false);

    mode = 'ready';
    const initial = await read({ forceRefresh: true });
    assert.equal(initial.status, 'ready');
    assert.equal(initial.planLabel, title);
    assert.equal(initial.limits[0]?.usedPercent, 25);
    assert.equal(typeof initial.fetchedAt, 'number');
    assert.equal(initial.stale, false);

    mode = 'offline';
    const cached = await read({ forceRefresh: true });
    assert.equal(cached.planLabel, title);
    assert.deepEqual(cached.limits, initial.limits);
    assert.equal(cached.fetchedAt, initial.fetchedAt);
    assert.equal(cached.stale, true);

    mode = 'ready';
    usedRatio = 0.6;
    const recovered = await read({ forceRefresh: true });
    assert.equal(recovered.status, 'ready');
    assert.equal(recovered.planLabel, title);
    assert.equal(recovered.limits[0]?.usedPercent, 60);
    assert.equal(recovered.stale, false);

    mode = 'expired';
    const expired = await read({ forceRefresh: true });
    assert.equal(expired.status, 'expired');
    assert.equal(expired.planLabel, null);
    assert.deepEqual(expired.limits, []);
    assert.equal(expired.fetchedAt, null);
    assert.equal(expired.stale, false);
    mode = 'offline';
    assert.deepEqual(await read({ forceRefresh: true }), unavailable);

    const readPlanOnly = createKimiSubscriptionReader(async () => account, async () => subscriptionResponse(0, false, goods));
    const planOnly = await readPlanOnly();
    assert.equal(planOnly.status, 'ready');
    assert.equal(planOnly.planLabel, title);
    assert.deepEqual(planOnly.limits, []);
    assert.equal(planOnly.stale, false);
  });
}

test('expired tokens skip requests and cached token Free metadata is marked stale', async () => {
  let calls = 0;
  const expired = createKimiSubscriptionReader(async () => ({ ...desktopAccount, expiresAt: Date.now() - 1 }), async () => {
    calls++;
    return subscriptionResponse();
  });
  assert.equal((await expired()).status, 'expired');
  assert.equal(calls, 0);
  const offline = createKimiSubscriptionReader(async () => desktopAccount, async () => { throw new Error('offline'); });
  const snapshot = await offline();
  assert.equal(snapshot.planLabel, 'Free');
  assert.equal(snapshot.stale, true);
  assert.deepEqual(snapshot.limits, []);
});

test('same-account network failures retain stale quota but auth failure clears it', async () => {
  let status = 200;
  let calls = 0;
  const read = createKimiSubscriptionReader(async () => desktopAccount, async () => {
    calls++;
    return status === 200 ? subscriptionResponse() : new Response(null, { status });
  });
  await read();
  await read();
  assert.equal(calls, 1);
  status = 429;
  assert.equal((await read({ forceRefresh: true })).limits.length, 1);
  assert.equal((await read({ forceRefresh: true })).stale, true);
  status = 401;
  const expired = await read({ forceRefresh: true });
  assert.equal(expired.status, 'expired');
  assert.deepEqual(expired.limits, []);
  status = 500;
  assert.deepEqual((await read()).limits, []);
});

test('a known desktop fetch failure stays stale within the TTL and ordinary reads retry until recovery', async () => {
  let offline = false;
  let calls = 0;
  let usedRatio = 0.25;
  const read = createKimiSubscriptionReader(async () => ({ ...desktopAccount, planLabel: null }), async () => {
    calls++;
    if (offline) throw new Error('offline');
    return subscriptionResponse(usedRatio, true, { title: 'Pro', membershipLevel: 'LEVEL_INTERMEDIATE', domain: 'DOMAIN_NEXUS' });
  });
  const initial = await read();
  assert.equal(initial.planLabel, 'Pro');
  assert.equal(initial.stale, false);
  offline = true;
  const failed = await read({ forceRefresh: true });
  assert.equal(failed.stale, true);
  assert.ok(failed.message);
  assert.deepEqual(await read(), failed);
  assert.deepEqual(await read(), failed);
  assert.equal(calls, 4);
  offline = false;
  usedRatio = 0.6;
  const recovered = await read();
  assert.equal(recovered.stale, false);
  assert.equal(recovered.message, null);
  assert.equal(recovered.limits[0]?.usedPercent, 60);
  assert.equal(calls, 5);
  assert.deepEqual(await read(), recovered);
  assert.equal(calls, 5);
});

test('account changes and logout discard cached quota', async () => {
  let active: Awaited<ReturnType<typeof loadKimiAccount>> = desktopAccount;
  let fail = false;
  const read = createKimiSubscriptionReader(async () => active, async () => {
    if (fail) throw new Error('offline');
    return subscriptionResponse();
  });
  await read();
  active = { ...desktopAccount, userId: 'bob', accessToken: 'desktop-bob', planLabel: null };
  fail = true;
  assert.deepEqual((await read()).limits, []);
  active = { status: 'not-signed-in', source: 'desktop', planLabel: null, limits: [], fetchedAt: null, stale: false, message: 'signed out' };
  assert.equal((await read()).status, 'not-signed-in');
  active = desktopAccount;
  assert.deepEqual((await read()).limits, []);
});

test('source changes and unreadable local credentials cannot reuse cached desktop quota', async () => {
  let active = desktopAccount;
  let loadFailure = false;
  let fetchFailure = false;
  const read = createKimiSubscriptionReader(async () => {
    if (loadFailure) throw new Error('local permission failure');
    return active;
  }, async () => {
    if (fetchFailure) throw new Error('offline');
    return subscriptionResponse();
  });
  await read();
  active = { ...desktopAccount, source: 'code', origin: 'https://api.kimi.com/coding/v1', planLabel: null };
  fetchFailure = true;
  assert.deepEqual((await read()).limits, []);
  active = desktopAccount;
  fetchFailure = false;
  await read();
  loadFailure = true;
  assert.deepEqual((await read()).limits, []);
  loadFailure = false;
  fetchFailure = true;
  assert.deepEqual((await read()).limits, []);
});

test('coalesces one account requests and rejects late responses after a switch', async () => {
  let active = desktopAccount;
  let calls = 0;
  let finish!: (value: Response) => void;
  const read = createKimiSubscriptionReader(async () => active, async (_url, init) => {
    calls++;
    if (new Headers(init?.headers).get('Authorization') === 'Bearer desktop-alice') {
      return new Promise<Response>((resolve) => { finish = resolve; });
    }
    return subscriptionResponse(0.4);
  });
  const first = read();
  const second = read();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  active = { ...desktopAccount, userId: 'bob', accessToken: 'desktop-bob' };
  assert.equal((await read()).limits[0]?.usedPercent, 40);
  finish(subscriptionResponse());
  assert.equal((await first).status, 'temporarily-unavailable');
  assert.deepEqual(await second, await first);
  assert.equal((await read()).limits[0]?.usedPercent, 40);
});

test('returning to an earlier account does not resurrect its previous in-flight request', async () => {
  let active = desktopAccount;
  let finish!: (value: Response) => void;
  let calls = 0;
  const read = createKimiSubscriptionReader(async () => active, async () => {
    if (++calls === 1) return new Promise<Response>((resolve) => { finish = resolve; });
    return subscriptionResponse(0.4);
  });
  const first = read();
  await new Promise<void>((resolve) => setImmediate(resolve));
  active = { ...desktopAccount, userId: 'bob', accessToken: 'desktop-bob' };
  await read();
  active = desktopAccount;
  assert.equal((await read()).limits[0]?.usedPercent, 40);
  finish(subscriptionResponse(0.9));
  assert.equal((await first).status, 'temporarily-unavailable');
  assert.equal((await read()).limits[0]?.usedPercent, 40);
});

test('rechecks local account state when an API response completes without another poll', async () => {
  let active: Awaited<ReturnType<typeof loadKimiAccount>> = desktopAccount;
  let finish!: (value: Response) => void;
  const read = createKimiSubscriptionReader(async () => active, async () => new Promise<Response>((resolve) => { finish = resolve; }));
  const pending = read();
  await new Promise<void>((resolve) => setImmediate(resolve));
  active = { status: 'not-signed-in', source: 'desktop', planLabel: null, limits: [], fetchedAt: null, stale: false, message: 'signed out' };
  finish(subscriptionResponse());
  const snapshot = await pending;
  assert.equal(snapshot.status, 'not-signed-in');
  assert.deepEqual(snapshot.limits, []);
});

test('validates the desktop IPC identity before publishing success or stale quota', async () => {
  let isCurrent = true;
  let shouldFail = false;
  let finish: (() => void) | null = null;
  const read = createKimiSubscriptionReader(async () => ({
    ...desktopAccount, validateIdentity: async () => isCurrent,
  }), async () => {
    if (shouldFail) {
      await new Promise<void>((resolve) => { finish = resolve; });
      throw new Error('offline');
    }
    return subscriptionResponse();
  });
  assert.equal((await read()).status, 'ready');
  shouldFail = true;
  const pending = read({ forceRefresh: true });
  await new Promise<void>((resolve) => setImmediate(resolve));
  isCurrent = false;
  assert.ok(finish);
  (finish as () => void)();
  const snapshot = await pending;
  assert.equal(snapshot.status, 'temporarily-unavailable');
  assert.deepEqual(snapshot.limits, []);
  assert.equal(snapshot.stale, false);
  shouldFail = false;
  assert.deepEqual((await read()).limits, []);
});

test('Code uses its original quota API while arbitrary base URLs cannot receive a token', async () => {
  const code: KimiAccount = { ...desktopAccount, source: 'code', origin: 'https://api.kimi.ai/coding/v1', planLabel: null };
  const read = createKimiSubscriptionReader(async () => code, async (url, init) => {
    assert.ok(url === 'https://api.kimi.ai/coding/v1/usages' || url === 'https://api.kimi.ai/coding/v1/me');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).has('x-msh-platform'), false);
    assert.equal(new Headers(init?.headers).has('X-Language'), false);
    return String(url).endsWith('/me') ? codePlanResponse() : codeUsageResponse(5);
  });
  assert.equal((await read()).limits[0]?.usedPercent, 5);
  let calls = 0;
  for (const account of [{ ...code, origin: 'https://proxy.example' }, { ...desktopAccount, origin: 'https://www.kimi.com.evil' }]) {
    const blocked = createKimiSubscriptionReader(async () => account, async () => { calls++; return subscriptionResponse(); });
    assert.equal((await blocked()).status, 'custom-provider');
  }
  assert.equal(calls, 0);
});

test('returns desktop and Code plans independently when both accounts are signed in', async () => {
  const requests: string[] = [];
  const read = createKimiSubscriptionsReader({
    loadDesktopAccount: async () => desktopAccount,
    loadCodeAccount: async () => codeAccount,
    fetchImpl: async (url, init) => {
      const address = String(url);
      requests.push(address);
      const token = new Headers(init?.headers).get('Authorization');
      if (address.startsWith('https://www.kimi.com/')) {
        assert.equal(token, 'Bearer desktop-alice');
        return subscriptionResponse();
      }
      assert.equal(token, 'Bearer code-token');
      assert.equal(init?.redirect, 'error');
      return address.endsWith('/me') ? codePlanResponse() : codeUsageResponse();
    },
  });
  const snapshots = await read();
  assert.deepEqual(snapshots.map(({ source, planLabel }) => ({ source, planLabel })), [
    { source: 'desktop', planLabel: 'Free' }, { source: 'code', planLabel: 'Pro' },
  ]);
  assert.equal(snapshots[1]?.limits[0]?.usedPercent, 25);
  await read();
  assert.equal(requests.length, 3);
});

test('desktop sign-out or loader failure never hides a valid Code subscription', async () => {
  let failDesktop = false;
  const read = createKimiSubscriptionsReader({
    loadDesktopAccount: async () => {
      if (failDesktop) throw new Error('desktop unreadable');
      return { status: 'not-signed-in', source: 'desktop', planLabel: null, limits: [], fetchedAt: null, stale: false, message: 'signed out' };
    },
    loadCodeAccount: async () => codeAccount,
    fetchImpl: async (url) => String(url).endsWith('/me') ? codePlanResponse() : codeUsageResponse(),
  });
  assert.equal((await read())[1]?.status, 'ready');
  failDesktop = true;
  const snapshots = await read();
  assert.equal(snapshots[0]?.source, 'desktop');
  assert.equal(snapshots[0]?.status, 'temporarily-unavailable');
  assert.equal(snapshots[1]?.planLabel, 'Pro');
});

test('each source retains only its own stale data and logout or switching clears only that source', async () => {
  let currentCode: Awaited<ReturnType<typeof loadKimiAccount>> = codeAccount;
  let failCode = false;
  const read = createKimiSubscriptionsReader({
    loadDesktopAccount: async () => desktopAccount,
    loadCodeAccount: async () => currentCode,
    fetchImpl: async (url) => {
      if (String(url).startsWith('https://www.kimi.com/')) return subscriptionResponse();
      if (failCode) throw new Error('Code offline');
      return String(url).endsWith('/me') ? codePlanResponse() : codeUsageResponse();
    },
  });
  await read();
  failCode = true;
  let snapshots = await read({ forceRefresh: true });
  assert.equal(snapshots[0]?.stale, false);
  assert.equal(snapshots[1]?.stale, true);
  assert.equal(snapshots[1]?.planLabel, 'Pro');
  currentCode = { ...codeAccount, userId: 'bob', accessToken: 'code-bob' };
  snapshots = await read();
  assert.equal(snapshots[0]?.planLabel, 'Free');
  assert.equal(snapshots[1]?.status, 'temporarily-unavailable');
  assert.equal(snapshots[1]?.planLabel, null);
  assert.deepEqual(snapshots[1]?.limits, []);
  currentCode = { status: 'not-signed-in', source: 'code', planLabel: null, limits: [], fetchedAt: null, stale: false, message: 'signed out' };
  snapshots = await read();
  assert.equal(snapshots[0]?.status, 'ready');
  assert.equal(snapshots[1]?.status, 'not-signed-in');
});

test('Code plan lookup failures keep useful quota and the same account last successful plan', async () => {
  let planStatus = 503;
  let used = 20;
  const read = createKimiSubscriptionReader(async () => codeAccount, async (url) => String(url).endsWith('/me')
    ? planStatus === 200 ? codePlanResponse() : new Response(null, { status: planStatus })
    : codeUsageResponse(used));
  const initial = await read();
  assert.equal(initial.status, 'ready');
  assert.equal(initial.planLabel, null);
  assert.equal(initial.limits[0]?.usedPercent, 20);
  assert.equal(initial.stale, false);
  planStatus = 200;
  assert.equal((await read({ forceRefresh: true })).planLabel, 'Pro');
  planStatus = 503;
  used = 30;
  const retained = await read({ forceRefresh: true });
  assert.equal(retained.planLabel, 'Pro');
  assert.equal(retained.limits[0]?.usedPercent, 30);
  assert.equal(retained.stale, true);
  assert.match(retained.message ?? '', /套餐.*上次/);
  used = 35;
  const retried = await read();
  assert.equal(retried.stale, true);
  assert.equal(retried.limits[0]?.usedPercent, 35);
  assert.match(retried.message ?? '', /套餐.*上次/);
  planStatus = 200;
  used = 40;
  const recovered = await read();
  assert.equal(recovered.stale, false);
  assert.equal(recovered.message, null);
  assert.equal(recovered.limits[0]?.usedPercent, 40);
});

test('a Code plan change is never combined with a quota reading from the previous plan', async () => {
  let newPlan = false;
  const read = createKimiSubscriptionReader(async () => codeAccount, async (url) => String(url).endsWith('/me')
    ? codePlanResponse(newPlan ? 'Max' : 'Pro')
    : newPlan ? new Response(null, { status: 503 }) : codeUsageResponse(70));
  await read();
  newPlan = true;
  const snapshot = await read({ forceRefresh: true });
  assert.equal(snapshot.planLabel, 'Pro');
  assert.equal(snapshot.limits[0]?.usedPercent, 70);
  assert.equal(snapshot.stale, true);
});

test('Code authentication failure from me clears otherwise valid quota', async () => {
  let status = 200;
  const read = createKimiSubscriptionReader(async () => codeAccount, async (url) => String(url).endsWith('/me')
    ? status === 200 ? codePlanResponse() : new Response(null, { status })
    : codeUsageResponse());
  await read();
  status = 401;
  const snapshot = await read({ forceRefresh: true });
  assert.equal(snapshot.status, 'expired');
  assert.equal(snapshot.planLabel, null);
  assert.deepEqual(snapshot.limits, []);
});

test('a first paid Code usage failure stays unavailable without becoming a success cache', async () => {
  let calls = 0;
  let plan = 'Pro';
  const read = createKimiSubscriptionReader(async () => codeAccount, async (url) => {
    calls++;
    return String(url).endsWith('/me') ? codePlanResponse(plan) : new Response(null, { status: 503 });
  });
  const paid = await read();
  assert.equal(paid.status, 'temporarily-unavailable');
  assert.equal(paid.planLabel, 'Pro');
  assert.deepEqual(paid.limits, []);
  await read();
  assert.equal(calls, 4);
  plan = 'Free';
  const free = await read();
  assert.equal(free.status, 'temporarily-unavailable');
  assert.equal(free.planLabel, 'Free');
  assert.deepEqual(free.limits, []);
});
