import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { QuotaManager } from '../quota/readers/quota-manager.js';
import { validQuotaPatch } from '../quota/readers/quota-store.js';
import { isSubscriptionChannelId } from '../quota/shared/subscription-channels.js';

export type LocalQuotaRuntime = Pick<QuotaManager, 'getState' | 'refresh' | 'setPreferences'>;
const ROUTE = '/functions/tud-quota';
const failure = (message: string) => ({ success: false as const, message, data: null });
const ok = <T>(data: T) => ({ success: true as const, message: 'ok', data });

export function isLocalPanelOrigin(origin: string | undefined, target: string): boolean {
  if (!origin) return true;
  try {
    const source = new URL(origin), destination = new URL(target);
    return ['http:', 'https:'].includes(source.protocol)
      && (source.origin === destination.origin || ['localhost', '127.0.0.1', '[::1]'].includes(source.hostname));
  } catch { return false; }
}

export function registerQuotaApi(parent: Hono, quota?: LocalQuotaRuntime): void {
  const app = new Hono();
  app.onError((_error, c) => c.json(failure('QUOTA_REQUEST_FAILED'), 500));
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (!isLocalPanelOrigin(c.req.header('Origin'), c.req.url)) return c.json(failure('QUOTA_FORBIDDEN_ORIGIN'), 403);
    if (!quota) return c.json(failure('QUOTA_UNAVAILABLE'), 503);
    await next();
  });
  app.use('*', bodyLimit({ maxSize: 16 * 1024, onError: c => c.json(failure('QUOTA_REQUEST_TOO_LARGE'), 413) }));
  app.get('/', c => {
    const state = quota!.getState();
    void quota!.refresh('interaction').catch(() => {});
    return c.json(ok(state));
  });
  app.post('/:operation', async c => {
    if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type') ?? '')) return c.json(failure('QUOTA_INVALID_REQUEST'), 400);
    let input: unknown;
    try { input = await c.req.json(); } catch { return c.json(failure('QUOTA_INVALID_REQUEST'), 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return c.json(failure('QUOTA_INVALID_REQUEST'), 400);
    if (c.req.param('operation') === 'refresh') {
      const body = input as Record<string, unknown>;
      if (Object.keys(body).some(key => key !== 'provider') || (body.provider !== undefined && !isSubscriptionChannelId(body.provider)
        && !(typeof body.provider === 'string' && quota!.getState().providers.some(provider => provider.id === body.provider)))) return c.json(failure('QUOTA_INVALID_PROVIDER'), 400);
      return c.json(ok(await quota!.refresh('manual', body.provider as string | undefined)));
    }
    if (c.req.param('operation') === 'preferences') {
      if (!validQuotaPatch(input)) return c.json(failure('QUOTA_INVALID_PREFERENCES'), 400);
      try { return c.json(ok(await quota!.setPreferences(input))); }
      catch (error) {
        if (error instanceof Error && ['QUOTA_DEFAULT_DIRECTORY', 'QUOTA_DUPLICATE_DIRECTORY'].includes(error.message)) return c.json(failure(error.message), 400);
        throw error;
      }
    }
    return c.json(failure('QUOTA_INVALID_OPERATION'), 404);
  });
  parent.route(ROUTE, app);
}
