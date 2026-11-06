import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyWindowIdentity } from '../agent/window-identity.js';
import { readRuntimeOwner } from '../runtime-pid.js';
import { findSessionExecutable } from '../session-actions.js';
import { profileLaunchBindings, profileSelection, readLaunchPreferences, updateLaunchPreferences } from './account-launch.js';
import type { LaunchPreferences } from './shared/account-launch.js';
import type { QuotaProfile, QuotaState } from './shared/quota.js';
import { guiCliEnvironment } from './readers/cli-runtime.js';
import { projectQuotaReport } from './report.js';
import { recommendQuota } from './recommend.js';
import { quotaDirectoryKey } from './snapshot.js';

async function verify(profile: QuotaProfile, accountRef: string): Promise<boolean> {
  const cwd = await mkdtemp(join(tmpdir(), 'quotern-account-check-'));
  try {
    const env = guiCliEnvironment();
    for (const [key, value] of Object.entries(profileLaunchBindings(profile.provider, profile.directory))) { if (value === null) delete env[key]; else env[key] = value; }
    const executable = await findSessionExecutable(profile.provider, cwd, env);
    return Boolean(executable && await verifyWindowIdentity(profile.provider, accountRef, executable, cwd, env));
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

function candidate(state: QuotaState, preferences: LaunchPreferences, quotaDirectory: string, runtime: 'cli' | 'desktop', now: number) {
  const selected = preferences.defaults.claude;
  if (!preferences.autoSwitchClaude || !selected?.accountRef || quotaDirectoryKey(selected.quotaDirectory) !== quotaDirectoryKey(quotaDirectory)) return null;
  const profiles = state.preferences.profiles?.filter(p => p.provider === 'claude' && p.enabled) ?? [];
  const currentProfile = profiles.find(p => p.id === selected.profileId);
  if (!currentProfile || quotaDirectoryKey(currentProfile.directory) !== quotaDirectoryKey(selected.directory)) return null;
  const freshState = { ...state, providers: state.providers.map(p => ({ ...p, stale: p.stale || p.refreshing || p.fetchedAt === null || p.fetchedAt < now - 900 || p.fetchedAt > now + 60 })) };
  const current = freshState.providers.find(p => p.id === `claude@${selected.profileId}`);
  if (!current || current.stale || current.provenance?.accountRef !== selected.accountRef) return null;
  const report = projectQuotaReport(freshState, runtime, now), recommendations = recommendQuota(report, { provider: 'claude' });
  const canonical = report.providers.find(p => p.id === current.id)?.canonicalId;
  if (recommendations.candidates.find(p => p.id === canonical)?.result !== 'blocked') return null;
  for (const target of recommendations.candidates.filter(p => p.result === 'eligible')) {
    const accountRef = freshState.providers.find(p => p.id === target.id)?.provenance?.accountRef;
    if (!accountRef || accountRef === selected.accountRef) continue;
    for (const profile of profiles) {
      const reading = freshState.providers.find(p => p.id === `claude@${profile.id}` && p.provenance?.accountRef === accountRef);
      if (!reading) continue;
      // A canonical observation may come from the ordinary default directory.
      // The selected launch profile must independently pass all quota checks.
      const ownReport = projectQuotaReport({ ...freshState, providers: [reading] }, runtime, now);
      if (recommendQuota(ownReport, { provider: 'claude' }).candidates[0]?.result === 'eligible') return { profile, accountRef };
    }
  }
  return null;
}

export function createAccountAutoSwitcher(dataDir: string, quotaDirectory: string, runtime: 'cli' | 'desktop', deps: {
  getState(): QuotaState; isActive(): boolean; now?: () => number; isOwner?: () => Promise<boolean>;
  verify?: (profile: QuotaProfile, accountRef: string) => Promise<boolean>; isolated?: boolean;
}) {
  let pending = false;
  const now = deps.now ?? (() => Date.now() / 1000);
  const owner = deps.isOwner ?? (async () => { const value = await readRuntimeOwner(dataDir); return value?.pid === process.pid && value.kind === runtime; });
  return async () => {
    if (pending || (deps.isolated ?? process.env.QUOTERN_DEV_ISOLATED === '1') || !deps.isActive()) return;
    pending = true;
    try {
      if (!await owner()) return;
      const preferences = await readLaunchPreferences(dataDir), target = candidate(deps.getState(), preferences, quotaDirectory, runtime, now());
      if (!target || !await (deps.verify ?? verify)(target.profile, target.accountRef)) return;
      await updateLaunchPreferences(dataDir, preferences.revision, async current => {
        const state = deps.getState(), latest = candidate(state, current, quotaDirectory, runtime, now());
        if (!deps.isActive() || !await owner() || !latest || latest.profile.id !== target.profile.id || latest.accountRef !== target.accountRef || latest.profile.directory !== target.profile.directory) throw new Error('LAUNCH_CANCELLED');
        const selected = await profileSelection(quotaDirectory, state, 'claude', target.profile.id);
        if (!deps.isActive() || !await owner()) throw new Error('LAUNCH_CANCELLED');
        current.lastSwitch = { from: current.defaults.claude?.label ?? null, to: selected.label, at: now(), reason: 'exhausted' };
        current.defaults.claude = selected;
        return current;
      });
    } catch (error) {
      if (!(error instanceof Error) || !['LAUNCH_CONFLICT', 'LAUNCH_CANCELLED'].includes(error.message)) throw error;
    } finally { pending = false; }
  };
}
