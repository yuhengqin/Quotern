/** Queue opens until window IPC is registered, and share any pending Dock transition. */
export function createMainWindowLauncher(
  showWindow: () => Promise<void>,
  hideForSilentLaunch: () => void,
): { initialize: (startHidden: boolean) => Promise<void>; show: () => Promise<void> } {
  let releaseReady!: () => void;
  const ready = new Promise<void>((resolve) => { releaseReady = resolve; });
  let initialized = false;
  let showInFlight: Promise<void> | null = null;

  function show(): Promise<void> {
    if (!showInFlight) {
      showInFlight = ready.then(showWindow).finally(() => {
        showInFlight = null;
      });
    }
    return showInFlight;
  }

  function initialize(startHidden: boolean): Promise<void> {
    if (initialized) return showInFlight ?? Promise.resolve();
    initialized = true;
    releaseReady();
    // A user open received during setup takes precedence over the login default.
    if (startHidden && !showInFlight) {
      hideForSilentLaunch();
      return Promise.resolve();
    }
    return show();
  }

  return { initialize, show };
}
