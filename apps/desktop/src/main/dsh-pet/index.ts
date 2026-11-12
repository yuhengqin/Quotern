import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron';
import path from 'node:path';
import { DSH_PET_ACTION, DSH_PET_CHANGED, DSH_PET_GET, type DshPetAction } from '../../shared/dsh-pet.js';
import type { ActivitySubscription } from '../../shared/agent-activity.js';
import type { QuotaState } from '../../shared/quota.js';
import { DshPetController } from './controller.js';
import { discoverDshPetActivityRoots } from './activity-sources.js';
import { DSH_PET_PREVIEW_SCHEME } from '../../shared/dsh-pet-preview.js';
import { DshPetAssetStore } from './asset-store.js';
import { createDshPetPreviewHandler } from './preview.js';
import type { DshPetCompanion } from './companion.js';
import type { PetContextMenu } from '../pet-context-menu.js';

export function initializeDshPet(options: { getMainWindow(): BrowserWindow | null; getQuota(): QuotaState | null; refreshQuota(): Promise<void>; showMainWindow(): void; getCompanion?(): DshPetCompanion; sync?(): Promise<void>; openSettings?(): void; getContextMenu?(): PetContextMenu; onMenuCommand?(id: string): void; coordinateVisibility<T>(visible: boolean, operation: () => Promise<T>): Promise<T>; onStateChanged?(): void; activity?: ActivitySubscription }) {
  const root = path.join(app.getPath('userData'), 'dsh-pet');
  const runtimeRoot = app.isPackaged ? path.join(process.resourcesPath, 'dsh-pet') : path.join(__dirname, '../dsh-pet');
  protocol.handle(DSH_PET_PREVIEW_SCHEME, createDshPetPreviewHandler(new DshPetAssetStore(root, runtimeRoot)));
  const controller = new DshPetController({
    root, runtimeRoot, activity: options.activity,
    executable: process.execPath, appPath: app.getAppPath(), packaged: app.isPackaged, coordinateVisibility: options.coordinateVisibility,
    getQuota: options.getQuota, refreshQuota: options.refreshQuota, showMainWindow: options.showMainWindow,
    getCompanion: options.getCompanion, sync: options.sync, openSettings: options.openSettings,
    getContextMenu: options.getContextMenu, onMenuCommand: options.onMenuCommand,
    isMainWindowVisible: () => Boolean(options.getMainWindow()?.isFocused()),
    openDirectory: async directory => { const error = await shell.openPath(directory); if (error) throw new Error(error); },
    roots: discoverDshPetActivityRoots,
    onChanged: state => { const window = options.getMainWindow(); if (window && !window.isDestroyed()) window.webContents.send(DSH_PET_CHANGED, state); options.onStateChanged?.(); },
  });
  const trusted = (event: Electron.IpcMainInvokeEvent) => { const window = options.getMainWindow(); if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('dsh-pet sender rejected'); };
  ipcMain.handle(DSH_PET_GET, event => { trusted(event); return controller.getState(); });
  ipcMain.handle(DSH_PET_ACTION, (event, action: DshPetAction) => { trusted(event); return controller.dispatch(action); });
  return { controller, dispose: async () => { protocol.unhandle(DSH_PET_PREVIEW_SCHEME); ipcMain.removeHandler(DSH_PET_GET); ipcMain.removeHandler(DSH_PET_ACTION); await controller.dispose(); } };
}
