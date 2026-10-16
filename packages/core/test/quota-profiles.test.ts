import test from 'node:test';
import assert from 'node:assert/strict';
import { validQuotaPatch } from '../src/quota/readers/quota-store.js';
import { QuotaManager, type QuotaReader } from '../src/quota/readers/quota-manager.js';
import { DEFAULT_QUOTA_PREFERENCES } from '../src/quota/shared/quota.js';
import { markQuotaIdentity } from '../src/quota/readers/quota-identity.js';
import { markQuotaEvidence, quotaEvidence, selectQuotaObservation, observationsFromOMPRows, createOMPQuotaObservationReader } from '../src/quota/readers/quota-observations.js';
import { createCodexSubscriptionReader } from '../src/quota/readers/codex-subscription.js';
import path from 'node:path';

test('profiles validate bounded ids, native providers and absolute directories', () => {
  const profile = { id: 'work', provider: 'codex', label: '工作', directory: '/tmp/work', enabled: true };
  assert.equal(validQuotaPatch({ profiles: [profile] }), true);
  for (const invalid of [{ ...profile, directory: 'relative' }, { ...profile, provider: 'unknown' }, { ...profile, id: '../escape' }, { ...profile, accessToken: 'secret' }]) assert.equal(validQuotaPatch({ profiles: [invalid] }), false);
  assert.equal(validQuotaPatch({ profiles: [profile, profile] }), false);
});

test('saving new profiles rejects duplicate directories before persisting but allows legacy removal', async () => {
  let saves = 0;
  const first = { id: 'one', provider: 'codex' as const, label: '个人', directory: path.resolve('fixture-profile'), enabled: true };
  const manager = new QuotaManager({ readers: [], store: { preferences: { ...structuredClone(DEFAULT_QUOTA_PREFERENCES), profiles: [first] }, history: {}, notice: null, async savePreferences() { saves++; }, async saveHistory() {} }, notify() {} });
  await assert.rejects(manager.setPreferences({ profiles: [first, { ...first, id: 'two', directory: path.join(first.directory, 'nested', '..') }] }), /QUOTA_DUPLICATE_DIRECTORY/);
  assert.equal(saves, 0);
  assert.equal(manager.getState().preferences.profiles?.length, 1);
  await manager.setPreferences({ profiles: [] });
  assert.equal(saves, 1);
  manager.dispose();
});

test('default credential directories cannot be registered as additional profiles', async () => {
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.resolve('fixture-default-codex');
  const manager = new QuotaManager({ readers: [], store: { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), history: {}, notice: null, async savePreferences() {}, async saveHistory() {} }, notify() {} });
  try {
    await assert.rejects(manager.setPreferences({ profiles: [{ id: 'duplicate', provider: 'codex', label: '工作', directory: process.env.CODEX_HOME, enabled: true }] }), /QUOTA_DEFAULT_DIRECTORY/);
  } finally { manager.dispose(); if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; }
});

test('same provider profiles have unique state ids and independent refreshes', async () => {
  const calls: string[] = [];
  const reader = (key: string): QuotaReader => ({ id: 'codex', key, profileLabel: key, label: 'Codex', interval: 180, async read() { calls.push(key); return markQuotaIdentity({ status: 'ready', fetchedAt: 1000, fiveHour: { usedPercent: key.endsWith('work') ? 20 : 60 } }, key); } });
  const manager = new QuotaManager({ readers: [reader('codex'), reader('codex@work')], store: { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), history: {}, notice: null, async savePreferences() {}, async saveHistory() {} }, now: () => 1000, notify() {} });
  await manager.refresh('manual', 'codex@work');
  assert.deepEqual(calls, ['codex@work']);
  assert.deepEqual(manager.getState().providers.map(p => p.id), ['codex', 'codex@work']);
  assert.equal(manager.getState().providers[1]?.profileLabel, 'codex@work');
  manager.dispose();
});

test('cross-source borrowing requires exact account identity and newer fresh observations', () => {
  const native = markQuotaEvidence({ status: 'temporarily-unavailable', fetchedAt: null }, { source: 'native', observer: 'Codex', observedAt: null, identityVerified: true }, { accountId: 'a' });
  const foreign = markQuotaEvidence({ status: 'ready', fetchedAt: 990, windows: [{ id: 'five-hour', label: '5h', usedPercent: 20, resetsAt: 2000 }] }, { source: 'omp', observer: 'OMP 本地记录', observedAt: 990, identityVerified: true }, { accountId: 'b' });
  assert.equal(selectQuotaObservation(native, [foreign], 1000), native);
  const matching = markQuotaEvidence({ ...foreign }, { source: 'omp', observer: 'OMP 本地记录', observedAt: 990, identityVerified: true }, { accountId: 'a' });
  const selected = selectQuotaObservation(native, [foreign, matching], 1000);
  assert.equal(quotaEvidence(selected)?.source, 'omp');
  assert.equal(selectQuotaObservation(native, [matching], 4000), native);
  assert.equal(JSON.stringify(selected).includes('accountId'), false);
  assert.equal(selectQuotaObservation({}, [matching], 1000).constructor, Object);
  assert.notEqual(selectQuotaObservation({}, [matching], 1000), matching);
});

test('OMP null utilization is unknown and window ages are not combined across refreshes', () => {
  const row = { provider: 'anthropic', account_key: 'a', email: 'a@example.test', account_id: 'org-a', limit_id: 'anthropic:5h', label: '5h', window_label: '5h', used_fraction: null, recorded_at: 990000, resets_at: 2000000 };
  assert.equal(observationsFromOMPRows([row], 1000).length, 0);
  const observations = observationsFromOMPRows([{ ...row, used_fraction: 0.2 }], 1000);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.snapshot.windows[0]?.usedPercent, 20);
  assert.equal(JSON.stringify(observations[0]?.snapshot).includes('example.test'), false);
});

test('an older OMP observation never replaces a stale but newer native reading', () => {
  const proof = { source: 'native' as const, observer: 'Codex', observedAt: 1000, identityVerified: true };
  const native = markQuotaEvidence({ status: 'ready', fetchedAt: 1000, stale: true }, proof, { accountId: 'a' });
  const older = markQuotaEvidence({ status: 'ready', fetchedAt: 990 }, { ...proof, source: 'omp', observedAt: 990 }, { accountId: 'a' });
  const newer = markQuotaEvidence({ status: 'ready', fetchedAt: 1010 }, { ...proof, source: 'omp', observedAt: 1010 }, { accountId: 'a' });
  assert.equal(selectQuotaObservation(native, [older], 1100), native);
  assert.equal(quotaEvidence(selectQuotaObservation(native, [newer], 1100))?.observedAt, 1010);
});

test('Codex initial 429 preserves private account proof and backoff for fallback', async () => {
  const read = createCodexSubscriptionReader({ readAuth: async () => JSON.stringify({ tokens: { access_token: 'fixture-token', account_id: 'a' } }),
    fetch: async () => new Response('{}', { status: 429, headers: { 'retry-after': '90' } }), now: () => 1000000 });
  const native = await read();
  assert.equal(quotaEvidence(native)?.identityVerified, true);
  assert.equal((native as unknown as { retryAfterSeconds: number }).retryAfterSeconds, 90);
  const observed = markQuotaEvidence({ status: 'ready', fetchedAt: 990 }, { source: 'omp', observer: 'OMP', observedAt: 990, identityVerified: true }, { accountId: 'a' });
  assert.equal(quotaEvidence(selectQuotaObservation(native, [observed], 1000))?.source, 'omp');
});

test('changing a profile retires its pending result and saves preferences before publishing', async () => {
  let release: (value: unknown) => void = () => {};
  const profile = { id: 'work', provider: 'codex' as const, label: '工作', directory: '/tmp/old', enabled: true };
  const slow: QuotaReader = { id: 'codex', key: 'codex@work', profileId: 'work', label: 'Codex', interval: 180, read: () => new Promise(resolve => { release = resolve; }) };
  const fresh: QuotaReader = { ...slow, read: async () => markQuotaIdentity({ status: 'ready', fetchedAt: 1000, fiveHour: { usedPercent: 10 } }, 'new') };
  const saved: unknown[] = [];
  const manager = new QuotaManager({ readers: [], profileReaders: list => list.filter(row => row.enabled).map(row => row.directory === '/tmp/old' ? slow : fresh),
    store: { preferences: { ...structuredClone(DEFAULT_QUOTA_PREFERENCES), profiles: [profile] }, history: {}, notice: null, async savePreferences(value) { saved.push(value); }, async saveHistory() {} }, now: () => 1000, notify() {} });
  const pending = manager.refresh('manual');
  await manager.setPreferences({ profiles: [{ ...profile, directory: '/tmp/new' }] });
  release(markQuotaIdentity({ status: 'ready', fetchedAt: 1000, fiveHour: { usedPercent: 90 } }, 'old'));
  await pending;
  await manager.refresh('manual');
  assert.equal(saved.length, 1); assert.equal(manager.getState().providers[0]?.windows[0]?.usedPercent, 10);
  manager.dispose();
});

test('OMP transient read failures retain stale account cards and original observation time', () => {
  const row = { provider: 'openai-codex', account_key: 'fixture', account_id: 'a', limit_id: 'openai-codex:primary', window_label: '5h', used_fraction: 0.25, recorded_at: 990000 };
  let failed = false, empty = false;
  const read = createOMPQuotaObservationReader(() => { if (failed) throw new Error('database locked'); return empty ? [] : observationsFromOMPRows([row], 1000); });
  assert.equal(read()[0]?.snapshot.stale, false);
  failed = true;
  const retained = read();
  assert.equal(retained.length, 1); assert.equal(retained[0]?.snapshot.stale, true);
  assert.equal(retained[0]?.snapshot.windows[0]?.usedPercent, 25);
  assert.equal(quotaEvidence(retained[0]?.snapshot)?.observedAt, 990);
  failed = false;
  assert.equal(read()[0]?.snapshot.stale, false);
  empty = true;
  assert.equal(read().length, 0);
});

test('multi-account threshold and reset notifications identify the profile', async () => {
  let clock = 1000, used = 10, reset = 2000;
  const notices: { label: string; kind: string }[] = [];
  const readers: QuotaReader[] = ['工作', '个人'].map(profileLabel => ({ id: 'codex', key: `codex@${profileLabel}`, profileLabel, label: 'Codex', interval: 180,
    async read() { return markQuotaIdentity({ status: 'ready', fetchedAt: clock, fiveHour: { usedPercent: used, resetsAt: reset, windowDurationMins: 300 } }, profileLabel); } }));
  const manager = new QuotaManager({ readers, store: { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), history: {}, notice: null, async savePreferences() {}, async saveHistory() {} }, now: () => clock, notify: value => notices.push(value) });
  await manager.refresh('manual');
  clock++; used = 95;
  await manager.refresh('manual');
  assert.deepEqual(notices.map(value => value.label).sort(), ['Codex · 个人', 'Codex · 工作']);
  clock = 2001; used = 1; reset = 3000;
  await manager.refresh('manual');
  assert.deepEqual(notices.filter(value => value.kind === 'reset').map(value => value.label).sort(), ['Codex · 个人', 'Codex · 工作']);
  manager.dispose();
});
