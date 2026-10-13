import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';

import type { LocalApiDeps } from './state.js';
import {
  aggregateDaily,
  aggregateHourly,
  aggregateModelBreakdown,
} from '../aggregate.js';
import { resolveLocalCollectSince } from '../config.js';
import { normalizeSyncSource } from '../sync/index.js';
import {
  ensureLocalCollectRange,
  getHookStatus,
  getUsageSummary,
  runSync,
  getSyncStatusPayload,
} from './state.js';

function ok<T>(data: T) {
  return { success: true as const, message: 'ok', data };
}

export function createLocalApiApp(deps: LocalApiDeps): Hono {
  const app = new Hono();
  const readConfigView = () => {
    const config = deps.getConfig();
    return {
      deviceId: config.deviceId,
      statsSince: config.statsSince,
      localCollectSince: resolveLocalCollectSince(config),
      lastSyncAt: config.lastSyncAt ?? null,
    };
  };
  app.use('*', cors());

  app.get('/health', (c) => c.json({ ok: true }));

  const summaryHandler = async (c: Context) => {
    const config = deps.getConfig();
    const rows = deps.bucketStore.getRows();
    const statsSince = resolveLocalCollectSince(config);
    if (deps.aggregateCache) {
      await deps.aggregateCache.ensureLoaded();
      return c.json(ok(deps.aggregateCache.getUsageSummary(rows, statsSince)));
    }
    return c.json(ok(getUsageSummary(config, rows)));
  };

  app.get('/functions/tud-usage-summary', summaryHandler);
  app.get('/functions/tud-account-usage-summary', summaryHandler);

  app.get('/functions/tud-usage-daily', async (c) => {
    const config = deps.getConfig();
    const rows = deps.bucketStore.getRows();
    const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || 90));
    const statsSince = resolveLocalCollectSince(config);
    if (deps.aggregateCache) {
      await deps.aggregateCache.ensureLoaded();
      return c.json(ok(deps.aggregateCache.getDaily(rows, days, statsSince)));
    }
    return c.json(ok(aggregateDaily(rows, days, statsSince)));
  });

  app.get('/functions/tud-usage-hourly', async (c) => {
    const config = deps.getConfig();
    const rows = deps.bucketStore.getRows();
    const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || 1));
    const statsSince = resolveLocalCollectSince(config);
    if (deps.aggregateCache) {
      await deps.aggregateCache.ensureLoaded();
      return c.json(ok(deps.aggregateCache.getHourly(rows, days, statsSince)));
    }
    return c.json(ok(aggregateHourly(rows, days, statsSince)));
  });

  app.get('/functions/tud-usage-model-breakdown', async (c) => {
    const config = deps.getConfig();
    const rows = deps.bucketStore.getRows();
    const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || 30));
    const statsSince = resolveLocalCollectSince(config);
    if (deps.aggregateCache) {
      await deps.aggregateCache.ensureLoaded();
      return c.json(
        ok(deps.aggregateCache.getModelBreakdown(rows, days, statsSince)),
      );
    }
    return c.json(ok(aggregateModelBreakdown(rows, days, statsSince)));
  });

  app.get('/functions/tud-sync-status', async (c) => {
    const config = deps.getConfig();
    const rows = deps.bucketStore.getRows();
    const hooks = deps.getHookStatus
      ? await deps.getHookStatus()
      : await getHookStatus(deps.dataDir);
    return c.json(ok(await getSyncStatusPayload(deps.dataDir, config, rows, hooks)));
  });

  app.get('/functions/tud-config', (c) => {
    return c.json(ok(readConfigView()));
  });

  app.post('/functions/tud-trigger-sync', async (c) => {
    let source: string | undefined;
    try {
      const body = await c.req.json<{ source?: string }>();
      source = body?.source;
    } catch {
      // empty body ok
    }
    // `all`/missing → full sweep; unknown values must 400 instead of running
    // zero parsers behind a success envelope.
    const filter = normalizeSyncSource(source);
    if (filter === null) {
      return c.json(
        { success: false, message: 'UNKNOWN_SYNC_SOURCE', data: null },
        400,
      );
    }
    const result = await runSync(deps, filter);
    return c.json(
      ok({
        ok: result.ok,
        results: result.results,
        message: 'sync complete',
      }),
    );
  });

  app.post('/functions/tud-ensure-local-range', async (c) => {
    let days = 7;
    try {
      const body = await c.req.json<{ days?: number }>();
      if (body?.days != null) days = Number(body.days);
    } catch {
      // empty body → default 7
    }
    try {
      const result = await ensureLocalCollectRange(deps, days);
      return c.json(
        ok({
          expanded: result.expanded,
          localCollectSince: resolveLocalCollectSince(result.config),
          statsSince: result.config.statsSince,
          sync: result.sync
            ? { ok: result.sync.ok, results: result.sync.results }
            : null,
          message: result.expanded
            ? 'local range expanded and synced'
            : 'local range already covered',
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('INVALID_RANGE_DAYS')) {
        return c.json({ success: false, message: 'INVALID_RANGE_DAYS', data: null }, 400);
      }
      throw err;
    }
  });

  return app;
}
