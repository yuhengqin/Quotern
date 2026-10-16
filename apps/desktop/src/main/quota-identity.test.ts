import assert from 'node:assert/strict';
import test from 'node:test';
import { markQuotaIdentity, quotaIdentity } from './quota-identity';

test('history identity survives credential rotation when a stable account identifier is available', () => {
  const a = markQuotaIdentity({}, { userId: 'same-user', token: 'old-secret' });
  const b = markQuotaIdentity({}, { userId: 'same-user', token: 'new-secret' });
  const c = markQuotaIdentity({}, { userId: 'different-user', token: 'new-secret' });
  assert.equal(quotaIdentity(a), quotaIdentity(b));
  assert.notEqual(quotaIdentity(a), quotaIdentity(c));
  assert.equal(JSON.stringify(a), '{}');
});
