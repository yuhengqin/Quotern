/**
 * Ambient global typings shared between preload and renderer.
 *
 * The preload script (src/preload/index.ts) calls
 * `contextBridge.exposeInMainWorld('tud', ...)`; the renderer reads it
 * off `window.tud`. Keeping the contract in a single ambient type makes
 * both ends stay in sync.
 */
declare global {
  interface Window {
    tud: {
      dshPet: import('../preload/index').TudApi['dshPet'];
      version: () => string;
      platform: NodeJS.Platform;
      quota: {
        getState: () => Promise<import('../shared/quota').QuotaState>;
        refresh: (provider?: string) => Promise<import('../shared/quota').QuotaState>;
        setPreferences: (patch: import('../shared/quota').QuotaPreferencePatch) => Promise<import('../shared/quota').QuotaState>;
        onChanged: (callback: (state: import('../shared/quota').QuotaState) => void) => () => void;
      };
      minimize: () => void;
      toggleMaximize: () => void;
      close: () => void;
      showMainWindow: () => void;
      quit: () => void;
      pet: import('../preload/index').TudApi['pet'];
      getAutoUpdateState: () => Promise<import('../shared/auto-update').AutoUpdateState>;
      checkForUpdates: () => Promise<import('../shared/auto-update').AutoUpdateState>;
      installDownloadedUpdate: () => Promise<import('../shared/auto-update').AutoUpdateState>;
      acknowledgeUpdateCompleted: () => Promise<void>;
      onAutoUpdateStateChanged: (
        callback: (state: import('../shared/auto-update').AutoUpdateState) => void,
      ) => () => void;
      copyImageToClipboard: (dataUrl: string) => Promise<boolean>;
      shareBackgrounds: {
        legacy: () => Promise<import('../shared/share-backgrounds').SavedShareBackground[]>;
      };
      getCodexSubscription: (options?: { forceRefresh?: boolean }) => Promise<
        import('../shared/codex-subscription').CodexSubscriptionSnapshot
      >;
      getClaudeSubscription: (options?: {
        allowCredentialAccess?: boolean;
        forceRefresh?: boolean;
      }) => Promise<
        import('../shared/claude-subscription').ClaudeSubscriptionSnapshot
      >;
      getCursorSubscription: () => Promise<
        import('../shared/cursor-subscription').CursorSubscriptionSnapshot
      >;
      getCopilotSubscription: () => Promise<
        import('../shared/copilot-subscription').CopilotSubscriptionSnapshot
      >;
      getGrokSubscription: () => Promise<
        import('../shared/grok-subscription').GrokSubscriptionSnapshot
      >;
      getKimiSubscription: (options?: { forceRefresh?: boolean }) => Promise<
        import('../shared/kimi-subscription').KimiSubscriptionSnapshot[]
      >;
      getZcodeSubscription: () => Promise<
        import('../shared/zcode-subscription').ZcodeSubscriptionSnapshot
      >;
      getAntigravitySubscription: () => Promise<
        import('../shared/antigravity-subscription').AntigravitySubscriptionSnapshot
      >;
      getQoderSubscription: () => Promise<
        import('../shared/qoder-subscription').QoderSubscriptionSnapshot
      >;
      getMiniMaxSubscription: (options?: { forceRefresh?: boolean }) => Promise<
        import('../shared/minimax-subscription').MiniMaxSubscriptionSnapshot
      >;
      getDeepSeekSubscription: (options?: { forceRefresh?: boolean }) => Promise<
        import('../shared/deepseek-subscription').DeepSeekSubscriptionSnapshot
      >;
      getOpenCodeSubscription: (options?: { forceRefresh?: boolean }) => Promise<
        import('../shared/opencode-subscription').OpenCodeSubscriptionSnapshot
      >;
      getTraeGlobalSubscription: (options?: { forceRefresh?: boolean }) => Promise<
        import('../shared/trae-subscription').TraeSubscriptionSnapshot
      >;
      getTraeCnSubscription: (options?: { forceRefresh?: boolean }) => Promise<
        import('../shared/trae-subscription').TraeSubscriptionSnapshot
      >;
      getWorkBuddyGlobalSubscription: (options?: { forceRefresh?: boolean }) => Promise<
        import('../shared/workbuddy-subscription').WorkBuddySubscriptionSnapshot
      >;
      getWorkBuddyMainlandSubscription: (options?: { forceRefresh?: boolean }) => Promise<
        import('../shared/workbuddy-subscription').WorkBuddySubscriptionSnapshot
      >;
      openExternal: (
        url: string,
      ) => Promise<{ ok: boolean; message?: string }>;
      resizeTrayPopover: (height: number) => void;
      getDashboardRange: () => Promise<
        import('../shared/dashboard-range').DashboardRange
      >;
      setDashboardRange: (
        range: import('../shared/dashboard-range').DashboardRange,
      ) => Promise<import('../shared/dashboard-range').DashboardRange>;
      onDashboardRange: (
        callback: (range: import('../shared/dashboard-range').DashboardRange) => void,
      ) => () => void;
      getTheme: () => Promise<{
        mode: import('../shared/theme').ThemeMode;
        resolved: import('../shared/theme').Theme;
      }>;
      getLocalePreference: () => Promise<import('../shared/locale').DesktopLocaleState>;
      setLocalePreference: (preference: import('quotern-i18n').LocalePreference) => Promise<void>;
      onLocaleChanged: (callback: (state: import('../shared/locale').DesktopLocaleState) => void) => () => void;
      setThemeMode: (mode: import('../shared/theme').ThemeMode) => void;
      onThemeChanged: (
        callback: (state: {
          mode: import('../shared/theme').ThemeMode;
          resolved: import('../shared/theme').Theme;
        }) => void,
      ) => () => void;
      getOpenAtLogin: () => Promise<boolean>;
      setOpenAtLogin: (enabled: boolean) => Promise<boolean>;
      getLaunchHidden: () => Promise<boolean>;
      setLaunchHidden: (hidden: boolean) => Promise<boolean>;
      getShowTrayUsage: () => Promise<boolean>;
      setShowTrayUsage: (enabled: boolean) => Promise<boolean>;
      onTrayUsageChanged: (callback: (enabled: boolean) => void) => () => void;
      getTrayUsageMode: () => Promise<import('../shared/tray-usage').TrayUsageMode>;
      setTrayUsageMode: (mode: import('../shared/tray-usage').TrayUsageMode) => Promise<import('../shared/tray-usage').TrayUsageMode>;
      onTrayUsageModeChanged: (callback: (mode: import('../shared/tray-usage').TrayUsageMode) => void) => () => void;
      onMaximized: (callback: (isMaximized: boolean) => void) => () => void;
      api: {
        request: (
          path: string,
          init?: {
            method?: string;
            body?: string;
            headers?: Record<string, string>;
          },
        ) => Promise<{ status: number; body: unknown }>;
      };
      onDataSynced: (callback: () => void) => () => void;
      onOpenSettings: (
        callback: (detail?: {
          tab?: 'sync' | 'pet' | 'app';
        }) => void,
      ) => () => void;
      onRuntimeNotice: (
        callback: (detail: { kind: 'config-reset'; tokenSalvaged: boolean }) => void,
      ) => () => void;
    };
  }
}

export {};
