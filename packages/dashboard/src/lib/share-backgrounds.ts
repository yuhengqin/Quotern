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
