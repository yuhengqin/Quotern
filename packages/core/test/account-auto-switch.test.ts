import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeQuotaSnapshot } from '../src/quota/shared/quota-analysis.js';
import { DEFAULT_QUOTA_PREFERENCES, type QuotaState } from '../src/quota/shared/quota.js';
import { readLaunchPreferences, setDefaultLaunchProfile, setAutoSwitchClaude } from '../src/quota/account-launch.js';
import { createAccountAutoSwitcher } from '../src/quota/account-auto-switch.js';

const now = 1793000000;
async function fixture(t: test.TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-auto-switch-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const profiles = ['one', 'two'].map(id => ({ id, provider: 'claude' as const, label: id, directory: join(dir, id), enabled: true }));
  for (const p of profiles) await mkdir(p.directory);
  const providers = profiles.map((profile, i) => {
    const p = normalizeQuotaSnapshot('claude', profile.label, { status: 'ready', fetchedAt: now, windows: [{ id: 'five-hour', label: '5h', usedPercent: i ? 10 : 100, resetsAt: now + 3600 }, { id: 'weekly', label: '7d', usedPercent: 20, resetsAt: now + 86400 }] });
    p.id = `claude@${profile.id}`; p.providerId = 'claude'; p.provenance = { source: 'native', observer: 'fixture', observedAt: now, identityVerified: true, accountRef: String(i + 1).repeat(64) };
    return p;
  });
  const state: QuotaState = { providers, preferences: { ...DEFAULT_QUOTA_PREFERENCES, profiles }, notice: null };
  const quotaDirectory = join(dir, 'quota');
  const selected = await setDefaultLaunchProfile(dir, quotaDirectory, state, 'claude', 'one', (await readLaunchPreferences(dir)).revision);
  await setAutoSwitchClaude(dir, true, selected.revision);
  return { dir, quotaDirectory, state };
}

test('only exhausted known shared pools rotate to a fresh distinct native profile, once', async t => {
  const f = await fixture(t);
  const run = createAccountAutoSwitcher(f.dir, f.quotaDirectory, 'cli', { now: () => now, isOwner: async () => true, isActive: () => true, getState: () => f.state, verify: async () => true, isolated: false });
  await run();
  const first = await readLaunchPreferences(f.dir);
  assert.equal(first.defaults.claude?.profileId, 'two'); assert.equal(first.lastSwitch?.reason, 'exhausted');
  await run(); assert.equal((await readLaunchPreferences(f.dir)).revision, first.revision);
});

test('a canonical default-directory reading can select its independently verified additional profile', async t => {
  const f = await fixture(t);
  f.state.providers.unshift({ ...structuredClone(f.state.providers[1]!), id: 'claude' });
  await createAccountAutoSwitcher(f.dir, f.quotaDirectory, 'cli', { now: () => now, isOwner: async () => true, isActive: () => true, getState: () => f.state, verify: async () => true, isolated: false })();
  assert.equal((await readLaunchPreferences(f.dir)).defaults.claude?.profileId, 'two');
});

test('stale, refreshing, unknown identity, duplicate and exhausted candidates cannot rotate the default', async t => {
  const f = await fixture(t);
  const original = structuredClone(f.state.providers[1]!);
  for (const patch of [{ stale: true }, { refreshing: true }, { fetchedAt: now - 901 }, { provenance: { ...original.provenance!, identityVerified: false } }, { provenance: f.state.providers[0]!.provenance }, { provenance: { ...original.provenance!, source: 'omp' as const } }, { windows: original.windows.map(w => ({ ...w, usedPercent: 100 })) }, { windows: original.windows.slice(0, 1) }]) {
    f.state.providers[1] = { ...structuredClone(original), ...patch };
    await createAccountAutoSwitcher(f.dir, f.quotaDirectory, 'cli', { now: () => now, isOwner: async () => true, isActive: () => true, getState: () => f.state, verify: async () => true, isolated: false })();
    assert.equal((await readLaunchPreferences(f.dir)).defaults.claude?.profileId, 'one');
  }
});

test('owner loss, pause, isolated development and manual selection during verification cancel rotation', async t => {
  const f = await fixture(t);
  for (const condition of ['owner', 'paused', 'isolated', 'manual'] as const) {
    let active = true, owner = true;
    const run = createAccountAutoSwitcher(f.dir, f.quotaDirectory, 'cli', { now: () => now, isOwner: async () => owner, isActive: () => active, getState: () => f.state, isolated: condition === 'isolated', verify: async () => {
      if (condition === 'owner') owner = false;
      if (condition === 'paused') active = false;
      if (condition === 'manual') await setAutoSwitchClaude(f.dir, false, (await readLaunchPreferences(f.dir)).revision);
      return true;
    } });
    await run(); assert.equal((await readLaunchPreferences(f.dir)).defaults.claude?.profileId, 'one');
  }
});
