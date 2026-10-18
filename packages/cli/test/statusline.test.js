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
