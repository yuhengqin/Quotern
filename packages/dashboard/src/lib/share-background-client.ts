import { request } from '@/lib/api';
import { imageDataUrl, MAX_BACKGROUND_BYTES, type ShareBackground } from './share-backgrounds';
import { readLegacyBackgrounds } from './share-background-legacy';
import { loadSharedBackgroundLibrary } from './share-background-migration';
import { isDemoMode } from './demo-runtime.ts';

const route = '/functions/tud-share-backgrounds';
function mutate<T = ShareBackground[]>(body: unknown): Promise<T> {
  return request<T>(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
export const shareBackgroundStore = {
  list: () => request<ShareBackground[]>(route),
  async add(name: string, image: Blob, replaceId?: string): Promise<ShareBackground[]> {
    if (image.size > MAX_BACKGROUND_BYTES) throw new Error('裁剪后的图片仍超过 2 MB，请选择更小的图片');
    return mutate({ operation: 'add', input: { name, image: await imageDataUrl(image) }, replaceId });
  },
  remove: (id: string) => mutate({ operation: 'remove', id }),
  touch: (id: string) => mutate({ operation: 'touch', id }),
};
export function loadBackgroundLibrary() {
  if (isDemoMode()) return shareBackgroundStore.list().then(items => ({ items, migrationNotice: null, pendingCount: 0 }));
  return loadSharedBackgroundLibrary({
    list: shareBackgroundStore.list, legacy: readLegacyBackgrounds,
    importLegacy: (items) => mutate({ operation: 'import', items }),
  });
}
