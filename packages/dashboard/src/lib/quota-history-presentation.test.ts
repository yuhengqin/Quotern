import test from 'node:test';
import assert from 'node:assert/strict';
import type { QuotaHistoryCycle } from 'quotern-core';
import { quotaCycleStatus, quotaHistoryWindowLabel } from './quota-history-presentation.ts';

test('cycle state requires a reset boundary and only the newest segment can be current', () => {
  const cycle = (id: string, resetsAt: number | null) => ({ id, resetsAt } as QuotaHistoryCycle);
  assert.equal(quotaCycleStatus(cycle('new', 200), 'new', 100), 'current');
  assert.equal(quotaCycleStatus(cycle('old', 200), 'new', 100), 'previousSegment');
  assert.equal(quotaCycleStatus(cycle('old', 100), 'new', 100), 'ended');
  assert.equal(quotaCycleStatus(cycle('new', null), 'new', 100), 'unknownStatus');
});

test('history window labels use known period IDs without changing unknown cycle starts', () => {
  assert.equal(quotaHistoryWindowLabel({ id: 'account:604800', label: 'account:604800', cycles: [] }, 'codex', 'zh-CN'), '周限额');
  assert.equal(quotaHistoryWindowLabel({ id: '7d', label: '7d', groupLabel: 'Pro', cycles: [] }, 'codex', 'en'), 'Pro Weekly limit');
});
