import assert from 'node:assert/strict';
import test from 'node:test';
import { QuotaManager, type QuotaNotification } from './quota-manager';
import { markQuotaIdentity } from './quota-identity';
import { DEFAULT_QUOTA_PREFERENCES, type QuotaSample } from '../shared/quota';

const start = 1800000000;
function fixture() {
  let time = start, used = 60, account = 'one', stale = false, fail = false, calls = 0;
  const alerts: string[] = [];
  const history = {};
  const manager = new QuotaManager({
    now: () => time, monotonic: () => time * 1000,
    readers: [{ id: 'codex', label: 'Codex', interval: 180, read: async () => {
      calls++;
      if (fail) return markQuotaIdentity({ status: 'unavailable', retryAfterSeconds: 600, message: '稍后重试' }, account);
      return markQuotaIdentity({ status: 'ready', fetchedAt: time, stale, fiveHour: { usedPercent: used, resetsAt: start + 18000 } }, account);
    } }],
    store: { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), history, notice: null,
      savePreferences: async () => {}, saveHistory: async () => {} },
    notify: notification => { alerts.push(notification.kind); },
  });
  return { manager, alerts, history, calls: () => calls, set: (value: Partial<{ time: number; used: number; account: string; stale: boolean; fail: boolean }>) => {
    if (value.time !== undefined) time = value.time;
    if (value.used !== undefined) used = value.used;
    if (value.account !== undefined) account = value.account;
    if (value.stale !== undefined) stale = value.stale;
    if (value.fail !== undefined) fail = value.fail;
  } };
}

test('background samples notify once; stale/cache replays and account changes never replay alerts', async () => {
  const f = fixture();
  await f.manager.refresh('manual');
  f.set({ time: start + 180, used: 95 }); await f.manager.refresh('manual');
  assert.deepEqual(f.alerts, ['threshold-90']);
  f.set({ time: start + 360, used: 50, stale: true }); await f.manager.refresh('manual');
  f.set({ time: start + 540, used: 95, stale: false, account: 'two' }); await f.manager.refresh('manual');
  assert.deepEqual(f.alerts, ['threshold-90']);
  assert.equal(Object.keys(f.history).length, 2);
  f.manager.dispose();
});

test('rate limiting blocks background but manual refresh makes a deliberate attempt', async () => {
  const f = fixture();
  f.set({ fail: true }); await f.manager.refresh('manual');
  f.set({ time: start + 200 }); await f.manager.refresh('periodic');
  assert.equal(f.calls(), 1);
  f.set({ time: start + 220 }); await f.manager.refresh('manual');
  assert.equal(f.calls(), 2);
  f.manager.dispose();
});

test('closing a channel stops reads and notification evaluation, saving failure preserves preferences', async () => {
  const f = fixture();
  await f.manager.setPreferences({ channels: { codex: false } });
  await f.manager.refresh('manual'); assert.equal(f.calls(), 0);
  await assert.rejects(f.manager.setPreferences({ paceModel: 'invalid' } as never));
  assert.equal(f.manager.getState().preferences.paceModel, 'uniform');
  f.manager.dispose();
});

test('dispose prevents a late provider from publishing or notifying', async () => {
  let release!: (value: unknown) => void, updates = 0;
  const manager = new QuotaManager({ readers: [{ id: 'codex', label: 'Codex', interval: 180, read: () => new Promise(resolve => { release = resolve; }) }],
    store: { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), history: {}, notice: null, savePreferences: async () => {}, saveHistory: async () => {} },
    notify: () => assert.fail('disposed notification'), onChanged: () => updates++ });
  const pending = manager.refresh('manual');
  manager.dispose(); const before = updates;
  release(markQuotaIdentity({ status: 'ready', fetchedAt: start, fiveHour: { usedPercent: 99 } }, 'one'));
  await pending;
  assert.equal(updates, before);
});

test('a failed preferences write does not apply changes or resume a channel', async () => {
  const manager = new QuotaManager({ readers: [], store: { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), history: {}, notice: null,
    savePreferences: async () => { throw new Error('disk blocked'); }, saveHistory: async () => {} }, notify: () => {} });
  await assert.rejects(manager.setPreferences({ thresholdAlerts: false }));
  assert.equal(manager.getState().preferences.thresholdAlerts, true);
  assert.match(manager.getState().notice!, /保存失败/);
  manager.dispose();
});

test('locking the system slows background reads while a user refresh remains available', async () => {
  const f = fixture(); await f.manager.refresh('manual');
  f.manager.setSignals(true, false);
  f.set({ time: start + 300 }); await f.manager.refresh('periodic'); assert.equal(f.calls(), 1);
  await f.manager.refresh('manual'); assert.equal(f.calls(), 2);
  f.manager.dispose();
});

test('a new account whose first fetch fails never inherits previous account display or history', async () => {
  const f = fixture(); await f.manager.refresh('manual');
  f.set({ account: 'two', fail: true, time: start + 180 }); await f.manager.refresh('manual');
  const provider = f.manager.getState().providers[0];
  assert.equal(provider.windows.length, 0);
  assert.equal(provider.planLabel, null);
  assert.equal(provider.fetchedAt, null);
  assert.deepEqual(provider.analyses, {});
  f.manager.dispose();
});

test('unattributed stale reader data cannot enter the current account view or history', async () => {
  const history = {};
  const manager = new QuotaManager({ readers: [{ id: 'codex', label: 'Codex', interval: 180,
    read: async () => ({ status: 'ready', planLabel: 'Old account', fetchedAt: start, stale: true, fiveHour: { usedPercent: 95 } }) }],
    store: { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), history, notice: null, savePreferences: async () => {}, saveHistory: async () => {} },
    notify: () => assert.fail('unattributed notification') });
  await manager.refresh('manual');
  const provider = manager.getState().providers[0];
  assert.equal(provider.status, 'temporarily-unavailable');
  assert.equal(provider.planLabel, null);
  assert.equal(provider.fetchedAt, null);
  assert.deepEqual(provider.windows, []);
  assert.deepEqual(history, {});
  manager.dispose();
});

test('a service-status response started before a channel toggle cannot publish after re-enabling', async () => {
  let resolveStatus!: (status: 'major') => void;
  const manager = new QuotaManager({ readers: [{ id: 'codex', label: 'Codex', interval: 180,
    statusUrl: 'https://example.test/', read: async () => ({ status: 'not-signed-in' }) }],
    store: { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), history: {}, notice: null, savePreferences: async () => {}, saveHistory: async () => {} },
    notify: () => {}, fetchStatus: () => new Promise(resolve => { resolveStatus = resolve; }) });
  const pending = manager.refreshStatus();
  await manager.setPreferences({ channels: { codex: false } });
  await manager.setPreferences({ channels: { codex: true } });
  resolveStatus('major');
  await pending;
  assert.equal(manager.getState().providers[0].service, null);
  manager.dispose();
});

test('expiration timestamps never promise a reset in threshold notifications', async () => {
  let time = start, usedPercent = 60;
  const notifications: QuotaNotification[] = [];
  const manager = new QuotaManager({ now: () => time, monotonic: () => time * 1000,
    readers: [{ id: 'qoder', label: 'Qoder', interval: 300, read: async () => markQuotaIdentity({ status: 'ready', fetchedAt: time,
      limits: [{ id: 'credits', label: 'Credits', usedPercent, resetsAt: start + 86400 }] }, 'qoder-account') }],
    store: { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), history: {}, notice: null, savePreferences: async () => {}, saveHistory: async () => {} },
    notify: value => { notifications.push(value); } });
  await manager.refresh('manual');
  time += 300; usedPercent = 95;
  await manager.refresh('manual');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].resetsAt, null);
  manager.dispose();
});

test('query completion time advances for cached and failed reads without changing valid sample time', async () => {
  let time = start, fail = false;
  const history: Record<string, QuotaSample[]> = {};
  const manager = new QuotaManager({ now: () => time, monotonic: () => time * 1000,
    readers: [{ id: 'codex', label: 'Codex', interval: 180, read: async () => markQuotaIdentity(fail
      ? { status: 'unavailable', message: 'offline' }
      : { status: 'ready', fetchedAt: start, fiveHour: { usedPercent: 60, resetsAt: start + 18000 } }, 'one') }],
    store: { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), history, notice: null,
      savePreferences: async () => {}, saveHistory: async () => {} }, notify: () => {} });
  assert.equal(manager.getState().providers[0].queriedAt, null);
  await manager.refresh('manual');
  assert.equal(manager.getState().providers[0].queriedAt, start);
  time += 15;
  await manager.refresh('manual');
  let provider = manager.getState().providers[0];
  assert.equal(provider.queriedAt, time);
  assert.equal(provider.fetchedAt, start);
  assert.equal(Object.values(history)[0].length, 1);
  fail = true; time += 15;
  await manager.refresh('manual');
  provider = manager.getState().providers[0];
  assert.equal(provider.queriedAt, time);
  assert.equal(provider.fetchedAt, start);
  assert.equal(provider.stale, true);
  assert.equal(Object.values(history)[0].length, 1);
  manager.dispose();
});

test('a manual refresh after a completed request is not silently skipped by the background debounce', async () => {
  const f = fixture();
  await f.manager.refresh('manual');
  f.set({ time: start + 1 });
  await f.manager.refresh('manual');
  assert.equal(f.calls(), 2);
  f.manager.dispose();
});

test('concurrent manual refreshes share the request and publish its completion time', async () => {
  let time = start, calls = 0, finish!: (value: unknown) => void;
  const manager = new QuotaManager({ now: () => time, monotonic: () => time * 1000,
    readers: [{ id: 'codex', label: 'Codex', interval: 180, read: () => {
      calls++; return new Promise(resolve => { finish = resolve; });
    } }],
    store: { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), history: {}, notice: null,
      savePreferences: async () => {}, saveHistory: async () => {} }, notify: () => {} });
  const first = manager.refresh('manual');
  const second = manager.refresh('manual');
  assert.equal(calls, 1);
  assert.equal(manager.getState().providers[0].queriedAt, null);
  time += 5;
  finish(markQuotaIdentity({ status: 'ready', fetchedAt: start,
    fiveHour: { usedPercent: 60, resetsAt: start + 18000 } }, 'one'));
  await Promise.all([first, second]);
  assert.equal(manager.getState().providers[0].queriedAt, time);
  manager.dispose();
});
