import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { agentTransaction, readAgentJson, writeAgentJson } from '../agent/preferences.js';
import { readRuntimeOwner } from '../runtime-pid.js';
import { existingSessionDirectory, findSessionExecutable, launchResolvedTerminal, type TerminalBindings } from '../session-actions.js';
import { guiCliEnvironment } from './readers/cli-runtime.js';
import { validQuotaProfiles } from './readers/quota-store.js';
import type { QuotaState, QuotaProfile } from './shared/quota.js';
import type { LaunchPreferences, LaunchProvider, LaunchSelection } from './shared/account-launch.js';

export type { LaunchPreferences, LaunchProvider, LaunchSelection } from './shared/account-launch.js';
const preferencesFile = (dataDir: string) => join(dataDir, 'account-launch', 'preferences.json');
const sameDirectory = (a: string, b: string) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
export const validLaunchProvider = (value: unknown): value is LaunchProvider => value === 'claude' || value === 'codex';
export const validLaunchProfileId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(value);

export async function readLaunchPreferences(dataDir: string): Promise<LaunchPreferences> {
  const value = await readAgentJson<LaunchPreferences>(preferencesFile(dataDir), { revision: 'initial', defaults: {}, autoSwitchClaude: false, lastSwitch: null });
  if (!value || typeof value.revision !== 'string' || typeof value.autoSwitchClaude !== 'boolean' || !value.defaults || typeof value.defaults !== 'object' || Array.isArray(value.defaults)) throw new Error('LAUNCH_INVALID_SETTINGS');
  for (const [provider, selected] of Object.entries(value.defaults)) {
    if (!validLaunchProvider(provider) || !selected || !validLaunchProfileId(selected.profileId) || typeof selected.label !== 'string'
      || typeof selected.directory !== 'string' || !isAbsolute(selected.directory) || typeof selected.quotaDirectory !== 'string' || !isAbsolute(selected.quotaDirectory)
      || (selected.accountRef !== null && !/^[a-f0-9]{64}$/.test(selected.accountRef))) throw new Error('LAUNCH_INVALID_SETTINGS');
  }
  return value;
}

export async function updateLaunchPreferences(dataDir: string, revision: string, update: (preferences: LaunchPreferences) => Promise<LaunchPreferences>): Promise<LaunchPreferences> {
  return agentTransaction(preferencesFile(dataDir), async () => {
    const current = await readLaunchPreferences(dataDir);
    if (current.revision !== revision) throw new Error('LAUNCH_CONFLICT');
    const next = await update(structuredClone(current));
    next.revision = randomUUID();
    await writeAgentJson(preferencesFile(dataDir), next);
    return next;
  });
}

export async function registerLaunchSource(dataDir: string, runtime: 'cli' | 'desktop', directory: string): Promise<void> {
  const file = join(dataDir, 'account-launch', 'sources.json');
  await agentTransaction(file, async () => {
    const sources = await readAgentJson<Record<string, { directory: string; at: number }>>(file, {});
    sources[runtime] = { directory: resolve(directory), at: Date.now() };
    await writeAgentJson(file, sources);
  });
}

export async function readLaunchProfiles(quotaDirectory: string): Promise<QuotaProfile[]> {
  try {
    const bytes = await readFile(join(quotaDirectory, 'preferences.json'));
    if (bytes.length > 128 * 1024) throw new Error();
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || !validQuotaProfiles(value.profiles ?? [])) throw new Error();
    return value.profiles ?? [];
  } catch { throw new Error('LAUNCH_PROFILE_UNAVAILABLE'); }
}

export async function profileSelection(quotaDirectory: string, state: QuotaState, provider: LaunchProvider, profileId: string): Promise<LaunchSelection> {
  const profile = state.preferences.profiles?.find(p => p.id === profileId && p.provider === provider && p.enabled);
  if (!profile) throw new Error('LAUNCH_PROFILE_UNAVAILABLE');
  const directory = await existingSessionDirectory(profile.directory);
  if (!directory) throw new Error('LAUNCH_DIRECTORY_UNAVAILABLE');
  const proof = state.providers.find(p => p.id === `${provider}@${profileId}`)?.provenance;
  return { profileId, label: profile.label, directory, quotaDirectory: resolve(quotaDirectory), accountRef: proof?.source === 'native' && proof.identityVerified ? proof.accountRef ?? null : null };
}

export async function setDefaultLaunchProfile(dataDir: string, quotaDirectory: string, state: QuotaState, provider: LaunchProvider, profileId: string | null, revision: string): Promise<LaunchPreferences> {
  const selected = profileId === null ? null : await profileSelection(quotaDirectory, state, provider, profileId);
  return updateLaunchPreferences(dataDir, revision, async current => {
    const from = current.defaults[provider]?.label ?? null;
    if (selected) current.defaults[provider] = selected; else delete current.defaults[provider];
    if (provider === 'claude') {
      if (!selected?.accountRef) current.autoSwitchClaude = false;
      current.lastSwitch = { from, to: selected?.label ?? null, at: Date.now() / 1000, reason: 'manual' };
    }
    return current;
  });
}

export async function setAutoSwitchClaude(dataDir: string, enabled: boolean, revision: string, context?: { state: QuotaState; quotaDirectory: string; now?: number }): Promise<LaunchPreferences> {
  return updateLaunchPreferences(dataDir, revision, async current => {
    if (enabled && !current.defaults.claude) throw new Error('LAUNCH_DEFAULT_REQUIRED');
    if (enabled && context) {
      const saved = current.defaults.claude!, now = context.now ?? Date.now() / 1000;
      const fresh = await profileSelection(context.quotaDirectory, context.state, 'claude', saved.profileId);
      if (!sameDirectory(saved.quotaDirectory, fresh.quotaDirectory) || !sameDirectory(saved.directory, fresh.directory)) throw new Error('LAUNCH_PROFILE_CHANGED');
      const reading = context.state.providers.find(p => p.id === `claude@${saved.profileId}`);
      if (!fresh.accountRef || reading?.status !== 'ready' || reading.stale || reading.refreshing || reading.fetchedAt == null || reading.fetchedAt < now - 900 || reading.fetchedAt > now + 60) throw new Error('LAUNCH_IDENTITY_REQUIRED');
      current.defaults.claude = fresh;
    }
    if (enabled && !current.defaults.claude?.accountRef) throw new Error('LAUNCH_IDENTITY_REQUIRED');
    current.autoSwitchClaude = enabled;
    return current;
  });
}

export async function resolveLaunchProfile(dataDir: string, provider: LaunchProvider, options: { profileId?: string; runtime?: 'cli' | 'desktop' } = {}): Promise<(QuotaProfile & { accountRef: string | null }) | null> {
  const preferences = await readLaunchPreferences(dataDir), selected = preferences.defaults[provider];
  if (!options.profileId && !selected) return null;
  let quotaDirectory = selected?.quotaDirectory;
  if (options.profileId) {
    const sources = await readAgentJson<Partial<Record<'cli' | 'desktop', { directory: string; at: number }>>>(join(dataDir, 'account-launch', 'sources.json'), {});
    const runtime = options.runtime ?? (await readRuntimeOwner(dataDir))?.kind;
    quotaDirectory = (runtime ? sources[runtime] : Object.values(sources).sort((a, b) => b.at - a.at)[0])?.directory ?? join(dataDir, 'quota');
  }
  if (!quotaDirectory || !isAbsolute(quotaDirectory)) throw new Error('LAUNCH_PROFILE_UNAVAILABLE');
  const profiles = await readLaunchProfiles(quotaDirectory);
  const profile = profiles.find(p => p.id === (options.profileId ?? selected?.profileId) && p.provider === provider && p.enabled);
  const directory = profile && await existingSessionDirectory(profile.directory);
  if (!profile || !directory || !options.profileId && !sameDirectory(directory, selected!.directory)) throw new Error(options.profileId ? 'LAUNCH_PROFILE_UNAVAILABLE' : 'LAUNCH_PROFILE_CHANGED');
  return { ...profile, directory, accountRef: options.profileId ? null : selected!.accountRef };
}

/** Clear inherited authentication overrides only for an explicitly chosen account. */
export function profileLaunchBindings(provider: LaunchProvider, directory: string): TerminalBindings {
  const clear = provider === 'claude'
    ? ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']
    : ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY', 'CODEX_AUTH_TOKEN', 'CODEX_CHATGPT_BASE_URL'];
  return { ...Object.fromEntries(clear.map(key => [key, null])), [provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']: directory };
}

export async function launchAccountTerminal(provider: LaunchProvider, profile: Pick<QuotaProfile, 'directory'> | null, cwd = homedir(), args: readonly string[] = []): Promise<void> {
  const directory = await existingSessionDirectory(cwd);
  if (!directory) throw new Error('LAUNCH_DIRECTORY_UNAVAILABLE');
  const env = guiCliEnvironment();
  // The home directory contains legitimate ~/.local/bin installations. A neutral
  // discovery root avoids rejecting every per-user installation for UI launches.
  const executable = await findSessionExecutable(provider, sameDirectory(directory, homedir()) ? tmpdir() : directory, env);
  if (!executable) throw new Error('SESSION_CLI_UNAVAILABLE');
  await launchResolvedTerminal(directory, executable, args, env, profile ? profileLaunchBindings(provider, profile.directory) : {});
}
