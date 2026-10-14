import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureQuoternAppIdentity } from './app-identity.js';

function fixture(t: { after: (callback: () => void) => void }) {
  const base = mkdtempSync(join(tmpdir(), 'quotern-app-identity-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  // Electron derives this from package.json.name when productName is absent.
  let userData = join(base, 'quotern-desktop');
  let sessionData = userData;
  let name = '';
  return {
    base,
    app: {
      getPath: (_key: 'userData') => userData,
      setPath: (key: 'userData' | 'sessionData', path: string) => {
        if (key === 'userData') userData = path;
        else sessionData = path;
      },
      setName: (value: string) => { name = value; },
    },
    result: () => ({ userData, sessionData, name }),
  };
}

test('fresh installs use Quotern identity and userData', (t) => {
  const f = fixture(t);
  configureQuoternAppIdentity(f.app);
  assert.deepEqual(f.result(), {
    name: 'Quotern', userData: join(f.base, 'quotern-desktop'), sessionData: join(f.base, 'quotern-desktop'),
  });
});

test('existing Quotern profile keeps preferences, update state and session directory', (t) => {
  const f = fixture(t);
  configureQuoternAppIdentity(f.app);
  const profile = f.result().userData;
  writeFileSync(join(profile, 'desktop-prefs.json'), '{"theme":"dark"}');
  writeFileSync(join(profile, 'auto-update.json'), '{"version":"0.1.13"}');
  configureQuoternAppIdentity(f.app);
  assert.deepEqual(f.result(), { name: 'Quotern', userData: profile, sessionData: profile });
  assert.equal(readFileSync(join(profile, 'desktop-prefs.json'), 'utf8'), '{"theme":"dark"}');
  assert.equal(readFileSync(join(profile, 'auto-update.json'), 'utf8'), '{"version":"0.1.13"}');
});

test('development profile is selected before the single-instance lock and preserves production prefs', (t) => {
  const f = fixture(t);
  configureQuoternAppIdentity(f.app);
  const original = f.result().userData;
  writeFileSync(join(original, 'desktop-prefs.json'), 'production-prefs');
  const previous = process.env.QUOTERN_DESKTOP_USER_DATA;
  const previousMode = process.env.QUOTERN_DEV_ISOLATED;
  t.after(() => {
    if (previous == null) delete process.env.QUOTERN_DESKTOP_USER_DATA;
    else process.env.QUOTERN_DESKTOP_USER_DATA = previous;
    if (previousMode == null) delete process.env.QUOTERN_DEV_ISOLATED;
    else process.env.QUOTERN_DEV_ISOLATED = previousMode;
  });
  process.env.QUOTERN_DEV_ISOLATED = '1';
  process.env.QUOTERN_DESKTOP_USER_DATA = join(f.base, 'isolated-profile');
  configureQuoternAppIdentity(f.app);
  assert.equal(f.result().userData, join(f.base, 'isolated-profile'));
  assert.equal(f.result().sessionData, join(f.base, 'isolated-profile'));
  assert.equal(readFileSync(join(original, 'desktop-prefs.json'), 'utf8'), 'production-prefs');
});
