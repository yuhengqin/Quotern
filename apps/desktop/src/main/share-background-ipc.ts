import { app, ipcMain } from 'electron';
import { SHARE_BACKGROUNDS_CHANNEL, type ShareBackgroundRequest } from '../shared/share-backgrounds';
import { readDesktopLegacyBackgrounds } from './share-background-store';

export function registerShareBackgroundIpc(): void {
  ipcMain.removeHandler(SHARE_BACKGROUNDS_CHANNEL);
  ipcMain.handle(SHARE_BACKGROUNDS_CHANNEL, (_event, request: ShareBackgroundRequest) => {
    if (!request || typeof request !== 'object' || request.operation !== 'legacy') throw new Error('旧背景图库请求无效');
    return readDesktopLegacyBackgrounds(app.getPath('userData'));
  });
}
