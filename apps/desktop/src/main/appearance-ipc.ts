import { BrowserWindow, ipcMain } from 'electron';
import { APPEARANCE_CHANGED_CHANNEL, APPEARANCE_GET_CHANNEL, APPEARANCE_SET_CHANNEL, APPEARANCE_INITIALIZE_CHANNEL, type AppearancePreferences } from '../shared/appearance.js';
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
  return () => {
    ipcMain.removeHandler(APPEARANCE_GET_CHANNEL);
    ipcMain.removeHandler(APPEARANCE_SET_CHANNEL);
    ipcMain.removeHandler(APPEARANCE_INITIALIZE_CHANNEL);
  };
}
