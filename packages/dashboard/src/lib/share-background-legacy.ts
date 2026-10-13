import { imageDataUrl, MAX_BACKGROUND_BYTES, MAX_SHARE_BACKGROUNDS, type ShareBackground } from './share-backgrounds';

/** Read-only migration source. Never clear the old library or turn it into a fallback store. */
export async function readBrowserLegacyBackgrounds(): Promise<ShareBackground[]> {
  const db = await new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open('quotern-share-backgrounds');
    let missing = false;
    let rejected = false;
    request.onupgradeneeded = () => { missing = true; request.transaction?.abort(); };
    request.onsuccess = () => {
      if (rejected) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => missing ? resolve(null) : reject(new Error('无法读取旧浏览器图库，请检查浏览器存储设置'));
    request.onblocked = () => { rejected = true; reject(new Error('旧浏览器图库被其他页面占用，请关闭其他面板后重试')); };
  });
  if (!db) return [];
  try {
    if (!db.objectStoreNames.contains('backgrounds')) throw new Error('旧浏览器图库格式无效，原数据已保留');
    const items = await new Promise<ShareBackground<Blob>[]>((resolve, reject) => {
      const transaction = db.transaction('backgrounds', 'readonly');
      const request = transaction.objectStore('backgrounds').getAll();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(new Error('读取旧浏览器图库失败，原数据已保留'));
    });
    if (items.length > MAX_SHARE_BACKGROUNDS || items.some((item) => !item
      || typeof item.id !== 'string' || typeof item.name !== 'string'
      || !Number.isFinite(item.createdAt) || !Number.isFinite(item.lastUsedAt)
      || !(item.image instanceof Blob) || item.image.size > MAX_BACKGROUND_BYTES)) throw new Error('旧浏览器图库格式无效，原数据已保留');
    return Promise.all(items.map(async (item) => ({ ...item, image: await imageDataUrl(item.image) })));
  } finally { db.close(); }
}

export function readLegacyBackgrounds(): Promise<ShareBackground[]> {
  const bridge = (window as unknown as { tud?: { shareBackgrounds?: { legacy: () => Promise<ShareBackground[]> } } }).tud?.shareBackgrounds;
  return bridge ? bridge.legacy() : readBrowserLegacyBackgrounds();
}
