import assert from 'node:assert/strict';
import test from 'node:test';
import { quotaTraySummary, quotaPopoverBounds } from './tray-quota';
import { normalizeQuotaSnapshot } from '../shared/quota-analysis';
import { mapAntigravityModels } from '../shared/antigravity-subscription';
import { mapOpenCodeUsage } from '../shared/opencode-subscription';

test('tray risk ignores stale and monetary balances and names the limiting quota', () => {
  const a = normalizeQuotaSnapshot('codex', 'Codex', { status: 'ready', fiveHour: { usedPercent: 95 } });
  const b = normalizeQuotaSnapshot('claude', 'Claude', { status: 'ready', stale: true, fiveHour: { usedPercent: 100 } });
  assert.deepEqual(quotaTraySummary([a, b]), { level: 2, text: 'Codex 5h 剩余 5%' });
});
test('all model pools survive normalization and the exhausted fourth pool determines tray risk', () => {
  const limits = mapAntigravityModels({ data: { models: {
    a: { label: 'Same name', quotaInfo: { remainingFraction: 0.9 } },
    b: { label: 'Same name', quotaInfo: { remainingFraction: 0.8 } },
    c: { label: 'Third', quotaInfo: { remainingFraction: 0.4 } },
    d: { label: 'Fourth', quotaInfo: { remainingFraction: 0 } },
  } } });
  const provider = normalizeQuotaSnapshot('antigravity', 'Antigravity', { status: 'ready', limits });
  assert.deepEqual(provider.windows.map(row => row.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(quotaTraySummary([provider]), { level: 2, text: 'Antigravity Fourth 剩余 0%' });
});
test('the OpenCode monthly pool survives normalization and participates in risk without a guessed month length', () => {
  const mapped = mapOpenCodeUsage({ usage: { rolling: { percent: 0 }, weekly: { percent: 40 }, monthly: { percent: 99, resetsAt: 1_900_000_000 } } });
  const provider = normalizeQuotaSnapshot('opencode', 'OpenCode', { ...mapped, status: 'ready' });
  assert.deepEqual(provider.windows.map(row => row.id), ['five-hour', 'weekly', 'monthly']);
  assert.equal(provider.windows[2].durationSeconds, null);
  assert.deepEqual(quotaTraySummary([provider]), { level: 2, text: 'OpenCode 月限额 剩余 1%' });
});
test('popover fits a secondary work area and a taskbar with unavailable icon bounds', () => {
  const work = { x: -800, y: 0, width: 800, height: 600 };
  const bounds = quotaPopoverBounds({ x: -20, y: 600, width: 20, height: 20 }, work, 430, 700);
  assert.ok(bounds.x >= -794 && bounds.x + bounds.width <= -6);
  assert.ok(bounds.y >= 6 && bounds.y + bounds.height <= 594);
  const fallback = quotaPopoverBounds({ x: 0, y: 0, width: 0, height: 0 }, work, 430, 300);
  assert.equal(fallback.x + fallback.width, -6);
  assert.equal(fallback.y + fallback.height, 594);
});
