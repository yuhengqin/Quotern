/**
 * Keep synchronous native traps fatal. proper-lockfile loads signal-exit, which
 * installs a JS SIGTRAP listener. Returning from a native trap to that listener
 * can repeat the trapping instruction forever before JS gets a turn to run.
 * Call after dependencies load, in both the main and sync worker processes.
 */
export function restoreNativeTrapHandler(): void {
  if (process.platform !== 'win32') {
    process.removeAllListeners('SIGTRAP');
  }
}
