import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_QUOTA_PREFERENCES, type QuotaState } from '../../shared/quota.js';
import { quotaNotice, serviceNotice, isQuotaNoticeCurrent, resolveQuotaReminder } from './quota-notices.js';

const event = { provider: 'codex', providerId: 'codex@work', accountRef: 'a'.repeat(64), label: 'Codex · 工作', window: '5h', windowId: 'five-hour', windowLabel: '5h', windowPeriodSeconds: 18000, kind: 'threshold-90' as const, resetsAt: 2000, usedPercent: 95 };
function state(used = 95, reset = 2000): QuotaState {
  return { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), notice: null, providers: [{ id: 'codex@work', providerId: 'codex', label: 'Codex', status: 'ready', stale: false, refreshing: false, provenance: { source: 'native', observer: 'fixture', observedAt: 1000, identityVerified: true, accountRef: event.accountRef }, windows: [{ id: 'five-hour', label: '5h', usedPercent: used, resetsAt: reset }], details: [], analyses: {}, fetchedAt: 1000, queriedAt: 1000, nextRefreshAt: null, planLabel: null, resetCredits: null, message: null, service: null }] };
}
test('threshold, depletion and reset share one scope without merging accounts or windows', () => {
  const notice = quotaNotice(event, 'zh-CN', 1000000);
  assert.equal(quotaNotice({ ...event, kind: 'depleted' }, 'zh-CN', 1000000).replaceKey, notice.replaceKey);
  assert.equal(quotaNotice({ ...event, kind: 'reset', resetsAt: 3000 }, 'zh-CN', 1000000).replaceKey, notice.replaceKey);
  assert.notEqual(quotaNotice({ ...event, accountRef: 'b'.repeat(64) }, 'zh-CN').replaceKey, notice.replaceKey);
  assert.notEqual(quotaNotice({ ...event, windowId: 'weekly' }, 'zh-CN').replaceKey, notice.replaceKey);
});
test('fresh recovery, changed cycle and disabled rules retract old warnings; stale data does not assert recovery', () => {
  const notice = quotaNotice(event, 'zh-CN', 1000000);
  assert.equal(isQuotaNoticeCurrent(notice, state(), 1000000), true);
  assert.equal(isQuotaNoticeCurrent(notice, state(40), 1000000), false);
  assert.equal(isQuotaNoticeCurrent(notice, state(95, 3000), 1000000), false);
  const stale = state(40); stale.providers[0]!.stale = true;
  assert.equal(isQuotaNoticeCurrent(notice, stale, 1000000), true);
  const disabled = state(); disabled.preferences.thresholdAlerts = false;
  assert.equal(isQuotaNoticeCurrent(notice, disabled, 1000000), false);
  const reset = quotaNotice({ ...event, kind: 'reset', resetsAt: 3000, usedPercent: 1 }, 'zh-CN', 1000000);
  assert.equal(isQuotaNoticeCurrent(reset, state(1, 3000), 1000000), true);
  assert.equal(isQuotaNoticeCurrent(reset, state(1, 3000), 1600001), false);
});
test('service body explains severity, affected services and the latest incident in every supported language', () => {
  const value = { provider: 'claude', label: 'Claude', level: 'major' as const, url: 'https://status.claude.com/', components: [{ id: 'api', name: 'Claude API', level: 'major' as const }], incidents: [{ id: 'i', name: 'API requests fail', body: '<b>Working</b> on a fix\nnow', phase: 'identified', level: 'major' as const, componentIds: ['api'], updatedAt: 1000, url: 'https://status.claude.com/incidents/i' }] };
  for (const locale of ['zh-CN', 'en', 'ja', 'ko'] as const) {
    const notice = serviceNotice(value, locale, undefined, 1000000);
    assert.match(notice.body, /Claude API/); assert.match(notice.body, /API requests fail/); assert.match(notice.body, /Working on a fix now/);
    assert.doesNotMatch(notice.body, /<b>|notifications\./);
  }
});

test('disabling an account or changing its alert rule clears its warning without touching another scope', () => {
  const notice = quotaNotice(event, 'zh-CN', 1000000), changed = state();
  changed.preferences.accountAlerts = { [`codex:${event.accountRef}`]: { level: 'critical' } };
  assert.equal(isQuotaNoticeCurrent(notice, changed, 1000000), false);
  changed.preferences.accountAlerts = { [`codex:${'b'.repeat(64)}`]: { level: 'off' } };
  assert.equal(isQuotaNoticeCurrent(notice, changed, 1000000), true);
  changed.providers = [];
  assert.equal(isQuotaNoticeCurrent(notice, changed, 1000000), false);
});

test('service recovery and subscription changes clear old incidents without clearing the new recovery notice', () => {
  const notice = serviceNotice({ provider: 'codex', label: 'Codex', level: 'major', url: 'https://status.openai.com/' }, 'zh-CN', undefined, 1000000);
  const current = state(); current.providers[0]!.service = { level: 'operational', checkedAt: 1000, stale: false, url: 'https://status.openai.com/' };
  assert.equal(isQuotaNoticeCurrent(notice, current, 1000000), false);
  const recovery = serviceNotice({ provider: 'codex', label: 'Codex', level: 'operational', url: 'https://status.openai.com/' }, 'zh-CN', undefined, 1000000);
  assert.equal(isQuotaNoticeCurrent(recovery, current, 1000000), true);
  current.providers[0]!.service!.stale = true;
  assert.equal(isQuotaNoticeCurrent(notice, current, 1000000), true);
  current.preferences.serviceAlerts = false;
  assert.equal(isQuotaNoticeCurrent(notice, current, 1000000), false);
});

test('anonymous reader account switches invalidate old notices using only the runtime counter', () => {
  const notice = quotaNotice({ ...event, accountRef: undefined, notificationEpoch: 1 }, 'zh-CN', 1000000), current = state();
  current.providers[0]!.notificationEpoch = 1;
  assert.equal(isQuotaNoticeCurrent(notice, current, 1000000), true);
  current.providers[0]!.notificationEpoch = 2;
  assert.equal(isQuotaNoticeCurrent(notice, current, 1000000), false);
});

test('service reminder uses current same-severity components instead of the original incident', () => {
  const notice = serviceNotice({ provider: 'codex', label: 'Codex', level: 'major', url: 'https://status.openai.com/', components: [{ id: 'a', name: 'API A', level: 'major' }] }, 'zh-CN', undefined, 1000000);
  const current = state(); current.providers[0]!.service = { level: 'major', checkedAt: 1000, stale: false, url: 'https://status.openai.com/', components: [{ id: 'b', name: 'API B', level: 'major' }] };
  const refreshed = resolveQuotaReminder(notice, current, 'zh-CN', 1000000);
  assert.match(refreshed!.body, /API B/); assert.doesNotMatch(refreshed!.body, /API A/);
});

test('service truncation preserves the final emoji at a UTF-16 boundary', () => {
  const notice = serviceNotice({ provider: 'codex', label: 'Codex', level: 'major', url: 'https://status.openai.com/', incidents: [{ id: 'i', name: 'Incident', phase: 'identified', level: 'major', componentIds: [], updatedAt: 1, url: 'https://status.openai.com/', body: 'x'.repeat(219) + '🚨' }] }, 'zh-CN');
  assert.equal(Buffer.from(notice.body, 'utf8').toString('utf8'), notice.body);
  assert.match(notice.body, /🚨/);
});
