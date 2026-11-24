import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreLegacyDisplayPreferences } from './legacy-display-preferences';

const token = 'quotern-token-unit-mode';
const range = 'tud.dashboardRange';
const custom = 'tud.dashboardCustomRange';
const dates = { start: '2026-11-17', end: '2026-11-19' };
const now = new Date('2026-11-24T00:00:00Z');
const memory = (values = new Map<string, string>()) => ({
  values,
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
});

test('restores allowlisted Electron preferences before the first dashboard load', async () => {
  const storage = memory();
  await restoreLegacyDisplayPreferences(storage, async () => ({
    [token]: 'international',
    [range]: '"last-30-days"',
    [custom]: JSON.stringify(dates),
    unrelated: 'never migrated',
  }), async () => 'today', now);
  assert.equal(storage.getItem(token), 'international');
  assert.equal(storage.getItem(range), '"last-30-days"');
  assert.deepEqual(JSON.parse(storage.getItem(custom)!), dates);
  assert.equal(storage.getItem('unrelated'), null);
});

test('preserves new WebView settings and only migrates once after a successful read', async () => {
  const storage = memory(new Map([[token, 'localized'], [custom, 'null']]));
  let reads = 0;
  const load = async () => {
    reads++;
    return { [token]: 'international', [custom]: JSON.stringify(dates), [range]: '"__proto__"' };
  };
  await restoreLegacyDisplayPreferences(storage, load, async () => 'last-7-days', now);
  await restoreLegacyDisplayPreferences(storage, load, async () => 'today', now);
  assert.equal(reads, 1);
  assert.equal(storage.getItem(token), 'localized');
  assert.equal(storage.getItem(custom), 'null');
  assert.equal(storage.getItem(range), '"last-7-days"');
});

test('a failed legacy snapshot can be retried without replacing settings already present', async () => {
  const storage = memory();
  await restoreLegacyDisplayPreferences(storage, async () => { throw Error('busy'); }, async () => 'today', now);
  assert.equal(storage.getItem(range), null);
  await restoreLegacyDisplayPreferences(storage, async () => ({ [range]: '"last-30-days"' }), async () => 'today', now);
  assert.equal(storage.getItem(range), '"last-30-days"');
});
