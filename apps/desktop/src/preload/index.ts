/**
 * Preload bridge for quotern-desktop.
 *
 * Exposes a small, audited surface to the renderer via `contextBridge`:
 *  - window controls (minimize / maximize / close)
 *  - tud.api.request → in-process local-api (same contract as CLI :8452)
 *  - tud.onDataSynced → Core poll / sync watcher refresh
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  AUTO_UPDATE_ACK_COMPLETED_CHANNEL,
  AUTO_UPDATE_CHECK_CHANNEL,
  AUTO_UPDATE_GET_STATE_CHANNEL,
  AUTO_UPDATE_INSTALL_CHANNEL,
  AUTO_UPDATE_STATE_CHANGED_CHANNEL,
  type AutoUpdateState,
} from '../shared/auto-update';
import {
  DASHBOARD_RANGE_CHANGED_CHANNEL,
  DASHBOARD_RANGE_GET_CHANNEL,
  DASHBOARD_RANGE_SET_CHANNEL,
  isDashboardRange,
  type DashboardRange,
} from '../shared/dashboard-range';
import { isThemeMode, type Theme, type ThemeMode } from '../shared/theme';
import { SHARE_BACKGROUNDS_CHANNEL, type SavedShareBackground, type ShareBackgroundRequest } from '../shared/share-backgrounds';
import {
  TRAY_USAGE_CHANGED_CHANNEL,
  TRAY_USAGE_GET_CHANNEL,
  TRAY_USAGE_MODE_CHANGED_CHANNEL,
  TRAY_USAGE_MODE_GET_CHANNEL,
  TRAY_USAGE_MODE_SET_CHANNEL,
  TRAY_USAGE_SET_CHANNEL,
  isTrayUsageMode,
  type TrayUsageMode,
} from '../shared/tray-usage';
import type { CodexSubscriptionSnapshot } from '../shared/codex-subscription';
import type { ClaudeSubscriptionSnapshot } from '../shared/claude-subscription';
import type { CursorSubscriptionSnapshot } from '../shared/cursor-subscription';
import type { CopilotSubscriptionSnapshot } from '../shared/copilot-subscription';
import type { GrokSubscriptionSnapshot } from '../shared/grok-subscription';
import type { KimiSubscriptionSnapshot } from '../shared/kimi-subscription';
import type { ZcodeSubscriptionSnapshot } from '../shared/zcode-subscription';
import type { AntigravitySubscriptionSnapshot } from '../shared/antigravity-subscription';
import type { QoderSubscriptionSnapshot } from '../shared/qoder-subscription';
import type { MiniMaxSubscriptionSnapshot } from '../shared/minimax-subscription';
import type { DeepSeekSubscriptionSnapshot } from '../shared/deepseek-subscription';
import type { OpenCodeSubscriptionSnapshot } from '../shared/opencode-subscription';
import type { TraeSubscriptionSnapshot } from '../shared/trae-subscription';
import type { WorkBuddySubscriptionSnapshot } from '../shared/workbuddy-subscription';
import {
  PET_CATALOG_CHANNEL,
  PET_COMMAND_CHANNEL,
  PET_EVENT_CHANNEL,
  PET_GET_CHANNEL,
  PET_SET_CHANNEL,
  PET_STATE_CHANNEL,
  type PetCatalogRequest,
  type PetSettingPatch,
  type PetState,
} from '../shared/pet';

const API_REQUEST_CHANNEL = 'tud:api-request';
const DATA_SYNCED_CHANNEL = 'tud:data-synced';
const OPEN_SETTINGS_CHANNEL = 'app:open-settings';
const RUNTIME_NOTICE_CHANNEL = 'app:runtime-notice';
const OPEN_EXTERNAL_CHANNEL = 'shell:open-external';
const TRAY_POPOVER_RESIZE_CHANNEL = 'tray-popover:resize';
const THEME_GET_CHANNEL = 'theme:get';
const THEME_SET_CHANNEL = 'theme:set';
const THEME_CHANGED_CHANNEL = 'theme:changed';
const AUTOSTART_GET_CHANNEL = 'autostart:get';
const AUTOSTART_SET_CHANNEL = 'autostart:set';
const AUTOSTART_GET_HIDDEN_CHANNEL = 'autostart:get-hidden';
const AUTOSTART_SET_HIDDEN_CHANNEL = 'autostart:set-hidden';
const SHARE_CARD_COPY_IMAGE_CHANNEL = 'share-card:copy-image';
const CODEX_SUBSCRIPTION_GET_CHANNEL = 'codex-subscription:get';
const CLAUDE_SUBSCRIPTION_GET_CHANNEL = 'claude-subscription:get';
const CURSOR_SUBSCRIPTION_GET_CHANNEL = 'cursor-subscription:get';
const COPILOT_SUBSCRIPTION_GET_CHANNEL = 'copilot-subscription:get';
const GROK_SUBSCRIPTION_GET_CHANNEL = 'grok-subscription:get';
const KIMI_SUBSCRIPTION_GET_CHANNEL = 'kimi-subscription:get';
const ZCODE_SUBSCRIPTION_GET_CHANNEL = 'zcode-subscription:get';
const ANTIGRAVITY_SUBSCRIPTION_GET_CHANNEL = 'antigravity-subscription:get';
const QODER_SUBSCRIPTION_GET_CHANNEL = 'qoder-subscription:get';
const MINIMAX_SUBSCRIPTION_GET_CHANNEL = 'minimax-subscription:get';
const DEEPSEEK_SUBSCRIPTION_GET_CHANNEL = 'deepseek-subscription:get';
const OPENCODE_SUBSCRIPTION_GET_CHANNEL = 'opencode-subscription:get';
const TRAE_GLOBAL_SUBSCRIPTION_GET_CHANNEL = 'trae-global-subscription:get';
const TRAE_CN_SUBSCRIPTION_GET_CHANNEL = 'trae-cn-subscription:get';
const WORKBUDDY_GLOBAL_SUBSCRIPTION_GET_CHANNEL = 'workbuddy-global-subscription:get';
const WORKBUDDY_MAINLAND_SUBSCRIPTION_GET_CHANNEL = 'workbuddy-mainland-subscription:get';

type SettingsTabId = 'sync' | 'app';

async function requestShareBackgrounds(request: ShareBackgroundRequest): Promise<SavedShareBackground[]> {
  try {
    return await ipcRenderer.invoke(SHARE_BACKGROUNDS_CHANNEL, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : '背景图库请求失败，请重试';
    throw new Error(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
  }
}

const tudApi = {
  version: () => '0.1.0',
  platform: process.platform,

  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  showMainWindow: () => ipcRenderer.send('window:show'),
  quit: () => ipcRenderer.send('app:quit'),

  pet: {
    getState: (): Promise<PetState> => ipcRenderer.invoke(PET_GET_CHANNEL),
    setSettings: (patch: PetSettingPatch): Promise<PetState> => ipcRenderer.invoke(PET_SET_CHANNEL, patch),
    catalog: (request: PetCatalogRequest): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke(PET_CATALOG_CHANNEL, request),
    command: (command: string): void => ipcRenderer.send(PET_COMMAND_CHANNEL, command),
    onState: (callback: (state: PetState) => void) => {
      const listener = (_event: unknown, state: PetState) => callback(state);
      ipcRenderer.on(PET_STATE_CHANNEL, listener);
      return () => ipcRenderer.removeListener(PET_STATE_CHANNEL, listener);
    },
    onEvent: (callback: (event: { type: string; detail?: unknown }) => void) => {
      const listener = (_event: unknown, value: { type: string; detail?: unknown }) => callback(value);
      ipcRenderer.on(PET_EVENT_CHANNEL, listener);
      return () => ipcRenderer.removeListener(PET_EVENT_CHANNEL, listener);
    },
  },

  getAutoUpdateState: (): Promise<AutoUpdateState> =>
    ipcRenderer.invoke(AUTO_UPDATE_GET_STATE_CHANNEL),

  checkForUpdates: (): Promise<AutoUpdateState> =>
    ipcRenderer.invoke(AUTO_UPDATE_CHECK_CHANNEL),

  installDownloadedUpdate: (): Promise<AutoUpdateState> =>
    ipcRenderer.invoke(AUTO_UPDATE_INSTALL_CHANNEL),

  acknowledgeUpdateCompleted: (): Promise<void> =>
    ipcRenderer.invoke(AUTO_UPDATE_ACK_COMPLETED_CHANNEL),

  onAutoUpdateStateChanged: (
    callback: (state: AutoUpdateState) => void,
  ) => {
    const listener = (_event: unknown, state: AutoUpdateState) => callback(state);
    ipcRenderer.on(AUTO_UPDATE_STATE_CHANGED_CHANNEL, listener);
    return () =>
      ipcRenderer.removeListener(AUTO_UPDATE_STATE_CHANGED_CHANNEL, listener);
  },

  copyImageToClipboard: (dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke(SHARE_CARD_COPY_IMAGE_CHANNEL, dataUrl),
  shareBackgrounds: {
    legacy: (): Promise<SavedShareBackground[]> => requestShareBackgrounds({ operation: 'legacy' }),
  },

  getCodexSubscription: (options?: { forceRefresh?: boolean }): Promise<CodexSubscriptionSnapshot> =>
    ipcRenderer.invoke(CODEX_SUBSCRIPTION_GET_CHANNEL, options),

  getClaudeSubscription: (options?: {
    allowCredentialAccess?: boolean;
    forceRefresh?: boolean;
  }): Promise<ClaudeSubscriptionSnapshot> =>
    ipcRenderer.invoke(CLAUDE_SUBSCRIPTION_GET_CHANNEL, options),

  getCursorSubscription: (): Promise<CursorSubscriptionSnapshot> =>
    ipcRenderer.invoke(CURSOR_SUBSCRIPTION_GET_CHANNEL),

  getCopilotSubscription: (): Promise<CopilotSubscriptionSnapshot> =>
    ipcRenderer.invoke(COPILOT_SUBSCRIPTION_GET_CHANNEL),

  getGrokSubscription: (): Promise<GrokSubscriptionSnapshot> =>
    ipcRenderer.invoke(GROK_SUBSCRIPTION_GET_CHANNEL),

  getKimiSubscription: (options?: { forceRefresh?: boolean }): Promise<KimiSubscriptionSnapshot[]> =>
    ipcRenderer.invoke(KIMI_SUBSCRIPTION_GET_CHANNEL, options),

  getZcodeSubscription: (): Promise<ZcodeSubscriptionSnapshot> =>
    ipcRenderer.invoke(ZCODE_SUBSCRIPTION_GET_CHANNEL),

  getAntigravitySubscription: (): Promise<AntigravitySubscriptionSnapshot> =>
    ipcRenderer.invoke(ANTIGRAVITY_SUBSCRIPTION_GET_CHANNEL),

  getQoderSubscription: (): Promise<QoderSubscriptionSnapshot> =>
    ipcRenderer.invoke(QODER_SUBSCRIPTION_GET_CHANNEL),

  getMiniMaxSubscription: (options?: { forceRefresh?: boolean }): Promise<MiniMaxSubscriptionSnapshot> =>
    ipcRenderer.invoke(MINIMAX_SUBSCRIPTION_GET_CHANNEL, options),

  getDeepSeekSubscription: (options?: { forceRefresh?: boolean }): Promise<DeepSeekSubscriptionSnapshot> =>
    ipcRenderer.invoke(DEEPSEEK_SUBSCRIPTION_GET_CHANNEL, options),

  getOpenCodeSubscription: (options?: { forceRefresh?: boolean }): Promise<OpenCodeSubscriptionSnapshot> =>
    ipcRenderer.invoke(OPENCODE_SUBSCRIPTION_GET_CHANNEL, options),

  getTraeGlobalSubscription: (options?: { forceRefresh?: boolean }): Promise<TraeSubscriptionSnapshot> =>
    ipcRenderer.invoke(TRAE_GLOBAL_SUBSCRIPTION_GET_CHANNEL, options),

  getTraeCnSubscription: (options?: { forceRefresh?: boolean }): Promise<TraeSubscriptionSnapshot> =>
    ipcRenderer.invoke(TRAE_CN_SUBSCRIPTION_GET_CHANNEL, options),

  getWorkBuddyGlobalSubscription: (options?: { forceRefresh?: boolean }): Promise<WorkBuddySubscriptionSnapshot> =>
    ipcRenderer.invoke(WORKBUDDY_GLOBAL_SUBSCRIPTION_GET_CHANNEL, options),

  getWorkBuddyMainlandSubscription: (options?: { forceRefresh?: boolean }): Promise<WorkBuddySubscriptionSnapshot> =>
    ipcRenderer.invoke(WORKBUDDY_MAINLAND_SUBSCRIPTION_GET_CHANNEL, options),


  /** Open http(s) links in the OS default browser. */
  openExternal: (
    url: string,
  ): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),

  /**
   * Ask the main process to re-height the tray popover. Main owns the bounds
   * because it also has to re-anchor the window to the tray icon; the renderer
   * only knows how tall its content wants to be.
   */
  resizeTrayPopover: (height: number) =>
    ipcRenderer.send(TRAY_POPOVER_RESIZE_CHANNEL, height),

  getDashboardRange: (): Promise<DashboardRange> =>
    ipcRenderer.invoke(DASHBOARD_RANGE_GET_CHANNEL),

  setDashboardRange: (range: DashboardRange): Promise<DashboardRange> =>
    ipcRenderer.invoke(DASHBOARD_RANGE_SET_CHANNEL, range),

  onDashboardRange: (callback: (range: DashboardRange) => void) => {
    const listener = (_event: unknown, range: unknown) => {
      if (isDashboardRange(range)) callback(range);
    };
    ipcRenderer.on(DASHBOARD_RANGE_CHANGED_CHANNEL, listener);
    return () => ipcRenderer.removeListener(DASHBOARD_RANGE_CHANGED_CHANNEL, listener);
  },

  getTheme: (): Promise<{ mode: ThemeMode; resolved: Theme }> =>
    ipcRenderer.invoke(THEME_GET_CHANNEL),

  setThemeMode: (mode: ThemeMode) =>
    ipcRenderer.send(THEME_SET_CHANNEL, mode),

  onThemeChanged: (
    callback: (state: { mode: ThemeMode; resolved: Theme }) => void,
  ) => {
    const listener = (
      _event: unknown,
      state: { mode: ThemeMode; resolved: Theme },
    ) => {
      if (isThemeMode(state?.mode) && (state.resolved === 'light' || state.resolved === 'dark')) {
        callback(state);
      }
    };
    ipcRenderer.on(THEME_CHANGED_CHANNEL, listener);
    return () => ipcRenderer.removeListener(THEME_CHANGED_CHANNEL, listener);
  },

  getOpenAtLogin: (): Promise<boolean> =>
    ipcRenderer.invoke(AUTOSTART_GET_CHANNEL),

  setOpenAtLogin: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke(AUTOSTART_SET_CHANNEL, enabled),

  getLaunchHidden: (): Promise<boolean> =>
    ipcRenderer.invoke(AUTOSTART_GET_HIDDEN_CHANNEL),

  setLaunchHidden: (hidden: boolean): Promise<boolean> =>
    ipcRenderer.invoke(AUTOSTART_SET_HIDDEN_CHANNEL, hidden),

  getShowTrayUsage: (): Promise<boolean> =>
    ipcRenderer.invoke(TRAY_USAGE_GET_CHANNEL),

  setShowTrayUsage: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke(TRAY_USAGE_SET_CHANNEL, enabled),

  getTrayUsageMode: (): Promise<TrayUsageMode> =>
    ipcRenderer.invoke(TRAY_USAGE_MODE_GET_CHANNEL),

  setTrayUsageMode: (mode: TrayUsageMode): Promise<TrayUsageMode> =>
    ipcRenderer.invoke(TRAY_USAGE_MODE_SET_CHANNEL, mode),

  onTrayUsageModeChanged: (callback: (mode: TrayUsageMode) => void) => {
    const listener = (_event: unknown, mode: unknown) => {
      if (isTrayUsageMode(mode)) callback(mode);
    };
    ipcRenderer.on(TRAY_USAGE_MODE_CHANGED_CHANNEL, listener);
    return () => ipcRenderer.removeListener(TRAY_USAGE_MODE_CHANGED_CHANNEL, listener);
  },

  onTrayUsageChanged: (callback: (enabled: boolean) => void) => {
    const listener = (_event: unknown, enabled: unknown) => {
      if (typeof enabled === 'boolean') {
        callback(enabled);
      }
    };
    ipcRenderer.on(TRAY_USAGE_CHANGED_CHANNEL, listener);
    return () => ipcRenderer.removeListener(TRAY_USAGE_CHANGED_CHANNEL, listener);
  },


  /**
   * Returns an unsubscribe function. Always prefer this over leaking
   * listeners across re-renders.
   */
  onMaximized: (callback: (isMaximized: boolean) => void) => {
    const listener = (_event: unknown, isMaximized: boolean) =>
      callback(Boolean(isMaximized));
    ipcRenderer.on('window:is-maximized', listener);
    return () => ipcRenderer.removeListener('window:is-maximized', listener);
  },

  api: {
    /**
     * In-process local-api call. `path` looks like `/functions/tud-usage-daily?days=7`.
     * Returns `{ status, body }` where `body` is the envelope JSON.
     */
    request: (
      path: string,
      init?: {
        method?: string;
        body?: string;
        headers?: Record<string, string>;
      },
    ): Promise<{ status: number; body: unknown }> =>
      ipcRenderer.invoke(API_REQUEST_CHANNEL, path, init),
  },

  onDataSynced: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(DATA_SYNCED_CHANNEL, listener);
    return () => ipcRenderer.removeListener(DATA_SYNCED_CHANNEL, listener);
  },

  /**
   * Main → renderer: tray menu asks to open settings.
   * Optional `tab` selects the settings panel section.
   */
  onOpenSettings: (
    callback: (detail?: {
      tab?: SettingsTabId;
    }) => void,
  ) => {
    const listener = (_event: unknown, detail: unknown) => {
      if (!detail || typeof detail !== 'object') {
        callback();
        return;
      }
      const raw = detail as {
        tab?: unknown;
      };
      const next: {
        tab?: SettingsTabId;
            } = {};
      if (raw.tab === 'sync' || raw.tab === 'app') {
        next.tab = raw.tab;
      }
      callback(next);
    };
    ipcRenderer.on(OPEN_SETTINGS_CHANNEL, listener);
    return () => ipcRenderer.removeListener(OPEN_SETTINGS_CHANNEL, listener);
  },

  onRuntimeNotice: (
    callback: (detail: { kind: 'config-reset'; tokenSalvaged: boolean }) => void,
  ) => {
    const listener = (_event: unknown, detail: unknown) => {
      if (!detail || typeof detail !== 'object') return;
      const raw = detail as { kind?: unknown; tokenSalvaged?: unknown };
      if (raw.kind !== 'config-reset') return;
      callback({
        kind: 'config-reset',
        tokenSalvaged: raw.tokenSalvaged === true,
      });
    };
    ipcRenderer.on(RUNTIME_NOTICE_CHANNEL, listener);
    return () => ipcRenderer.removeListener(RUNTIME_NOTICE_CHANNEL, listener);
  },
};

contextBridge.exposeInMainWorld('tud', tudApi);

export type TudApi = typeof tudApi;
