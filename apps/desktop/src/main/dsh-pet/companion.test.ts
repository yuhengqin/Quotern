import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDshPetCompanion } from './companion.js';
import { toPetStats } from '../pet-core.js';

test('missing usage remains unknown and never appears as a zero bill', () => {
  const view = buildDshPetCompanion(null, null);
  assert.equal(view.connected, false);
  assert.match(view.hoverText, /不可用/);
  assert.doesNotMatch(view.hoverText, /0|\$/);
});

test('incomplete session coverage does not become a claimed zero conversation count', () => {
  const stats = toPetStats({ todayTokens: 100 }, {}, {}, '2026-10-22', { sessionCount: 20, complete: false });
  const view = buildDshPetCompanion({ stats, connected: true, syncing: false, locale: 'zh-CN' }, null);
  assert.ok(view.quips.every(text => !/会话.*0/.test(text)));
});

test('existing usage snapshots produce localized statistics without calling estimates bills or balances', () => {
  const stats = toPetStats({ todayTokens: 12345, todayCostUsd: .42 }, { days: [{ date: '2026-10-22', tokens: 12345 }] }, { models: [{ model: 'Model A', source: 'codex', tokens: 12345, pct: 100 }] }, '2026-10-22', { sessionCount: 3, complete: true });
  for (const locale of ['zh-CN', 'en', 'ja', 'ko']) {
    const view = buildDshPetCompanion({ stats, connected: true, syncing: false, locale }, null);
    assert.match(view.hoverText, /tokens/);
    assert.match(view.hoverText, /USD \$0.42/);
    assert.doesNotMatch(view.hoverText, /账单|bill|余额|balance/i);
    assert.ok(view.quips.some(text => text.includes('Model A')));
    assert.ok(view.quips.length > 6);
    assert.ok(view.labels?.settings);
  }
});
