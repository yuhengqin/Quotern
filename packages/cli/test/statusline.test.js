import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const api = await import('../dist/statusline.js').catch(() => ({}));
function line(payload, report = null) {
  assert.equal(typeof api.formatStatusline, 'function');
  return api.formatStatusline(payload, report, 'en');
}
test('statusline prefers host cost and current context; zero cost is valid', () => {
  const value = line({ model: { display_name: 'Claude Test' }, cost: { total_cost_usd: 0 }, context_window: { context_window_size: 200000, current_usage: { input_tokens: 1000, cache_read_input_tokens: 99000 } } });
  assert.match(value, /session \$0\.00.*host/i);
  assert.match(value, /50%/);
  assert.match(value, /today.*unknown/i);
});
test('statusline sanitizes host labels and never turns missing context into zero', () => {
  const value = line({ model: { display_name: '\x1b[31mClaude\nEVIL\x1b[0m' }, cost: { total_cost_usd: -1 } });
  assert.equal(/[\x00-\x1f\x7f]/.test(value), false);
  assert.match(value, /context.*unknown/i);
  assert.doesNotMatch(value, /\$-1/);
});
test('statusline keeps local priced subtotal and unpriced coverage distinct', () => {
  const value = line({}, { summary: { costUsd: null, knownCostUsd: 1.25 }, coverage: { lastSyncAt: '2026-10-18T00:00:00Z' } });
  assert.match(value, /\$1\.25/);
  assert.match(value, /subtotal/i);
  assert.match(value, /local/i);
});

test('statusline reports host cache observations and near-full context without inventing causes', () => {
  const value = line({ context_window: { used_percentage: 91 }, prompt_cache: { hit_ratio: 0.73, warm: false, caching_observed: true, last_miss_at: Date.now() / 1000, last_miss_cause: { causes: ['tools_changed'] } } });
  assert.match(value, /cache 73%/i);
  assert.match(value, /cold/i);
  assert.match(value, /compact/i);
  assert.match(value, /possible.*tools changed/i);
  assert.doesNotMatch(line({ prompt_cache: { hit_ratio: null, last_miss_cause: null } }), /cache 0%|possible/i);
  assert.match(line({ prompt_cache: { hit_ratio: 0 } }), /cache 0%/i);
  assert.doesNotMatch(line({ prompt_cache: { hit_ratio: 7, last_miss_cause: { causes: ['secret\nvalue'] } } }), /cache 700%|secret/);
});

test('statusline context growth compares only recent samples from the same session and ignores compaction', () => {
  const now = 1793940000000;
  assert.equal(typeof api.contextSample, 'function');
  const payload = { session_id: 'session-a', context_window: { used_percentage: 68 } };
  const previous = { sessionId: 'session-a', percent: 48, at: now - 60000 };
  assert.match(api.formatStatusline(payload, null, 'en', previous, now), /growing quickly/i);
  assert.doesNotMatch(api.formatStatusline(payload, null, 'en', { ...previous, sessionId: 'session-b' }, now), /growing quickly/i);
  assert.doesNotMatch(api.formatStatusline(payload, null, 'en', { ...previous, at: now - 3600000 }, now), /growing quickly/i);
  assert.doesNotMatch(api.formatStatusline(payload, null, 'en', { ...previous, percent: 80 }, now), /growing quickly/i);
  assert.equal(api.contextSample({ session_id: 'a', context_window: { used_percentage: null } }, now), null);
});

test('piped statusline tolerates malformed stdin without creating runtime state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-statusline-'));
  try {
    for (const input of ['{broken', JSON.stringify({ model: { display_name: 'Test' }, cost: { total_cost_usd: 0 } })]) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/quotern.js', import.meta.url)), 'statusline', '--data-dir', dir, '--lang', 'en'], { input, encoding: 'utf8', windowsHide: true, timeout: 10000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim().split(/\r?\n/).length, 1);
      assert.match(result.stdout, /today unknown/);
      assert.deepEqual(await readdir(dir), []);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('optional cached quota distinguishes stale readings, account selection and expiry', () => {
  const quota = { stale: false, providers: [{ id: 'claude@work', status: 'ready', stale: false, windows: [{ id: 'five-hour', kind: 'percentage', usedPercent: 72, periodSeconds: 18000, resetsAt: 5800, timeKind: 'reset', stale: false }] }] };
  const options = { quota, showQuota: true, showReset: true, account: 'claude@work', preset: 'compact' };
  const value = api.formatStatusline({}, null, 'en', null, 1000000, options);
  assert.match(value, /monitored account claude@work/); assert.match(value, /28% left/); assert.match(value, /reset 80m/);
  quota.providers[0].windows[0].stale = true;
  assert.match(api.formatStatusline({}, null, 'en', null, 1000000, options), /stale/);
  assert.match(api.formatStatusline({}, null, 'en', null, 1000000, { ...options, account: 'claude@missing' }), /quota unknown/);
});

test('preview is deterministic in shape, does not wait for stdin or write state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-statusline-preview-'));
  try {
    const args = [fileURLToPath(new URL('../bin/quotern.js', import.meta.url)), 'statusline', '--preview', '--quota', '--reset', '--preset', 'compact', '--track-context', '--data-dir', dir, '--lang', 'en'];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /28% left/); assert.match(result.stdout, /context 62%/); assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
