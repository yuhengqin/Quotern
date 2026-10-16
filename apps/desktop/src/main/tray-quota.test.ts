import assert from 'node:assert/strict';
import test from 'node:test';
import { quotaTraySummary, quotaPopoverBounds } from './tray-quota';
import { normalizeQuotaSnapshot } from '../shared/quota-analysis';

test('tray risk ignores stale and monetary balances and names the limiting quota', () => {
  const a = normalizeQuotaSnapshot('codex', 'Codex', { status: 'ready', fiveHour: { usedPercent: 95 } });
  const b = normalizeQuotaSnapshot('claude', 'Claude', { status: 'ready', stale: true, fiveHour: { usedPercent: 100 } });
  assert.deepEqual(quotaTraySummary([a, b]), { level: 2, text: 'Codex 5h 剩余 5%' });
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
