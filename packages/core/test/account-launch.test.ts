import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionTerminalLaunch } from '../src/session-actions.js';
import { readLaunchPreferences, setDefaultLaunchProfile, setAutoSwitchClaude, resolveLaunchProfile, registerLaunchSource } from '../src/quota/account-launch.js';
import { DEFAULT_QUOTA_PREFERENCES, type QuotaState } from '../src/quota/shared/quota.js';
import { normalizeQuotaSnapshot } from '../src/quota/shared/quota-analysis.js';

test('profile bindings are applied inside each terminal, after shell startup', () => {
  const directory = "/tmp/账号 ' $(bad) %PATH%", bindings = { CLAUDE_CONFIG_DIR: directory, ANTHROPIC_API_KEY: null };
  const mac = sessionTerminalLaunch('/tmp', '/usr/local/bin/claude', [], 'darwin', {}, bindings);
  assert.deepEqual(mac.args.slice(-6), ['/tmp', '/usr/bin/env', '-u', 'ANTHROPIC_API_KEY', `CLAUDE_CONFIG_DIR=${directory}`, '/usr/local/bin/claude']);
  const linux = sessionTerminalLaunch('/tmp', '/usr/bin/claude', [], 'linux', {}, bindings);
  assert.deepEqual(linux.args.slice(-6), ['/tmp', '/usr/bin/env', '-u', 'ANTHROPIC_API_KEY', `CLAUDE_CONFIG_DIR=${directory}`, '/usr/bin/claude']);
  const windows = sessionTerminalLaunch('C:/work', 'C:/bin/claude.exe', [], 'win32', {}, bindings);
  const outer = Buffer.from(windows.args.at(-1)!, 'base64').toString('utf16le');
  const encoded = /'-EncodedCommand','([^']+)'/.exec(outer)![1]!;
  const inner = Buffer.from(encoded, 'base64').toString('utf16le');
  assert.ok(inner.includes("$env:ANTHROPIC_API_KEY = $null"));
  assert.ok(inner.includes("$env:CLAUDE_CONFIG_DIR = '/tmp/账号 '' $(bad) %PATH%'"));
});

async function fixture(t: test.TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-launch-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const quotaDirectory = join(dir, 'quota'), profileDirectory = join(dir, "account ' & %PATH%");
  await mkdir(quotaDirectory); await mkdir(profileDirectory);
  const profile = { id: 'work', provider: 'claude' as const, label: 'Work', directory: profileDirectory, enabled: true };
  const state: QuotaState = { providers: [], notice: null, preferences: { ...DEFAULT_QUOTA_PREFERENCES, profiles: [profile] } };
  await writeFile(join(quotaDirectory, 'preferences.json'), JSON.stringify(state.preferences));
  await registerLaunchSource(dir, 'cli', quotaDirectory);
  return { dir, quotaDirectory, profileDirectory, profile, state };
}

test('default selection pins the chosen profile and uses its config directory without copying credentials', async t => {
  const f = await fixture(t), initial = await readLaunchPreferences(f.dir);
  assert.equal(initial.autoSwitchClaude, false);
  const saved = await setDefaultLaunchProfile(f.dir, f.quotaDirectory, f.state, 'claude', 'work', initial.revision);
  assert.equal(saved.defaults.claude?.profileId, 'work');
  const selected = await resolveLaunchProfile(f.dir, 'claude');
  assert.equal(selected?.directory, f.profileDirectory);
  assert.equal(selected?.label, 'Work');
  assert.notEqual(saved.revision, initial.revision);
  await assert.rejects(setAutoSwitchClaude(f.dir, true, initial.revision), /LAUNCH_CONFLICT/);
  await assert.rejects(setAutoSwitchClaude(f.dir, true, saved.revision), /LAUNCH_IDENTITY_REQUIRED/);
  assert.equal((await readLaunchPreferences(f.dir)).autoSwitchClaude, false);
});

test('removed, paused or retargeted defaults do not silently launch another account', async t => {
  const f = await fixture(t), initial = await readLaunchPreferences(f.dir);
  await setDefaultLaunchProfile(f.dir, f.quotaDirectory, f.state, 'claude', 'work', initial.revision);
  for (const profiles of [[], [{ ...f.profile, enabled: false }], [{ ...f.profile, directory: f.dir }]]) {
    await writeFile(join(f.quotaDirectory, 'preferences.json'), JSON.stringify({ profiles }));
    await assert.rejects(resolveLaunchProfile(f.dir, 'claude'), /LAUNCH_PROFILE_CHANGED/);
  }
});

test('enabling after initial identity loading binds the fresh selected account, without reselecting it', async t => {
  const f = await fixture(t), now = Date.now() / 1000;
  const selected = await setDefaultLaunchProfile(f.dir, f.quotaDirectory, f.state, 'claude', 'work', 'initial');
  const reading = normalizeQuotaSnapshot('claude', 'Work', { status: 'ready', fetchedAt: now, windows: [] });
  reading.id = 'claude@work'; reading.provenance = { source: 'native', observer: 'fixture', observedAt: now, identityVerified: true, accountRef: '1'.repeat(64) };
  f.state.providers.push(reading);
  const enabled = await setAutoSwitchClaude(f.dir, true, selected.revision, { state: f.state, quotaDirectory: f.quotaDirectory, now });
  assert.equal(enabled.autoSwitchClaude, true); assert.equal(enabled.defaults.claude?.accountRef, '1'.repeat(64));
});

test('explicit profiles resolve through registered runtime sources, with no default required', async t => {
  const f = await fixture(t);
  assert.equal((await resolveLaunchProfile(f.dir, 'claude', { profileId: 'work', runtime: 'cli' }))?.directory, f.profileDirectory);
  assert.equal(await resolveLaunchProfile(f.dir, 'codex'), null);
  await assert.rejects(resolveLaunchProfile(f.dir, 'codex', { profileId: 'work', runtime: 'cli' }), /LAUNCH_PROFILE_UNAVAILABLE/);
  await assert.rejects(setAutoSwitchClaude(f.dir, true, (await readLaunchPreferences(f.dir)).revision), /LAUNCH_DEFAULT_REQUIRED/);
});
