import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { QueueBucket } from '../types.js';
import { resolveLocalCollectSince } from '../config.js';
import { loadBucketsForRange } from '../queue/index.js';
import { withDataTransaction } from '../data-transaction.js';
import { writeSyncDone } from '../signals.js';
import { readRecoveryRows, RECOVERY_REQUEST_BYTES, saveRecoveryRows, scanRecoveryFiles, selectRecoveryRows, summarizeRecovery, type RecoveryPreview } from '../usage-recovery.js';
import type { LocalApiDeps } from './state.js';

export const USAGE_RECOVERY_PATH = '/usage-recovery';
const ALL_HISTORY = '0001-01-01T00:00:00.000Z';
const ok = <T>(data: T) => ({ success: true, message: 'ok', data });
const fail = (message: string) => ({ success: false, message, data: null });

export function registerUsageRecovery(app: Hono<{ Bindings: { quoternRemoteAddress?: string } }>, deps: LocalApiDeps, token: string): void {
  type Plan = { rows: QueueBucket[]; summary: RecoveryPreview; expires: number; applied?: { tokens: number; requests: number; refreshed: boolean } };
  const plans = new Map<string, Plan>();
  const enabled = () => typeof deps.usageRecoveryEnabled === 'function' ? deps.usageRecoveryEnabled() : deps.usageRecoveryEnabled === true;
  let working = false;
  app.use(USAGE_RECOVERY_PATH, bodyLimit({ maxSize: RECOVERY_REQUEST_BYTES, onError: c => c.json(fail('RECOVERY_TOO_LARGE'), 413) }));
  app.get(USAGE_RECOVERY_PATH, c => c.json(ok({ token, enabled: enabled() })));
  app.post(USAGE_RECOVERY_PATH, async c => {
    if (!enabled()) return c.json(fail('RECOVERY_OWNER_REQUIRED'), 409);
    if (working) return c.json(fail('RECOVERY_BUSY'), 409);
    working = true;
    try {
      const input: unknown = await c.req.json().catch(() => null);
      if (!input || typeof input !== 'object' || Array.isArray(input)) return c.json(fail('RECOVERY_INVALID'), 400);
      const body = input as Record<string, unknown>;
      const baseRows = () => loadBucketsForRange(deps.dataDir, ALL_HISTORY);
      for (const [key, plan] of plans) if (plan.expires <= Date.now()) plans.delete(key);
      if (body.action === 'preview' && Object.keys(body).every(key => key === 'action' || key === 'files')) {
        const scanned = await scanRecoveryFiles(body.files);
        const { rows, duplicate, uncertain } = await withDataTransaction(deps.dataDir, async () => selectRecoveryRows(await baseRows(), scanned.rows, await readRecoveryRows(deps.dataDir)));
        const summary = summarizeRecovery(rows, duplicate, uncertain + scanned.uncertain, scanned.skippedFiles);
        if (rows.length) {
          summary.id = randomUUID();
          if (plans.size >= 4) plans.delete(plans.keys().next().value!);
          plans.set(summary.id, { rows, summary, expires: Date.now() + 15 * 60_000 });
        }
        return c.json(ok(summary));
      }
      if (body.action !== 'apply' || typeof body.id !== 'string' || Object.keys(body).some(key => key !== 'action' && key !== 'id')) return c.json(fail('RECOVERY_INVALID'), 400);
      const plan = plans.get(body.id);
      if (!plan) return c.json(fail('RECOVERY_PREVIEW_CHANGED'), 409);
      if (plan.applied) return c.json(ok(plan.applied));
      const applied = await withDataTransaction(deps.dataDir, async () => {
        if (!enabled()) return null;
        const base = await baseRows(), previous = await readRecoveryRows(deps.dataDir);
        if (selectRecoveryRows(base, plan.rows, previous).rows.length !== plan.rows.length) return null;
        const all = [...previous, ...plan.rows];
        await saveRecoveryRows(deps.dataDir, all);
        // The file replace above is the commit. Do not apply a second time if
        // a derived cache or notification cannot be refreshed afterwards.
        plan.applied = { tokens: plan.summary.tokens, requests: plan.summary.requests, refreshed: true };
        deps.bucketStore.replace(base, all, resolveLocalCollectSince(deps.getConfig()));
        return plan.applied;
      });
      if (!applied) {
        plans.delete(body.id);
        return c.json(fail('RECOVERY_PREVIEW_CHANGED'), 409);
      }
      try { await deps.aggregateCache?.rebuildFromRows(deps.bucketStore.getRows()); }
      catch { applied.refreshed = false; }
      try { await writeSyncDone(deps.dataDir); await deps.onSync?.(); }
      catch { applied.refreshed = false; }
      return c.json(ok(applied));
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'RECOVERY_TOO_LARGE') return c.json(fail(code), 413);
      if (code === 'RECOVERY_STORE_FULL') return c.json(fail(code), 409);
      if (code === 'RECOVERY_INVALID') return c.json(fail(code), 400);
      if ((error as NodeJS.ErrnoException).code === 'ELOCKED') return c.json(fail('RECOVERY_BUSY'), 409);
      return c.json(fail('RECOVERY_FAILED'), 500);
    } finally { working = false; }
  });
}
