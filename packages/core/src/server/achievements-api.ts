import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { isIP } from 'node:net';
import { AchievementError, AchievementStore, validateAchievementOperation } from '../achievements/store.js';
import { readAchievementFacts } from '../achievements/facts.js';

export const ACHIEVEMENTS_ROUTE = '/functions/tud-achievements';
export function registerAchievementsApi(parent: Hono, dataDir: string): void {
  const app = new Hono();
  const store = new AchievementStore(dataDir, () => readAchievementFacts(dataDir));
  app.onError((error, c) => {
    const status = error instanceof AchievementError ? error.status : 500;
    return c.json({ success: false, message: error instanceof AchievementError ? error.message : '成就收藏暂时不可用，请重试', data: null }, status === 403 ? 403 : status === 413 ? 413 : status === 500 ? 500 : 400);
  });
  app.use(ACHIEVEMENTS_ROUTE, async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const origin = c.req.header('Origin');
    if (origin) {
      let allowed = false;
      try {
        const source = new URL(origin);
        const requestTarget = new URL(`http://${c.req.header('Host') ?? new URL(c.req.url).host}`);
        // Only IP literals may override the configured host; arbitrary names can be rebound.
        const target = isIP(requestTarget.hostname.replace(/^\[|\]$/g, '')) ? requestTarget : new URL(c.req.url);
        allowed = ['http:', 'https:'].includes(source.protocol) && (source.hostname === target.hostname || ['localhost', '127.0.0.1', '[::1]'].includes(source.hostname));
      } catch { /* null and malformed origins cannot access local usage records. */ }
      if (!allowed) throw new AchievementError('当前网页无权访问本机成就收藏', 403);
    }
    await next();
  });
  app.use(ACHIEVEMENTS_ROUTE, bodyLimit({ maxSize: 512 * 1024, onError: c => c.json({ success: false, message: '成就请求过大', data: null }, 413) }));
  app.get(ACHIEVEMENTS_ROUTE, async c => c.json({ success: true, message: 'ok', data: await store.read() }));
  app.post(ACHIEVEMENTS_ROUTE, async c => {
    if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type') ?? '')) throw new AchievementError('成就请求必须使用 JSON');
    let input: unknown;
    try { input = await c.req.json(); } catch { throw new AchievementError('成就请求格式无效'); }
    validateAchievementOperation(input);
    return c.json({ success: true, message: 'ok', data: await store.update(input) });
  });
  parent.route('/', app);
}
