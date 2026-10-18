import { app, BrowserWindow, ipcMain, net, Notification, safeStorage, shell } from 'electron';
import path from 'node:path';
import { DSH_PET_ACTION, DSH_PET_CHANGED, DSH_PET_GET, type DshPetAction } from '../../shared/dsh-pet.js';
import type { QuotaState } from '../../shared/quota.js';
import { DshPetController } from './controller.js';
import { discoverDshPetActivityRoots } from './activity-sources.js';

export async function initializeDshPet(options: { getMainWindow(): BrowserWindow | null; getQuota(): QuotaState | null; refreshQuota(): Promise<void>; showMainWindow(): void }) {
  const notifications = new Set<Notification>();
  const controller = new DshPetController({
    root: path.join(app.getPath('userData'), 'dsh-pet'), runtimeRoot: app.isPackaged ? path.join(process.resourcesPath, 'dsh-pet') : path.join(__dirname, '../dsh-pet'),
    executable: process.execPath, appPath: app.getAppPath(), packaged: app.isPackaged, secrets: safeStorage,
    getQuota: options.getQuota, refreshQuota: options.refreshQuota, showMainWindow: options.showMainWindow,
    isMainWindowVisible: () => Boolean(options.getMainWindow()?.isFocused()),
    openDirectory: async directory => { const error = await shell.openPath(directory); if (error) throw new Error(error); },
    fetch: (url, init) => net.fetch(url, init), roots: discoverDshPetActivityRoots,
    onChanged: state => { const window = options.getMainWindow(); if (window && !window.isDestroyed()) window.webContents.send(DSH_PET_CHANGED, state); },
    notify: (title, body) => { if (!Notification.isSupported()) return; const notice = new Notification({ title, body, silent: true }); notifications.add(notice); notice.once('click', options.showMainWindow); notice.once('close', () => notifications.delete(notice)); notice.once('failed', () => notifications.delete(notice)); if (notifications.size > 32) { const oldest = notifications.values().next().value!; oldest.close(); notifications.delete(oldest); } notice.show(); },
  });
  const trusted = (event: Electron.IpcMainInvokeEvent) => { const window = options.getMainWindow(); if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('dsh-pet sender rejected'); };
  ipcMain.handle(DSH_PET_GET, event => { trusted(event); return controller.getState(); });
  ipcMain.handle(DSH_PET_ACTION, (event, action: DshPetAction) => { trusted(event); return controller.dispatch(action); });
  await controller.initialize();
  return { controller, dispose: async () => { ipcMain.removeHandler(DSH_PET_GET); ipcMain.removeHandler(DSH_PET_ACTION); for (const notification of notifications) notification.close(); notifications.clear(); await controller.dispose(); } };
}
