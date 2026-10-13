import { app, ipcMain, nativeImage } from 'electron';
import { SHARE_BACKGROUNDS_CHANNEL, type ShareBackgroundRequest } from '../shared/share-backgrounds';
import { ShareBackgroundFileStore, validateBackgroundImage } from './share-background-store';

export function registerShareBackgroundIpc(): void {
  const store = new ShareBackgroundFileStore(app.getPath('userData'));
  ipcMain.removeHandler(SHARE_BACKGROUNDS_CHANNEL);
  ipcMain.handle(SHARE_BACKGROUNDS_CHANNEL, (_event, request: ShareBackgroundRequest) => {
    if (!request || typeof request !== 'object') throw new Error('背景图库请求无效');
    switch (request.operation) {
      case 'list': return store.list();
      case 'add': {
        validateBackgroundImage(request.input?.image);
        const decoded = nativeImage.createFromDataURL(request.input.image);
        if (decoded.isEmpty()) throw new Error('无法解码背景图片');
        const { width, height } = decoded.getSize();
        if (width > 2160 || height > 2160) throw new Error('背景图片分辨率超过限制');
        if (request.replaceId !== undefined && typeof request.replaceId !== 'string') throw new Error('替换对象无效');
        return store.add(request.input, request.replaceId);
      }
      case 'remove': case 'touch':
        if (typeof request.id !== 'string' || request.id.length > 100) throw new Error('背景编号无效');
        return request.operation === 'remove' ? store.remove(request.id) : store.touch(request.id);
      default: throw new Error('不支持的背景图库操作');
    }
  });
}
