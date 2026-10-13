import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { MAX_BACKGROUND_REQUEST_BYTES, SHARE_BACKGROUNDS_ROUTE, ShareBackgroundError, ShareBackgroundStore } from '../share-backgrounds.js';

export function registerShareBackgroundApi(parent: Hono, dataDir: string): void {
  const app = new Hono();
  const store = new ShareBackgroundStore(dataDir);
  const failure = (error: unknown) => ({ success: false as const, message: error instanceof ShareBackgroundError ? error.message : '共享背景图库暂时不可用，请重试', data: null });
  app.onError((error, c) => c.json(failure(error), error instanceof ShareBackgroundError ? error.status : 500));
  app.use(SHARE_BACKGROUNDS_ROUTE, async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const origin = c.req.header('Origin');
    if (origin) {
      let allowed = false;
      try {
        const source = new URL(origin);
        const target = new URL(`http://${c.req.header('Host') ?? new URL(c.req.url).host}`);
        allowed = ['http:', 'https:'].includes(source.protocol) && (source.hostname === target.hostname || ['localhost', '127.0.0.1', '[::1]'].includes(source.hostname));
      } catch { /* Invalid/null origins cannot access local user images. */ }
      if (!allowed) throw new ShareBackgroundError('当前网页无权访问本机背景图库', 403);
    }
    await next();
  });
  app.use(SHARE_BACKGROUNDS_ROUTE, bodyLimit({ maxSize: MAX_BACKGROUND_REQUEST_BYTES, onError: (c) => c.json(failure(new ShareBackgroundError('背景请求超过大小限制', 413)), 413) }));
  app.get(SHARE_BACKGROUNDS_ROUTE, async (c) => c.json({ success: true, message: 'ok', data: await store.list() }));
  app.post(SHARE_BACKGROUNDS_ROUTE, async (c) => {
    if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type') ?? '')) throw new ShareBackgroundError('背景请求必须使用 JSON');
    let request;
    try { request = await c.req.json(); }
    catch { throw new ShareBackgroundError('背景请求格式无效'); }
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new ShareBackgroundError('背景请求格式无效');
    let data;
    switch (request.operation) {
      case 'add': data = await store.add(request.input, request.replaceId); break;
      case 'remove': data = await store.remove(request.id); break;
      case 'touch': data = await store.touch(request.id); break;
      case 'import': data = await store.importLegacy(request.items); break;
      default: throw new ShareBackgroundError('不支持的背景图库操作');
    }
    return c.json({ success: true, message: 'ok', data });
  });
  parent.route('/', app);
}
