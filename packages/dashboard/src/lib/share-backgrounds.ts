export const MAX_SHARE_BACKGROUNDS = 3;
export const MAX_BACKGROUND_BYTES = 2 * 1024 * 1024;
export interface ShareBackground<T = string> {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number;
  image: T;
}

export function defaultBackground<T>(items: ShareBackground<T>[]): ShareBackground<T> | null {
  return [...items].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0] ?? null;
}

export function replacementSuggestion<T>(items: ShareBackground<T>[]): ShareBackground<T> | null {
  return [...items].sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.createdAt - b.createdAt)[0] ?? null;
}

export function addBackground<T>(items: ShareBackground<T>[], item: ShareBackground<T>, replaceId?: string): ShareBackground<T>[] {
  if (replaceId && !items.some(({ id }) => id === replaceId)) throw new Error('要替换的背景已不存在，请重新选择');
  if (!replaceId && items.length >= MAX_SHARE_BACKGROUNDS) throw new Error('已保存三张背景，请选择要替换的一张');
  return [...items.filter(({ id }) => id !== replaceId), item];
}

/** Pan is normalized to [-1, 1]; zoom crops into the initial cover rectangle. */
export function cropRect(width: number, height: number, zoom = 1, panX = 0, panY = 0) {
  const cropWidth = Math.min(width, height * 2 / 3) / Math.max(1, zoom);
  const cropHeight = cropWidth * 3 / 2;
  return {
    x: (width - cropWidth) * (Math.max(-1, Math.min(1, panX)) + 1) / 2,
    y: (height - cropHeight) * (Math.max(-1, Math.min(1, panY)) + 1) / 2,
    width: cropWidth, height: cropHeight,
  };
}

export function imageDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取背景图片失败'));
    reader.readAsDataURL(blob);
  });
}

interface DesktopBackgroundBridge {
  list: () => Promise<ShareBackground[]>;
  add: (input: { name: string; image: string }, replaceId?: string) => Promise<ShareBackground[]>;
  remove: (id: string) => Promise<ShareBackground[]>;
  touch: (id: string) => Promise<ShareBackground[]>;
}

function desktopBridge(): DesktopBackgroundBridge | undefined {
  return (window as unknown as { tud?: { shareBackgrounds?: DesktopBackgroundBridge } }).tud?.shareBackgrounds;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('quotern-share-backgrounds', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('backgrounds', { keyPath: 'id' });
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(new Error('无法打开背景图库，请检查浏览器存储设置'));
    request.onblocked = () => reject(new Error('背景图库被其他页面占用，请关闭其他面板后重试'));
  });
}

async function browserTransaction(update?: (items: ShareBackground<Blob>[]) => ShareBackground<Blob>[]): Promise<ShareBackground[]> {
  const db = await openDatabase();
  try {
    const items = await new Promise<ShareBackground<Blob>[]>((resolve, reject) => {
      const transaction = db.transaction('backgrounds', update ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('backgrounds');
      let result: ShareBackground<Blob>[] = [];
      let failure: unknown;
      store.getAll().onsuccess = (event) => {
        try {
          const current = (event.target as IDBRequest<ShareBackground<Blob>[]>).result;
          if (current.length > MAX_SHARE_BACKGROUNDS || current.some((item) =>
            typeof item.id !== 'string' || typeof item.name !== 'string'
            || !Number.isFinite(item.createdAt) || !Number.isFinite(item.lastUsedAt)
            || !(item.image instanceof Blob) || item.image.size > MAX_BACKGROUND_BYTES
          )) throw new Error('背景图库格式无效，已保存的数据没有修改');
          result = update ? update(current) : current;
          if (update) {
            store.clear();
            for (const item of result) store.put(item);
          }
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure ?? new Error('背景保存失败，原来的图片已保留。请检查存储空间后重试'));
      transaction.onerror = () => { /* onabort reports a single actionable error */ };
    });
    return await Promise.all(items.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map(async (item) => ({ ...item, image: await imageDataUrl(item.image) })));
  } finally { db.close(); }
}

export const shareBackgroundStore = {
  list: (): Promise<ShareBackground[]> => desktopBridge()?.list() ?? browserTransaction(),
  async add(name: string, image: Blob, replaceId?: string): Promise<ShareBackground[]> {
    if (image.size > MAX_BACKGROUND_BYTES) throw new Error('裁剪后的图片仍超过 2 MB，请选择更小的图片');
    const bridge = desktopBridge();
    if (bridge) return bridge.add({ name, image: await imageDataUrl(image) }, replaceId);
    return browserTransaction((items) => {
      const createdAt = Math.max(Date.now(), ...items.map((item) => item.createdAt + 1));
      return addBackground(items, { id: crypto.randomUUID(), name, image, createdAt, lastUsedAt: createdAt }, replaceId);
    });
  },
  remove(id: string): Promise<ShareBackground[]> {
    return desktopBridge()?.remove(id) ?? browserTransaction((items) => items.filter((item) => item.id !== id));
  },
  touch(id: string): Promise<ShareBackground[]> {
    return desktopBridge()?.touch(id) ?? browserTransaction((items) => items.map((item) => item.id === id ? { ...item, lastUsedAt: Date.now() } : item));
  },
};
