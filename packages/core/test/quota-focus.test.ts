import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_QUOTA_PREFERENCES, type QuotaProviderState } from '../src/quota/shared/quota.js';
import * as presentation from '../src/quota/shared/quota-presentation.js';
import { validQuotaPatch } from '../src/quota/readers/quota-store.js';
import { QuotaManager } from '../src/quota/readers/quota-manager.js';

test('preferred quota windows accept opaque bounded IDs and reject invalid persisted maps', () => {
  assert.equal(validQuotaPatch({ preferredWindows: { 'codex@work': 'feature:review:604800', claude: '' } }), true);
  for (const preferredWindows of [[], null, { codex: 1 }, { codex: 'x'.repeat(301) }, { codex: 'bad\nvalue' }, { '../codex': 'weekly' }, Object.fromEntries(Array.from({ length: 101 }, (_, n) => [`p${n}`, 'weekly']))]) {
    assert.equal(validQuotaPatch({ preferredWindows }), false);
  }
});

test('saving a preferred window merges per card and preserves other concurrent changes', async () => {
  const manager = new QuotaManager({ readers: [], store: { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), history: {}, notice: null, async savePreferences() {}, async saveHistory() {} }, notify() {} });
  await Promise.all([manager.setPreferences({ preferredWindows: { codex: 'weekly' } } as never), manager.setPreferences({ preferredWindows: { 'codex@work': 'five-hour' } } as never)]);
  await manager.setPreferences({ preferredWindows: { codex: '' } } as never);
  assert.deepEqual((manager.getState().preferences as unknown as { preferredWindows: unknown }).preferredWindows, { codex: '', 'codex@work': 'five-hour' });
  manager.dispose();
});

test('quota primary uses the chosen live window or the tightest live allowance without inventing freshness', () => {
  const primary = (presentation as unknown as { primaryQuotaWindow?: (provider: QuotaProviderState, preferred?: string, now?: number) => { id: string } | null }).primaryQuotaWindow;
  assert.equal(typeof primary, 'function');
  const provider = { status: 'ready', stale: false, windows: [
    { id: 'expired', label: 'old', usedPercent: 100, resetsAt: 1 },
    { id: 'weekly', label: 'week', usedPercent: 95, resetsAt: 2000 },
    { id: 'session', label: 'session', usedPercent: 20, resetsAt: 1500 },
  ] } as QuotaProviderState;
  assert.equal(primary!(provider, 'session', 1000)?.id, 'session');
  assert.equal(primary!(provider, 'missing', 1000)?.id, 'weekly');
  assert.equal(primary!(provider, 'expired', 1000)?.id, 'weekly');
  assert.equal(primary!({ ...provider, stale: true }, 'session', 1000), null);
  assert.equal(primary!({ ...provider, status: 'expired' }, 'session', 1000), null);
  assert.equal(primary!({ ...provider, windows: [] }, undefined, 1000), null);
});

test('notification navigation follows verified identity through deduplication and refuses changed or unknown accounts', () => {
  const resolve = (presentation as unknown as { resolveQuotaNavigation?: (target: { providerId: string; providerType: string; windowId?: string; accountRef?: string }, providers: QuotaProviderState[]) => QuotaProviderState | null }).resolveQuotaNavigation;
  assert.equal(typeof resolve, 'function');
  const row = (id: string, accountRef: string, providerId = 'codex') => ({ id, providerId, provenance: { identityVerified: true, accountRef } }) as QuotaProviderState;
  const target = { providerId: 'codex@work', providerType: 'codex', windowId: 'weekly', accountRef: 'account-a' };
  assert.equal(resolve!(target, [row('codex@work', 'account-a')])?.id, 'codex@work');
  assert.equal(resolve!(target, [row('codex', 'account-a')])?.id, 'codex');
  assert.equal(resolve!(target, [row('codex@work', 'account-b')]), null);
  assert.equal(resolve!({ ...target, accountRef: undefined }, [row('codex@work', 'account-a')]), null);
  assert.equal(resolve!(target, [row('claude', 'account-a', 'claude')]), null);
  assert.equal(resolve!({ providerId: 'codex', providerType: 'codex' }, [row('codex@work', 'account-a')])?.id, 'codex@work');
});
