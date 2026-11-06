import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQuotaServiceSummary, selectQuotaServiceStatus } from '../src/quota/shared/quota-service.js';
import { DEFAULT_QUOTA_PREFERENCES } from '../src/quota/shared/quota.js';
import { QuotaManager } from '../src/quota/readers/quota-manager.js';
import { validQuotaPatch } from '../src/quota/readers/quota-store.js';

const url = 'https://status.claude.com/';
function summary(indicator = 'major') {
  return { status: { indicator }, components: [
    { id: 'code', name: 'Claude Code', status: 'operational' },
    { id: 'api', name: 'Claude API', status: indicator === 'none' ? 'operational' : 'partial_outage' },
  ], incidents: indicator === 'none' ? [] : [{ id: 'incident1', name: 'API requests fail', impact: 'major', status: 'investigating',
    updated_at: '2026-11-06T00:00:00Z', components: [{ id: 'api' }], incident_updates: [{ body: 'Working on a fix', status: 'identified', created_at: '2026-11-06T00:01:00Z' }] }] };
}
test('service summaries retain incident updates and filter only the selected components', () => {
  const service = parseQuotaServiceSummary(summary(), url, 100);
  assert.equal(service.incidents?.[0].body, 'Working on a fix');
  assert.equal(service.incidents?.[0].url, `${url}incidents/incident1`);
  assert.equal(selectQuotaServiceStatus(service, ['code']).level, 'operational');
  assert.equal(selectQuotaServiceStatus(service, ['code']).incidents?.length, 0);
  assert.equal(selectQuotaServiceStatus(service, ['api']).level, 'major');
  assert.equal(selectQuotaServiceStatus(service, []).level, 'unknown');
  assert.equal(selectQuotaServiceStatus(service, []).selectionEmpty, true);
  assert.equal(selectQuotaServiceStatus(service, ['removed']).level, 'unknown');
});
test('malformed summaries and unknown component statuses cannot report recovery', () => {
  assert.throws(() => parseQuotaServiceSummary({ status: { indicator: 'bad' } }, url, 100));
  const raw = summary('none'); raw.components[0].status = 'new-state';
  assert.equal(selectQuotaServiceStatus(parseQuotaServiceSummary(raw, url, 100), ['code']).level, 'unknown');
  assert.equal(selectQuotaServiceStatus(parseQuotaServiceSummary(raw, url, 100)).level, 'unknown');
  raw.components[0].status = 'constructor';
  assert.equal(selectQuotaServiceStatus(parseQuotaServiceSummary(raw, url, 100), ['code']).level, 'unknown');
  assert.equal(validQuotaPatch({ serviceComponents: { claude: [] }, serviceAlerts: true, resetTimeMode: 'countdown' }), true);
  assert.equal(validQuotaPatch({ serviceComponents: { unknown: ['code'] } }), false);
  assert.equal(validQuotaPatch({ serviceComponents: { claude: ['code', 'code'] } }), false);
});

test('changing one provider filter does not erase another provider recovery baseline', async () => {
  let time = 100, indicator = 'major';
  const alerts: string[] = [];
  const manager = new QuotaManager({ now: () => time, monotonic: () => time * 1000,
    readers: [{ id: 'claude', label: 'Claude', interval: 300, statusUrl: url, read: async () => ({ status: 'not-signed-in' }) }],
    store: { preferences: { ...DEFAULT_QUOTA_PREFERENCES, serviceAlerts: true }, history: {}, notice: null, savePreferences: async () => {}, saveHistory: async () => {} },
    notify() {}, notifyService: value => alerts.push(value.level), fetchStatus: async () => parseQuotaServiceSummary(summary(indicator), url, time),
  });
  await manager.refreshStatus();
  await manager.setPreferences({ serviceComponents: { codex: ['api'] }, channels: { cursor: false } });
  time += 901; indicator = 'none'; await manager.refreshStatus();
  assert.deepEqual(alerts, ['operational']);
  manager.dispose();
});
test('service polling deduplicates profiles and alerts, retains stale data, and resets filter baselines', async () => {
  let time = 100, calls = 0, indicator = 'none', fail = false;
  const alerts: string[] = [];
  const manager = new QuotaManager({ now: () => time, monotonic: () => time * 1000,
    readers: ['one', 'two'].map(key => ({ id: 'claude' as const, key, label: 'Claude', interval: 300, statusUrl: url, read: async () => ({ status: 'not-signed-in' }) })),
    store: { preferences: { ...DEFAULT_QUOTA_PREFERENCES, serviceAlerts: true }, history: {}, notice: null, savePreferences: async () => {}, saveHistory: async () => {} },
    notify() {}, notifyService: value => alerts.push(value.level),
    fetchStatus: async () => { calls++; if (fail) throw new Error('offline'); return parseQuotaServiceSummary(summary(indicator), url, time); },
  });
  await manager.refreshStatus(); assert.equal(calls, 1); assert.deepEqual(alerts, []);
  time += 901; indicator = 'major'; await manager.refreshStatus(); assert.deepEqual(alerts, ['major']);
  time += 901; await manager.refreshStatus(); assert.equal(alerts.length, 1);
  time += 901; fail = true; await manager.refreshStatus();
  assert.equal(manager.getState().providers[0].service?.stale, true);
  assert.equal(manager.getState().providers[0].service?.incidents?.length, 1);
  await manager.setPreferences({ serviceComponents: { claude: ['code'] } });
  time += 901; fail = false; await manager.refreshStatus(); assert.equal(alerts.length, 1);
  await manager.setPreferences({ serviceComponents: { claude: ['api'] } });
  time += 901; await manager.refreshStatus(); assert.equal(alerts.length, 1);
  time += 901; indicator = 'none'; await manager.refreshStatus(); assert.deepEqual(alerts, ['major', 'operational']);
  manager.dispose();
});
