import { createContext, useContext, type ReactNode } from 'react';

export type InstallGuideUiReason = 'new_user' | 'uninstalled' | 'active';

export interface InstallGuideUiContextValue {
  /** True once guest mode is known, or the install-guide API has settled. */
  ready: boolean;
  /** True when the user has recent usage data (`reason === 'active'`). */
  hasUserData: boolean;
  /** Latest classify reason from the install-guide API (guests → `new_user`). */
  reason: InstallGuideUiReason;
}

const InstallGuideUiContext = createContext<InstallGuideUiContextValue | null>(
  null,
);

export function InstallGuideUiProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: InstallGuideUiContextValue;
}) {
  return (
    <InstallGuideUiContext.Provider value={value}>
      {children}
    </InstallGuideUiContext.Provider>
  );
}

/** Returns null outside the provider (e.g. CLI) so callers can no-op. */
export function useInstallGuideUi(): InstallGuideUiContextValue | null {
  return useContext(InstallGuideUiContext);
}
