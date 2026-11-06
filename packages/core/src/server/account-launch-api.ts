import type { Hono } from 'hono';
import type { QuotaState } from '../quota/shared/quota.js';
import type { AccountLaunchView, LaunchProvider } from '../quota/shared/account-launch.js';
import { launchAccountTerminal, profileSelection, readLaunchPreferences, setAutoSwitchClaude, setDefaultLaunchProfile, validLaunchProfileId, validLaunchProvider } from '../quota/account-launch.js';
import { quotaDirectoryKey } from '../quota/snapshot.js';
import { ACCOUNT_LAUNCH_ROUTE, actionFailure, actionOk, createLocalActionApi } from './local-action-api.js';

export function registerAccountLaunchApi(parent: Hono, options: {
  dataDir: string; quotaDirectory: string; getState(): QuotaState | null;
  ipc?: boolean; launch?: typeof launchAccountTerminal;
}) {
  const { app, token } = createLocalActionApi('X-Quotern-Account-Action', options.ipc);
  let busy = false;
  const view = async (): Promise<AccountLaunchView> => {
    const preferences = await readLaunchPreferences(options.dataDir), profiles = options.getState()?.preferences.profiles ?? [];
    const selected: AccountLaunchView['selected'] = {}, unavailableDefaults: LaunchProvider[] = [];
    for (const provider of ['claude', 'codex'] as const) {
      const saved = preferences.defaults[provider];
      if (!saved) continue;
      const profile = profiles.find(p => p.id === saved.profileId && p.provider === provider && p.enabled);
      if (profile && quotaDirectoryKey(saved.quotaDirectory) === quotaDirectoryKey(options.quotaDirectory) && quotaDirectoryKey(profile.directory) === quotaDirectoryKey(saved.directory)) selected[provider] = saved.profileId;
      else unavailableDefaults.push(provider);
    }
    return { token, preferences, profiles, selected, unavailableDefaults, isolated: process.env.QUOTERN_DEV_ISOLATED === '1' };
  };
  app.onError((_error, c) => c.json(actionFailure('LAUNCH_REQUEST_FAILED'), 500));
  app.get('/', async c => c.json(actionOk(await view())));
  app.post('/', async c => {
    let body: Record<string, unknown>;
    try { body = await c.req.json(); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); }
    catch { return c.json(actionFailure('LOCAL_ACTION_INVALID'), 400); }
    const keys = body.action === 'launch' ? ['action', 'provider', 'profileId'] : body.action === 'default' ? ['action', 'provider', 'profileId', 'revision'] : body.action === 'auto-switch' ? ['action', 'enabled', 'revision'] : [];
    if (!keys.length || Object.keys(body).some(key => !keys.includes(key))
      || body.action !== 'launch' && typeof body.revision !== 'string'
      || body.action === 'auto-switch' && typeof body.enabled !== 'boolean'
      || body.action !== 'auto-switch' && (!validLaunchProvider(body.provider) || !(validLaunchProfileId(body.profileId) || body.action === 'default' && body.profileId === null))) return c.json(actionFailure('LOCAL_ACTION_INVALID'), 400);
    if (busy) return c.json(actionFailure('LAUNCH_PENDING'), 409);
    busy = true;
    try {
      const state = options.getState();
      if (!state) return c.json(actionFailure('QUOTA_UNAVAILABLE'), 503);
      if (body.action === 'launch') {
        const selection = await profileSelection(options.quotaDirectory, state, body.provider as LaunchProvider, body.profileId as string);
        await (options.launch ?? launchAccountTerminal)(body.provider as LaunchProvider, { directory: selection.directory });
      } else if (body.action === 'default') await setDefaultLaunchProfile(options.dataDir, options.quotaDirectory, state, body.provider as LaunchProvider, body.profileId as string | null, body.revision as string);
      else await setAutoSwitchClaude(options.dataDir, body.enabled as boolean, body.revision as string, { state, quotaDirectory: options.quotaDirectory });
      return c.json(actionOk(await view()));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code = /^(?:LAUNCH|SESSION_ACTION|SESSION_CLI)_[A-Z_]+$/.test(message) ? message : 'LAUNCH_REQUEST_FAILED';
      return c.json(actionFailure(code), code === 'LAUNCH_CONFLICT' ? 409 : 400);
    } finally { busy = false; }
  });
  parent.route(ACCOUNT_LAUNCH_ROUTE, app);
}
