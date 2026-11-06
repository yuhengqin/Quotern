import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

export const actionFailure = (message: string) => ({ success: false as const, message, data: null });
export const actionOk = <T>(data: T) => ({ success: true as const, message: 'ok', data });
export const LOCAL_ACTION_BODY_LIMIT = 24 * 1024;
export const ACCOUNT_LAUNCH_ROUTE = '/functions/tud-account-launch';
export const CLAUDE_BILLING_ROUTE = '/functions/tud-claude-billing';
export const isLocalActionRoute = (path: string) => [ACCOUNT_LAUNCH_ROUTE, CLAUDE_BILLING_ROUTE].includes(path.split('?')[0]!.replace(/\/$/, ''));

/** Local privileged actions use a per-runtime capability, never a cookie. */
export function createLocalActionApi(header: string, ipc = false, maxSize = LOCAL_ACTION_BODY_LIMIT) {
  const app = new Hono<{ Bindings: { quoternRemoteAddress?: string } }>(), token = randomBytes(32).toString('hex');
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const peer = c.env?.quoternRemoteAddress;
    let local = false;
    try {
      const target = new URL(c.req.url), origin = c.req.header('Origin'), source = origin ? new URL(origin) : null;
      const rawHost = c.req.header('Host'), headerHost = rawHost ? new URL(`http://${rawHost}`) : null;
      local = (loopback.has(target.hostname) || ipc && target.hostname === 'tud.local')
        && (!headerHost || loopback.has(headerHost.hostname) || ipc && headerHost.hostname === 'tud.local')
        && (!source || ['http:', 'https:'].includes(source.protocol) && loopback.has(source.hostname))
        && (typeof peer !== 'string' || ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer));
    } catch { /* Reject malformed origins and hosts. */ }
    if (!local) return c.json(actionFailure('LOCAL_ACTION_ONLY'), 403);
    if (c.req.method !== 'GET') {
      const expected = Buffer.from(token), supplied = Buffer.from(c.req.header(header) ?? '');
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return c.json(actionFailure('LOCAL_ACTION_FORBIDDEN'), 403);
      if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type') ?? '')) return c.json(actionFailure('LOCAL_ACTION_INVALID'), 400);
    }
    await next();
  });
  app.use('*', bodyLimit({ maxSize, onError: c => c.json(actionFailure('LOCAL_ACTION_TOO_LARGE'), 413) }));
  return { app, token };
}
