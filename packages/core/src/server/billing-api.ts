import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { BillingService } from '../billing/service.js';
import type { QuotaState } from '../quota/shared/quota.js';

/** Local-only explicit platform reads. Never calls quota.refresh, including for DeepSeek. */
export function registerBillingApi(parent: Hono, options: {
  service: BillingService; ipc?: boolean;
  local(range: { startTime: number; endTime: number }): unknown;
  quota?(): QuotaState | null;
}) {
  const app = new Hono();
  const fail = (message: string) => ({ success: false, message, data: null });
  app.onError(() => new Response(JSON.stringify(fail('BILLING_UNAVAILABLE')), { status: 503, headers: { 'Content-Type': 'application/json' } }));
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const local = (url: string) => { try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname); } catch { return false; } };
    if (!(local(c.req.url) || options.ipc && new URL(c.req.url).hostname === 'tud.local') || c.req.header('Origin') && !local(c.req.header('Origin')!)) return c.json(fail('BILLING_FORBIDDEN_ORIGIN'), 403);
    await next();
  });
  app.use('*', bodyLimit({ maxSize: 1024, onError: c => c.json(fail('BILLING_INVALID_REQUEST'), 413) }));
  const output = (days: number) => {
    const result = options.service.get(days), p = result.platform;
    const quota = options.quota?.(), deepseek = quota?.providers.find(p => (p.providerId ?? p.id) === 'deepseek');
    const balance = deepseek?.windows.find(w => w.balance)?.balance;
    return { ...result, local: options.local({ startTime: p.startTime, endTime: p.endTime }),
      deepseek: { remaining: balance?.remaining ?? null, currency: 'cny', fetchedAt: deepseek?.fetchedAt ?? null,
        stale: !deepseek || deepseek.stale || deepseek.status !== 'ready' || deepseek.fetchedAt === null || Date.now() / 1000 - deepseek.fetchedAt > 1800 },
    };
  };
  app.get('/', c => {
    const params = new URL(c.req.url).searchParams;
    if ([...params.keys()].some(k => k !== 'days') || params.getAll('days').length > 1 || !['7', '30', '90'].includes(params.get('days') ?? '30')) return c.json(fail('BILLING_INVALID_RANGE'), 400);
    return c.json({ success: true, message: 'ok', data: output(Number(params.get('days') ?? 30)) });
  });
  app.post('/refresh', async c => {
    if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type') ?? '')) return c.json(fail('BILLING_INVALID_REQUEST'), 400);
    let input: unknown; try { input = await c.req.json(); } catch { return c.json(fail('BILLING_INVALID_REQUEST'), 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => k !== 'days') || ![7, 30, 90].includes((input as { days: number }).days)) return c.json(fail('BILLING_INVALID_REQUEST'), 400);
    const days = (input as { days: number }).days; await options.service.refresh(days);
    return c.json({ success: true, message: 'ok', data: output(days) });
  });
  parent.route('/functions/tud-billing', app);
}
