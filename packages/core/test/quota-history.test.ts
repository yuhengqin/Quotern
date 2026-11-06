import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQuotaHistoryReport, type QuotaHistorySource } from '../src/quota/quota-history.js';
import type { SessionObservation } from '../src/session-observation.js';
import { QuotaManager } from '../src/quota/readers/quota-manager.js';
import { markQuotaIdentity } from '../src/quota/readers/quota-identity.js';
import { DEFAULT_QUOTA_PREFERENCES } from '../src/quota/shared/quota.js';

test('switching to another stale account never exposes the previous account history', async () => {
  let account = 'A', stale = false;
  const manager = new QuotaManager({ now: () => start, notify() {},
    store: { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), history: {}, notice: null, async savePreferences() {}, async saveHistory() {} },
    readers: [{ id: 'codex', label: 'Codex', interval: 180, read: async () => markQuotaIdentity({ status: 'ready', fetchedAt: start, stale,
      fiveHour: { usedPercent: 20, resetsAt: start + 18000, windowDurationMins: 300 } }, account) }],
  });
  try {
    await manager.refresh('manual');
    assert.equal(manager.getHistory('codex')!.windows.length, 1);
    account = 'B'; stale = true;
    await manager.refresh('manual');
    assert.equal(manager.getState().providers[0]!.stale, true);
    assert.equal(manager.getHistory('codex')?.windows.length ?? 0, 0);
  } finally { manager.dispose(); }
});

const start = Date.parse('2026-11-01T00:00:00Z') / 1000;
const source = (samples: QuotaHistorySource['windows'][number]['samples'], id = 'account:18000'): QuotaHistorySource => ({
  providerId: 'codex', label: 'Codex', revision: 1,
  windows: [{ id, label: '5h', samples }],
});
const sample = (delta: number, percent: number, extra = {}) => ({ at: start + delta, usedPercent: percent, resetsAt: start + 18000, ...extra });
const event = (delta: number, accountRef = 'openai:account', extra: Partial<SessionObservation> = {}): SessionObservation => ({
  id: String(delta), source: 'codex', sessionId: 'one', timestamp: new Date((start + delta) * 1000).toISOString(), model: 'known',
  tokens: 100, usageKnown: true, costUsd: 0.25, costKind: 'recorded', billing: { service: 'openai', mode: 'subscription', accountRef, evidence: 'recorded' }, ...extra,
});

test('quota history groups reset cycles with tolerance while retaining only observed coverage', () => {
  const report = buildQuotaHistoryReport(source([sample(0, 20), sample(100, 30, { resetsAt: start + 18020 }), sample(19000, 3, { resetsAt: start + 36000 })]), [], start + 20000);
  const cycles = report.windows[0]!.cycles;
  assert.equal(cycles.length, 2);
  assert.equal(cycles[1]!.observedUsedPercent, 10);
  assert.equal(cycles[1]!.startedAt, null);
  assert.equal(cycles[1]!.lastUsedPercent, 30);
  assert.equal(cycles[1]!.usage, null);
});

test('quota history splits counter rollback and does not invent cycles without reset evidence', () => {
  const cycles = buildQuotaHistoryReport(source([sample(0, 50), sample(100, 20), sample(200, 21), sample(300, 25, { resetsAt: null })]), [], start + 1000).windows[0]!.cycles;
  assert.equal(cycles.length, 3);
  assert.equal(cycles[0]!.resetsAt, null);
  assert.equal(cycles[1]!.discontinuous, true);
  assert.equal(cycles[1]!.observedUsedPercent, null);
});

test('quota usage matches subscription account and exact observation interval; unknown amounts stay incomplete', () => {
  const proof = { durationSeconds: 18000, accountRef: 'openai:account', service: 'openai' };
  const report = buildQuotaHistoryReport(source([sample(60, 20, proof), sample(120, 30, proof)]), [
    event(59), event(60), event(90), event(90, 'another', { id: 'other-account' }), event(120),
    event(100, 'openai:account', { id: 'api', billing: { service: 'openai', mode: 'api', accountRef: 'openai:account', evidence: 'recorded' } }),
    event(110, 'openai:account', { costUsd: null, costKind: 'unknown' }),
  ], start + 500);
  const cycle = report.windows[0]!.cycles[0]!;
  assert.equal(cycle.startedAt, start);
  assert.equal(cycle.usage?.tokens, 300);
  assert.equal(cycle.usage?.knownCostUsd, 0.5);
  assert.equal(cycle.usage?.costComplete, false);
  assert.equal(cycle.usage?.tokensPerPercent, 30);
});

test('ambiguous identities, legacy samples and feature pools never produce an efficiency claim', () => {
  const proof = { accountRef: 'openai:account', service: 'openai' };
  const mixed = buildQuotaHistoryReport(source([sample(0, 10), sample(100, 20, proof)]), [event(50)], start + 300);
  assert.equal(mixed.windows[0]!.cycles[0]!.usage, null);
  const feature = buildQuotaHistoryReport(source([sample(0, 10, proof), sample(100, 20, proof)], 'feature:code:18000'), [event(50)], start + 300);
  assert.equal(feature.windows[0]!.cycles[0]!.usage?.tokens, 100);
  assert.equal(feature.windows[0]!.cycles[0]!.usage?.tokensPerPercent, null);
});
