import { BrowserWindow, ipcMain } from 'electron';
import { APPEARANCE_CHANGED_CHANNEL, APPEARANCE_GET_CHANNEL, APPEARANCE_SET_CHANNEL, APPEARANCE_INITIALIZE_CHANNEL, type AppearancePreferences } from '../shared/appearance.js';
import { APPEARANCE_VISIBILITY_CHANNEL, APPEARANCE_WATCH_VISIBILITY_CHANNEL, APPEARANCE_UNWATCH_VISIBILITY_CHANNEL } from '../shared/appearance.js';
import { createAppearanceController } from './appearance-controller.js';
import { readAppearancePreferences, writeAppearancePreferences } from './appearance-store.js';

export async function registerAppearanceIpc(directory: string, apply: (value: AppearancePreferences) => void) {
  const controller = createAppearanceController({
    read: () => readAppearancePreferences(directory).catch(error => { console.error('[tud-desktop] failed to read appearance:', error); return null; }),
    write: value => writeAppearancePreferences(directory, value),
    apply,
    publish: value => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(APPEARANCE_CHANGED_CHANNEL, value);
      }
    },
  });
  await controller.get();
  ipcMain.removeHandler(APPEARANCE_GET_CHANNEL);
  ipcMain.removeHandler(APPEARANCE_SET_CHANNEL);
  ipcMain.removeHandler(APPEARANCE_INITIALIZE_CHANNEL);
  ipcMain.handle(APPEARANCE_GET_CHANNEL, () => controller.get());
  ipcMain.handle(APPEARANCE_SET_CHANNEL, (_event, value: unknown) => controller.set(value));
  ipcMain.handle(APPEARANCE_INITIALIZE_CHANNEL, (_event, value: unknown) => controller.initialize(value));
  // Initial show:false windows and backgroundThrottling:false cannot rely on
  // document.hidden. Only watch the requesting window while it needs motion.
  const watches = new Map<number, () => void>();
  const watchVisibility = (event: Electron.IpcMainEvent) => {
    if (event.senderFrame !== event.sender.mainFrame) return;
    const contents = event.sender, id = contents.id, window = BrowserWindow.fromWebContents(contents);
    if (!window) return;
    watches.get(id)?.();
    let disposed = false;
    const publish = () => { if (!disposed && !window.isDestroyed() && !contents.isDestroyed()) contents.send(APPEARANCE_VISIBILITY_CHANNEL, window.isVisible() && !window.isMinimized()); };
    const onNavigation = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => { if (mainFrame && !inPlace) dispose(); };
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      window.removeListener('show', publish);
      window.removeListener('hide', publish);
      window.removeListener('minimize', publish);
      window.removeListener('restore', publish);
      contents.removeListener('did-start-navigation', onNavigation);
      contents.removeListener('destroyed', dispose);
      watches.delete(id);
    };
    window.on('show', publish);
    window.on('hide', publish);
    window.on('minimize', publish);
    window.on('restore', publish);
    contents.on('did-start-navigation', onNavigation);
    contents.once('destroyed', dispose);
    watches.set(id, dispose);
    publish();
  };
  const unwatchVisibility = (event: Electron.IpcMainEvent) => { if (event.senderFrame === event.sender.mainFrame) watches.get(event.sender.id)?.(); };
  ipcMain.on(APPEARANCE_WATCH_VISIBILITY_CHANNEL, watchVisibility);
  ipcMain.on(APPEARANCE_UNWATCH_VISIBILITY_CHANNEL, unwatchVisibility);
  return () => {
    ipcMain.removeListener(APPEARANCE_WATCH_VISIBILITY_CHANNEL, watchVisibility);
    ipcMain.removeListener(APPEARANCE_UNWATCH_VISIBILITY_CHANNEL, unwatchVisibility);
    for (const dispose of watches.values()) dispose();
    ipcMain.removeHandler(APPEARANCE_GET_CHANNEL);
    ipcMain.removeHandler(APPEARANCE_SET_CHANNEL);
    ipcMain.removeHandler(APPEARANCE_INITIALIZE_CHANNEL);
  };
}
