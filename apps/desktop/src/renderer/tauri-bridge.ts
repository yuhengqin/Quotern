import { createTudApi } from '../preload';
import { createTauriTransport } from '../preload/tauri-transport';

const desktopWindow = window as Window & {
  __TAURI_INTERNALS__?: unknown;
  __QUOTERN_PLATFORM__?: NodeJS.Platform;
  __QUOTERN_TAURI_TRANSPORT__?: ReturnType<typeof createTauriTransport>;
};

let ready = Promise.resolve();
if (desktopWindow.__TAURI_INTERNALS__) {
  if (!desktopWindow.__QUOTERN_PLATFORM__) throw new Error('Desktop platform was not initialized');
  const tauri = desktopWindow.__QUOTERN_TAURI_TRANSPORT__ ??= createTauriTransport();
  desktopWindow.tud = createTudApi(tauri.transport, desktopWindow.__QUOTERN_PLATFORM__);
  ready = tauri.ready;
}

export const desktopBridgeReady = ready;
