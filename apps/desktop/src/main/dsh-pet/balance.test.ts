import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QuotaState, QuotaProviderState } from '../../shared/quota.js';
import { toDshPetBalance } from './balance.js';

const provider = (patch: Partial<QuotaProviderState> = {}): QuotaProviderState => ({ id: 'codex', label: 'Codex', status: 'ready', planLabel: null, fetchedAt: 100, queriedAt: 100, stale: false, message: null, windows: [], details: [], resetCredits: null, refreshing: false, nextRefreshAt: null, analyses: {}, service: null, ...patch });
const state = (value: QuotaProviderState): QuotaState => ({ providers: [value], preferences: { thresholdAlerts: false, resetAlerts: false, showSparkline: false, paceModel: 'uniform', channels: {} }, notice: null });

test('retains the real label and reset of the tightest quota window without inventing other periods', () => {
  const result = toDshPetBalance(state(provider({ windows: [{ id: 'daily', label: '每日请求', usedPercent: 95, resetsAt: 200 }, { id: 'monthly', label: '月度请求', usedPercent: 20, resetsAt: 300 }] })), 'codex');
  assert.equal(result.ok, true);
  if (result.ok && result.shape === 'windows') { assert.equal(result.data.monthly, 95); assert.equal(result.data.monthlyLabel, '每日请求'); assert.equal(result.data.rolling, undefined); assert.equal(result.data.monthlyResetsAt, '1970-01-01T00:03:20.000Z'); }
});

test('never presents missing or stale data as zero usage or an estimated monetary balance', () => {
  assert.equal(toDshPetBalance(state(provider({ stale: true })), 'codex').ok, false);
  assert.equal(toDshPetBalance(state(provider()), 'missing').ok, false);
  const result = toDshPetBalance(state(provider({ id: 'deepseek', windows: [{ id: 'balance-cny', label: 'CNY 余额', valueText: '¥12.34', usedPercent: 0, resetsAt: null, analysisEligible: false }] })), 'deepseek');
  assert.equal(result.ok, true);
  if (result.ok && result.shape === 'money') { assert.equal(result.data.total, '12.34'); assert.equal(result.data.fullBalance, undefined); }
});
