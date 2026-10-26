import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QUOTA_PROVIDER_DESCRIPTORS, validateQuotaProviderDescriptors, getQuotaProviderDescriptor } from '../src/quota/shared/provider-descriptors.js';
import { SUBSCRIPTION_CHANNELS } from '../src/quota/shared/subscription-channels.js';

test('declarative providers preserve channel order, intervals and existing status sources', () => {
  validateQuotaProviderDescriptors(QUOTA_PROVIDER_DESCRIPTORS);
  assert.deepEqual(QUOTA_PROVIDER_DESCRIPTORS.map(p => ({ id: p.id, label: p.label })), SUBSCRIPTION_CHANNELS);
  assert.equal(getQuotaProviderDescriptor('codex').refreshIntervalSeconds, 180);
  assert.equal(getQuotaProviderDescriptor('copilot').refreshIntervalSeconds, 900);
  assert.equal(getQuotaProviderDescriptor('antigravity').refreshIntervalSeconds, 600);
  assert.deepEqual(QUOTA_PROVIDER_DESCRIPTORS.filter(p => p.statusPage).map(p => p.id), ['codex', 'claude', 'cursor', 'copilot']);
  assert.deepEqual(QUOTA_PROVIDER_DESCRIPTORS.filter(p => p.capabilities.profiles).map(p => p.id), ['codex', 'claude']);
});

test('descriptor validation rejects ambiguous ids, invalid policy and credential-bearing URLs', () => {
  const one = QUOTA_PROVIDER_DESCRIPTORS[0];
  for (const values of [[one, one], [{ ...one, refreshIntervalSeconds: 0 }], [{ ...one, platforms: ['invalid'] }],
    [{ ...one, authMethods: ['password'] }], [{ ...one, strategies: [{ kind: 'execute-js', platforms: ['win32'] }] }],
    [{ ...one, statusPage: { url: 'https://user:secret@status.example/', protocol: 'statuspage-v2' } }],
    [{ ...one, statusPage: { url: 'http://status.example/', protocol: 'statuspage-v2' } }]]) {
    assert.throws(() => validateQuotaProviderDescriptors(values));
  }
});
