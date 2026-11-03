import assert from 'node:assert/strict';
import test from 'node:test';
import { buildToolModelUsage, buildProjectModelUsage, aggregateUsage } from './dashboard-mock-data.ts';
import { formatDashboardMetricCompact } from './dashboard-metric-format.ts';
import { i18n } from 'quotern-i18n';
import { setTokenUnitMode } from './utils.ts';

test('both projections retain sub-cent amounts after merging sources and normalized projects', async () => {
  const { buildToolModelUsage: desktopTools, buildProjectModelUsage: desktopProjects } = await import(new URL('../../../../apps/desktop/src/renderer/lib/dashboard-mock-data.ts', import.meta.url).href);
  for (const build of [buildToolModelUsage, desktopTools]) {
    const rows = build([{ source: 'codex', tokens: 5, costUsd: 0.004, models: [{ model: 'small', tokens: 5, costUsd: 0.004 }] }], 5);
    assert.equal(rows[0].costUsd, 0.004);
    assert.equal(rows[0].models[0].costUsd, 0.004);
  }
  for (const build of [buildProjectModelUsage, desktopProjects]) {
    const rows = build([1, 2].map(() => ({ project: 'small', tokens: 5, costUsd: 0.002, models: [{ source: 'codex', model: 'small', tokens: 5, costUsd: 0.002 }] })), 10);
    assert.equal(rows[0].costUsd, 0.004);
    assert.equal(rows[0].models[0].costUsd, 0.004);
  }
});

test('both chart centers keep currency precision, thresholds and unknown values', async () => {
  const { formatDashboardMetricCompact: desktopCompact } = await import(new URL('../../../../apps/desktop/src/renderer/lib/dashboard-metric-format.ts', import.meta.url).href);
  for (const format of [formatDashboardMetricCompact, desktopCompact]) {
    for (const [amount, expected] of [[715.06, '$715.06'], [3.08, '$3.08'], [0.004, '<$0.01'], [0, '$0'], [1.4, '$1.4'], [NaN, '—']] as const) {
      assert.equal(format('cost', amount), expected);
    }
  }
});

test('hourly totals retain raw costs for subsequent trend comparisons', () => {
  const row = { day: '周一' as const, hour: 0, hourLabel: '00:00', inputTokens: 1, cachedInputTokens: 0, outputTokens: 0, totalTokens: 1, costUsd: 0.002, durationMinutes: 0 };
  assert.equal(aggregateUsage([row, row]).totalCostUsd, 0.004);
});

test('number preference emits the configured display event without changing language', () => {
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const saved = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => saved.get(key), setItem: (key: string, value: string) => saved.set(key, value) } });
  let events = 0;
  const listen = () => { events++; };
  const language = i18n.language;
  i18n.on('displayPreferencesChanged', listen);
  try {
    setTokenUnitMode('international');
    assert.equal(events, 1);
    assert.equal(i18n.language, language);
    assert.match(i18n.options.react?.bindI18n as string, /displayPreferencesChanged/);
  } finally {
    i18n.off('displayPreferencesChanged', listen);
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
