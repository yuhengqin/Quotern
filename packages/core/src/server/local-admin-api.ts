import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { readManualPricing, updateManualPricing, getModelPricingRates, getReferencePricingData, type ModelPricingRates } from '../pricing/index.js';
import type { LocalApiDeps } from './state.js';
import { createDataBackup, verifyDataBackup, restoreDataBackup, MAX_BACKUP_DOCUMENT_BYTES } from '../backup.js';
import { resolve } from 'node:path';

export const LOCAL_ADMIN_ROUTE = '/functions/tud-local-admin';
export const MAX_LOCAL_ADMIN_BYTES = MAX_BACKUP_DOCUMENT_BYTES + 1_000_000;
const failure = (message: string) => ({ success: false as const, message, data: null });
const ok = <T>(data: T) => ({ success: true as const, message: 'ok', data });
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLocal(url: string, origin: string | undefined, ipc: boolean): boolean {
  try {
    const target = new URL(url);
    if (!loopback.has(target.hostname) && !(ipc && target.hostname === 'tud.local')) return false;
    if (!origin) return true;
    const source = new URL(origin);
    return ['http:', 'https:'].includes(source.protocol) && loopback.has(source.hostname);
  } catch { return false; }
}

export function registerLocalAdminApi(parent: Hono, deps: LocalApiDeps): void {
  const app = new Hono<{ Bindings: { quoternRemoteAddress?: string } }>();
  const token = randomBytes(32).toString('hex');
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const peer = c.env?.quoternRemoteAddress;
    if (typeof peer === 'string' && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)
      || !isLocal(c.req.url, c.req.header('Origin'), Boolean(deps.sessionActionsIpc))) return c.json(failure('LOCAL_ADMIN_ONLY'), 403);
    if (c.req.method !== 'GET') {
      const supplied = Buffer.from(c.req.header('X-Quotern-Local-Admin') ?? ''), expected = Buffer.from(token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return c.json(failure('LOCAL_ADMIN_FORBIDDEN'), 403);
      if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type') ?? '')) return c.json(failure('INVALID_LOCAL_ADMIN_REQUEST'), 400);
    }
    await next();
  });
  app.use('*', bodyLimit({ maxSize: MAX_LOCAL_ADMIN_BYTES, onError: c => c.json(failure('LOCAL_ADMIN_TOO_LARGE'), 413) }));
  app.use('/pricing', bodyLimit({ maxSize: 2_000_000, onError: c => c.json(failure('LOCAL_ADMIN_TOO_LARGE'), 413) }));
  app.get('/backup', c => c.json(ok({ token, dataDir: resolve(deps.dataDir), suggestedTarget: `${resolve(deps.dataDir)}-restored-${new Date().toISOString().replace(/[:.]/g, '-')}` })));
  app.post('/backup', async c => {
    try {
      const body: unknown = await c.req.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('BACKUP_INVALID');
      const input = body as Record<string, unknown>;
      const keys = input.action === 'create' ? ['action'] : input.action === 'verify' ? ['action', 'backup'] : input.action === 'restore' ? ['action', 'backup', 'target'] : [];
      if (!keys.length || Object.keys(input).some(key => !keys.includes(key))) throw new Error('BACKUP_INVALID');
      if (input.action === 'create') { const backup = await createDataBackup(deps.dataDir, { desktopQuotaDirectory: deps.desktopQuotaDirectory }); return c.json(ok({ backup, summary: verifyDataBackup(backup) })); }
      if (input.action === 'verify') return c.json(ok(verifyDataBackup(input.backup)));
      if (typeof input.target !== 'string' || input.target.length > 4096) throw new Error('BACKUP_TARGET_ABSOLUTE');
      return c.json(ok(await restoreDataBackup(input.backup, input.target)));
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      return c.json(failure(/^BACKUP_[A-Z_]+$/.test(code) ? code : (error as NodeJS.ErrnoException)?.code === 'ELOCKED' ? 'BACKUP_BUSY' : 'LOCAL_ADMIN_WRITE_FAILED'), 400);
    }
  });
  app.get('/pricing', c => {
    try {
      const model = c.req.query('model');
      return c.json(ok({ ...readManualPricing(deps.dataDir), token,
        ...(model && model.length <= 200 ? { reference: getReferencePricingData().exact[model] ?? null, effective: getModelPricingRates(model) } : {}) }));
    } catch { return c.json(failure('INVALID_MANUAL_PRICING'), 500); }
  });
  app.post('/pricing', async c => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['revision', 'model', 'rates'].includes(key))
        || typeof body.revision !== 'string' || typeof body.model !== 'string' || body.rates === undefined) throw new Error();
    } catch { return c.json(failure('INVALID_LOCAL_ADMIN_REQUEST'), 400); }
    try {
      const state = await updateManualPricing(deps.dataDir, body.revision as string, body.model as string, body.rates as ModelPricingRates | null);
      let recalculated = true;
      try { await deps.aggregateCache?.rebuildFromRows(deps.bucketStore.getRows()); } catch { recalculated = false; }
      deps.onPricingChange?.();
      return c.json(ok({ ...state, token, recalculated }));
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      return c.json(failure(['PRICING_CONFLICT', 'INVALID_MANUAL_PRICING'].includes(code) ? code : 'LOCAL_ADMIN_WRITE_FAILED'), code === 'PRICING_CONFLICT' ? 409 : code === 'INVALID_MANUAL_PRICING' ? 400 : 500);
    }
  });
  parent.route(LOCAL_ADMIN_ROUTE, app);
}
