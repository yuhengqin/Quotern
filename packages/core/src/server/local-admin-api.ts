import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { readManualPricing, updateManualPricing, loadManualPricing, getPricingEditPreview, getPricingFingerprint, type ModelPricingRates, type PricingRecalculationJob, type PricingImpactScope } from '../pricing/index.js';
import { touchedLocalDates } from '../aggregate-cache.js';
import { localDateNow } from '../timezone.js';
import type { LocalApiDeps } from './state.js';
import { createDataBackup, verifyDataBackup, restoreDataBackup, restoreDataBackupWithProtection, MAX_BACKUP_DOCUMENT_BYTES } from '../backup.js';
import { resolve } from 'node:path';
import { registerUsageRecovery } from './usage-recovery-api.js';

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
  let writingPricing = false;
  let backupBusy = false;
  let pricingJob: PricingRecalculationJob | null = null;
  const pricingJobs = new Map<string, PricingRecalculationJob>();
  const capabilities = { backgroundRecalculation: true };
  const impactScope = (): PricingImpactScope => {
    const dates = touchedLocalDates(deps.bucketStore.getRows()).filter(date => date < localDateNow()).sort();
    return { days: dates.length, fromDate: dates[0] ?? null, toDate: dates.at(-1) ?? null };
  };
  const startRecalculation = (revision: string, background: boolean) => {
    const job: PricingRecalculationJob = { id: randomUUID(), revision, status: 'running', scope: impactScope(), startedAt: new Date().toISOString() };
    pricingJob = job;
    pricingJobs.set(job.id, job);
    if (pricingJobs.size > 32) pricingJobs.delete(pricingJobs.keys().next().value!);
    const run = async () => {
      try {
        if (readManualPricing(deps.dataDir).revision !== revision) throw new Error('PRICING_CONFLICT');
        loadManualPricing(deps.dataDir);
        const fingerprint = getPricingFingerprint(), bucketRevision = deps.bucketStore.getRevision();
        await deps.aggregateCache?.rebuildFromRows(deps.bucketStore.getRows());
        if (readManualPricing(deps.dataDir).revision !== revision || getPricingFingerprint() !== fingerprint || deps.bucketStore.getRevision() !== bucketRevision) throw new Error('PRICING_CONFLICT');
        job.status = 'succeeded';
      } catch (error) {
        job.status = 'failed'; job.error = error instanceof Error && error.message === 'PRICING_CONFLICT' ? 'PRICING_CONFLICT' : 'PRICING_RECALCULATION_FAILED';
      } finally {
        job.completedAt = new Date().toISOString();
        try { deps.onPricingChange?.(); } catch { /* Notification cannot undo a completed save or rebuild. */ }
      }
    };
    // Let the save response reach HTTP / IPC before starting the existing cache rebuild.
    const completion = background ? new Promise<void>(resolve => { setTimeout(() => { void run().then(resolve); }, 0); }) : run();
    return { job, completion };
  };
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
  app.get('/backup', c => c.json(ok({ token, dataDir: resolve(deps.dataDir), protectedRestore: true, suggestedTarget: `${resolve(deps.dataDir)}-restored-${new Date().toISOString().replace(/[:.]/g, '-')}` })));
  app.post('/backup', async c => {
    if (backupBusy) return c.json(failure('BACKUP_BUSY'), 409);
    backupBusy = true;
    try {
      const body: unknown = await c.req.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('BACKUP_INVALID');
      const input = body as Record<string, unknown>;
      const keys = input.action === 'create' ? ['action'] : input.action === 'verify' ? ['action', 'backup'] : input.action === 'restore' || input.action === 'restore-protected' ? ['action', 'backup', 'target'] : [];
      if (!keys.length || Object.keys(input).some(key => !keys.includes(key))) throw new Error('BACKUP_INVALID');
      if (input.action === 'create') { const backup = await createDataBackup(deps.dataDir, { desktopQuotaDirectory: deps.desktopQuotaDirectory }); return c.json(ok({ backup, summary: verifyDataBackup(backup) })); }
      if (input.action === 'verify') return c.json(ok(verifyDataBackup(input.backup)));
      if (typeof input.target !== 'string' || input.target.length > 4096) throw new Error('BACKUP_TARGET_ABSOLUTE');
      if (input.action === 'restore-protected') return c.json(ok(await restoreDataBackupWithProtection(input.backup, input.target, deps.dataDir, { desktopQuotaDirectory: deps.desktopQuotaDirectory })));
      return c.json(ok(await restoreDataBackup(input.backup, input.target)));
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      return c.json(failure(/^BACKUP_[A-Z_]+$/.test(code) ? code : (error as NodeJS.ErrnoException)?.code === 'ELOCKED' ? 'BACKUP_BUSY' : 'LOCAL_ADMIN_WRITE_FAILED'), 400);
    } finally { backupBusy = false; }
  });
  app.get('/pricing', c => {
    try {
      const model = c.req.query('model');
      const state = readManualPricing(deps.dataDir);
      return c.json(ok({ ...state, token, capabilities, scope: impactScope(), job: pricingJob,
        ...(model && model.length <= 200 ? getPricingEditPreview(model, state.document) : {}) }));
    } catch { return c.json(failure('INVALID_MANUAL_PRICING'), 500); }
  });
  app.get('/pricing/recalculation', c => {
    const id = c.req.query('id');
    return c.json(ok({ job: id ? pricingJobs.get(id) ?? null : pricingJob }));
  });
  app.post('/pricing/recalculation', async c => {
    try {
      const body = await c.req.json();
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'revision') || typeof body.revision !== 'string') return c.json(failure('INVALID_LOCAL_ADMIN_REQUEST'), 400);
      if (writingPricing || pricingJob?.status === 'running') return c.json(failure('PRICING_UPDATE_BUSY'), 409);
      const state = readManualPricing(deps.dataDir);
      if (body.revision !== state.revision) return c.json(failure('PRICING_CONFLICT'), 409);
      return c.json(ok({ job: startRecalculation(state.revision, true).job }));
    } catch { return c.json(failure('LOCAL_ADMIN_WRITE_FAILED'), 500); }
  });
  app.post('/pricing', async c => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['revision', 'model', 'rates', 'background'].includes(key))
        || typeof body.revision !== 'string' || typeof body.model !== 'string' || body.rates === undefined || (body.background !== undefined && typeof body.background !== 'boolean')) throw new Error();
    } catch { return c.json(failure('INVALID_LOCAL_ADMIN_REQUEST'), 400); }
    if (writingPricing || pricingJob?.status === 'running') return c.json(failure('PRICING_UPDATE_BUSY'), 409);
    writingPricing = true;
    try {
      const state = await updateManualPricing(deps.dataDir, body.revision as string, body.model as string, body.rates as ModelPricingRates | null);
      const { job, completion } = startRecalculation(state.revision, body.background === true);
      if (!body.background) await completion;
      return c.json(ok({ ...state, token, capabilities, scope: job.scope, job, ...(!body.background ? { recalculated: job.status === 'succeeded' } : {}) }));
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      return c.json(failure(['PRICING_CONFLICT', 'INVALID_MANUAL_PRICING'].includes(code) ? code : 'LOCAL_ADMIN_WRITE_FAILED'), code === 'PRICING_CONFLICT' ? 409 : code === 'INVALID_MANUAL_PRICING' ? 400 : 500);
    } finally { writingPricing = false; }
  });
  registerUsageRecovery(app, deps, token);
  parent.route(LOCAL_ADMIN_ROUTE, app);
}
