import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { desktopPreferences } from './preferences';

test('rapid date changes are compared in write order and publish their originating window', async t => {
  const profile = await mkdtemp(join(tmpdir(), 'quotern-desktop-preferences-'));
  t.after(() => rm(profile, { recursive: true, force: true }));
  await writeFile(join(profile, 'desktop-prefs.json'), '{"dashboardRange":"last-7-days"}');
  const events: unknown[][] = [];
  const prefs = await desktopPreferences(profile, (...args) => { events.push(args); });
  const setRange = prefs.channels.get('dashboard-range:set')!;
  await Promise.all([setRange('last-30-days', 'main'), setRange('last-7-days', 'main')]);
  await setRange('last-7-days', 'main');
  assert.equal(prefs.channels.get('dashboard-range:get')!(), 'last-7-days');
  assert.deepEqual(events, [
    ['dashboard-range:changed', 'last-30-days', 'main'],
    ['dashboard-range:changed', 'last-7-days', 'main'],
  ]);
});
