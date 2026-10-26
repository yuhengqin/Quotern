import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QuotaManager } from '../src/quota/readers/quota-manager.js';
import { markQuotaIdentity } from '../src/quota/readers/quota-identity.js';
import { captureQuotaRead, observeQuotaResponse } from '../src/quota/readers/quota-fetch-state.js';
import { DEFAULT_QUOTA_PREFERENCES } from '../src/quota/shared/quota.js';

test('quota diagnostics retain HTTP failure and retry time without response secrets', async () => {
  const now = 1792800000;
  const manager = new QuotaManager({ now: () => now, monotonic: () => 1000, notify() {},
    store: { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), history: {}, notice: null, async savePreferences() {}, async saveHistory() {} },
    readers: [{ id: 'codex', label: 'Codex', interval: 180, read: () => captureQuotaRead(async () => {
      observeQuotaResponse(new Response('Bearer secret user@example.com C:/private/auth.json', { status: 429, headers: { 'retry-after': '600' } }));
      return { status: 'unavailable', message: 'secret user@example.com', fetchedAt: null };
    }) }],
  });
  const provider = (await manager.refresh('manual')).providers[0] as any;
  assert.equal(provider.diagnostic?.code, 'RATE_LIMITED');
  assert.equal(provider.diagnostic.retryAt, now + 600);
  assert.equal(provider.diagnostic.attempts[0].httpStatus, 429);
  assert.doesNotMatch(JSON.stringify(provider.diagnostic), /secret|example|private|auth.json/);
  manager.dispose();
});

test('concurrent provider diagnoses do not borrow another request failure', async () => {
  const manager = new QuotaManager({ notify() {},
    store: { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), history: {}, notice: null, async savePreferences() {}, async saveHistory() {} },
    readers: [401, 200].map((status, i) => ({ id: i ? 'claude' as const : 'codex' as const, label: 'provider', interval: 180,
      read: async () => { await Promise.resolve(); observeQuotaResponse(new Response('{}', { status })); return { status: i ? 'ready' : 'expired' }; } })),
  });
  const providers = (await manager.refresh('manual')).providers as any[];
  assert.equal(providers[0].diagnostic?.code, 'AUTH_EXPIRED');
  assert.equal(providers[1].diagnostic?.code, null);
  assert.deepEqual(providers[1].diagnostic.attempts.map((a: any) => a.httpStatus), [200]);
  manager.dispose();
});

test('same-account stale retention uses the new diagnosis and new account clears old windows', async () => {
  let phase = 0;
  const manager = new QuotaManager({ notify() {},
    store: { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), history: {}, notice: null, async savePreferences() {}, async saveHistory() {} },
    readers: [{ id: 'codex', label: 'Codex', interval: 180, read: async () => markQuotaIdentity(phase === 0
      ? { status: 'ready', fetchedAt: Date.now() / 1000, windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 30 }] }
      : { status: 'unavailable', message: 'raw secret' }, phase === 2 ? 'different-account' : 'same-account') }],
  });
  await manager.refresh('manual'); phase = 1;
  const stale = (await manager.refresh('manual')).providers[0] as any;
  assert.equal(stale.windows[0].usedPercent, 30);
  assert.equal(stale.diagnostic?.retainedFrom, 'cache');
  assert.equal(stale.diagnostic.code, 'UNAVAILABLE');
  phase = 2;
  const changed = (await manager.refresh('manual')).providers[0] as any;
  assert.equal(changed.windows.length, 0);
  assert.equal(changed.diagnostic.retainedFrom, null);
  manager.dispose();
});
