import assert from 'node:assert/strict';
import test from 'node:test';
import type { QuotaWindow } from '../../shared/quota';
import { commonQuotaResetAt } from './quota-presentation';

const window = (id: string, resetsAt: number | null, timeKind?: 'reset' | 'expiry'): QuotaWindow => ({ id, label: id, usedPercent: 40, resetsAt, timeKind });

test('combines reset times only when every displayed pool has the same exact reset timestamp', () => {
  assert.equal(commonQuotaResetAt([window('a', 1_900_000_000), window('b', 1_900_000_000)]), 1_900_000_000);
  assert.equal(commonQuotaResetAt([window('a', 1_900_000_000), window('b', 1_900_000_001)]), null);
  assert.equal(commonQuotaResetAt([window('a', 1_900_000_000), window('b', null)]), null);
  assert.equal(commonQuotaResetAt([window('a', 1_900_000_000)]), null);
  assert.equal(commonQuotaResetAt([]), null);
});

test('never labels expiration or invalid timestamps as a shared reset', () => {
  assert.equal(commonQuotaResetAt([window('a', 1_900_000_000), window('b', 1_900_000_000, 'expiry')]), null);
  assert.equal(commonQuotaResetAt([window('a', 1_900_000_000, 'expiry'), window('b', 1_900_000_000, 'expiry')]), null);
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(commonQuotaResetAt([window('a', invalid), window('b', invalid)]), null);
  }
});
