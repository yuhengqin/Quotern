import type { DshPetAssetStore } from './asset-store.js';
import { DSH_PET_PREVIEW_ACTIONS, DSH_PET_PREVIEW_SCHEME } from '../../shared/dsh-pet-preview.js';
import { fileResponse } from './helper-adapter.js';

/** Settings can read these videos even while the independent pet is disabled. */
export function createDshPetPreviewHandler(assets: DshPetAssetStore) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    try {
      const url = new URL(request.url);
      if (url.protocol !== `${DSH_PET_PREVIEW_SCHEME}:` || url.host !== 'preview' || url.username || url.password || url.search || url.hash) return new Response(null, { status: 404 });
      const filename = decodeURIComponent(url.pathname.slice(1));
      const action = DSH_PET_PREVIEW_ACTIONS.find(item => `${item.name}.webm` === filename);
      if (action) {
        const asset = await assets.resolve(`/thumb/main/${encodeURIComponent(action.name)}.webm`);
        if (asset) return await fileResponse(asset.file, request.headers.get('range'), asset.contentType);
      }
    } catch { /* Missing or unreadable media should not break the settings editor. */ }
    return new Response(null, { status: 404 });
  };
}
