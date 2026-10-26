import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recommendQuota } from '../src/quota/recommend.js';
import { formatQuotaPrompt } from '../src/quota/prompt.js';
import { projectQuotaReport, parseQuotaReport, type QuotaReport } from '../src/quota/report.js';
import { DEFAULT_QUOTA_PREFERENCES } from '../src/quota/shared/quota.js';
import { normalizeQuotaSnapshot } from '../src/quota/shared/quota-analysis.js';

const now = 1793000000;
const window = (id: string, usedPercent: number) => ({ id, kind: 'percentage' as const, usedPercent, balance: null, resetsAt: now + 3600, periodSeconds: 604800, timeKind: 'reset' as const, stale: false, forecast: null });
function report(): QuotaReport {
  return { schemaVersion: 1, availability: 'ready', runtime: 'cli', generatedAt: now, readAt: now, stale: false, providers: [
    { id: 'claude', canonicalId: 'claude', provider: 'claude', status: 'ready', label: 'Claude', fetchedAt: now, queriedAt: now, stale: false, source: 'native', identityVerified: true, diagnostic: null, details: [],
      windows: [window('five-hour', 20), window('weekly', 25), window('model:opus:weekly', 30), window('model:sonnet:weekly', 100)] },
  ] } as QuotaReport;
}
test('recommendation considers the exact target and shared limits, not unrelated model pools', () => {
  const value = report();
  const result = recommendQuota(value, { provider: 'claude', model: 'opus' });
  assert.equal(result.result, 'recommended'); assert.equal(result.recommendedId, 'claude');
  assert.equal(result.candidates[0].remainingPercent, 70);
  value.providers[0].windows[0].usedPercent = 100;
  assert.equal(recommendQuota(value, { provider: 'claude', model: 'opus' }).result, 'blocked');
});
test('Claude recommendations stay unknown when either shared window is missing', () => {
  for (const missing of ['five-hour', 'weekly']) {
    const value = report();
    value.providers[0].windows = value.providers[0].windows.filter(w => w.id !== missing);
    for (const target of [{ provider: 'claude' as const }, { provider: 'claude' as const, model: 'opus' }]) {
      const result = recommendQuota(value, target);
      assert.equal(result.result, 'unknown', `missing ${missing}`);
      assert.equal(result.recommendedId, null);
      assert.equal(result.candidates[0].reason, 'TARGET_SCOPE_UNKNOWN');
    }
  }
});
test('Codex keeps supported single account windows and checks every exact feature period', () => {
  const value = report(), p = value.providers[0]; p.provider = 'codex'; p.id = 'codex'; p.canonicalId = 'codex';
  p.windows = [window('account:604800', 10), window('feature:fast:18000', 20)];
  assert.equal(recommendQuota(value, { provider: 'codex', feature: 'fast' }).recommendedId, 'codex');
  p.windows.push(window('feature:fast:604800', 100));
  assert.equal(recommendQuota(value, { provider: 'codex', feature: 'fast' }).result, 'blocked');
});
test('unknown target, identity, failed reads, duplicates, legacy and stale observations never force a recommendation', () => {
  assert.equal(recommendQuota(report(), { provider: 'claude', model: 'future-model' }).result, 'unknown');
  for (const patch of [{ identityVerified: false }, { stale: true }, { canonicalId: null }, { source: 'omp' }, { status: 'access-denied' }, { diagnostic: { code: 'HTTP_401' } }]) {
    const value = report(); Object.assign(value.providers[0], { status: 'ready' }, patch);
    assert.equal(recommendQuota(value, { provider: 'claude', model: 'opus' }).recommendedId, null);
  }
  const value = report(); value.providers.push({ ...value.providers[0], id: 'claude@other' });
  assert.equal(recommendQuota(value, { provider: 'claude', model: 'opus' }).candidates.filter(c => c.result === 'eligible').length, 1);
});
test('safe projection deduplicates accounts with provider references without persisting private identity', () => {
  const p = normalizeQuotaSnapshot('claude', 'private label', { status: 'ready', fetchedAt: now, windows: [{ id: 'weekly', usedPercent: 1, resetsAt: now + 3600 }] });
  p.provenance = { source: 'native', observer: 'private', observedAt: now, identityVerified: true, accountRef: 'secret-email-hash' };
  const state = { providers: [p, { ...p, id: 'claude@copy' }], preferences: DEFAULT_QUOTA_PREFERENCES, notice: null };
  const result = projectQuotaReport(state, 'cli', now);
  assert.equal(result.providers[1].canonicalId, 'claude');
  assert.doesNotMatch(JSON.stringify(result), /secret-email-hash|private/);
  state.providers.push({ ...p, id: 'private/path', fetchedAt: now + 1 });
  assert.doesNotMatch(JSON.stringify(projectQuotaReport(state, 'cli', now)), /private\/path/);
  const legacy = JSON.parse(JSON.stringify(result)); delete legacy.providers[0].canonicalId;
  assert.equal(parseQuotaReport(legacy, 'cli', now).providers[0].canonicalId, null);
});
test('feature target matching does not confuse a colon-delimited feature with its prefix', () => {
  const value = report(), p = value.providers[0]; p.provider = 'codex'; p.id = 'codex'; p.canonicalId = 'codex';
  p.windows = [window('account:18000', 10), window('feature:fast:lane:18000', 20)];
  assert.equal(recommendQuota(value, { provider: 'codex', feature: 'fast' }).result, 'unknown');
  assert.equal(recommendQuota(value, { provider: 'codex', feature: 'fast:lane' }).recommendedId, 'codex');
});
test('terminal prompt is one bounded line and distinguishes stale, missing and actual zero', () => {
  const value = report(); assert.match(formatQuotaPrompt(value), /Claude.*80%/);
  value.providers[0].stale = true; assert.match(formatQuotaPrompt(value), /stale/);
  value.providers[0].stale = false; value.providers[0].windows = [window('weekly', 100)];
  assert.match(formatQuotaPrompt(value), /0%/);
  assert.match(formatQuotaPrompt({ ...value, availability: 'missing', providers: [] }), /unknown/);
  assert.ok(formatQuotaPrompt(value).length <= 512); assert.doesNotMatch(formatQuotaPrompt(value), /[\r\n\x1b]/);
});
