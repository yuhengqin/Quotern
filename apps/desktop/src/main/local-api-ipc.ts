import { BrowserWindow, ipcMain } from 'electron';
import {
  localApiRequest,
  onLocalRuntimeSynced,
} from './local-runtime';

const API_REQUEST_CHANNEL = 'tud:api-request';
const DATA_SYNCED_CHANNEL = 'tud:data-synced';
/** Merge sync notifications so renderers reload at most once per window. */
const BROADCAST_MERGE_MS = 300;

/**
 * Register IPC for in-process local-api + broadcast sync events to all windows.
 */
export function registerLocalApiIpc(): () => void {
  ipcMain.removeHandler(API_REQUEST_CHANNEL);
  ipcMain.handle(
    API_REQUEST_CHANNEL,
    async (
      _event,
      path: string,
      init?: { method?: string; body?: string; headers?: Record<string, string> },
    ) => localApiRequest(path, init),
  );

  let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = onLocalRuntimeSynced(() => {
    // Trailing merge: rapid successive sync notifications (per-source syncs,
    // signal storms) collapse into a single renderer broadcast.
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(DATA_SYNCED_CHANNEL);
        }
      }
    }, BROADCAST_MERGE_MS);
  });

  return () => {
    ipcMain.removeHandler(API_REQUEST_CHANNEL);
    if (broadcastTimer) {
      clearTimeout(broadcastTimer);
      broadcastTimer = null;
    }
    unsubscribe();
  };
}

export { API_REQUEST_CHANNEL, DATA_SYNCED_CHANNEL };
