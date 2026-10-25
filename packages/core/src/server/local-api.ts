import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { registerShareBackgroundApi } from './share-background-api.js';
import { registerAchievementsApi } from './achievements-api.js';
import { registerQuotaApi, isLocalPanelOrigin } from './quota-api.js';
import { registerSessionActionsApi } from './session-actions-api.js';
import { SessionQueryService, type SessionRangeQuery } from '../session-query.js';
import type { SessionListQuery } from '../session-list.js';
import { sessionsToCsv } from '../session-csv.js';

import type { LocalApiDeps } from './state.js';
import { inTimeBounds, validTimeBounds, type UsageBounds } from '../usage-window.js';
import {
  aggregateDaily,
  aggregateHourly,
  aggregateModelBreakdown,
  aggregateUsageSummary,
  resolveAggregateWindow,
} from '../aggregate.js';
import { readSessionMetrics, readSessionHistory, type SessionHistory } from '../session-collector.js';
import { aggregateSessionMetrics } from '../session-metrics.js';
import { getEffectivePricingData, getPricingStatus } from '../pricing/index.js';
import { localDateAndHour } from '../timezone.js';
import { resolveLocalCollectSince } from '../config.js';
import { normalizeSyncSource } from '../sync/index.js';
import { localDateNow, localDateDaysAgo } from '../timezone.js';
import { demoMetadata } from '../demo/types.js';
import { buildUsageReport, type UsageReportPeriod } from '../usage-report.js';
import { aggregateUsageTrend, type TrendGranularity } from '../usage-trend.js';
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

function readDateBounds(c: Context, now?: Date): UsageBounds | null | undefined {
  const fromDate = c.req.query('fromDate');
  const toDate = c.req.query('toDate');
  const fromTime = c.req.query('fromTime'), toTime = c.req.query('toTime');
  if (fromTime !== undefined || toTime !== undefined) {
    return fromDate === undefined && toDate === undefined && validTimeBounds({ fromTime, toTime }) ? { fromTime, toTime } : null;
  }
  if (fromDate === undefined && toDate === undefined) return undefined;
  const valid = (date: string | undefined): date is string => {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const stamp = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date;
  };
  if (!valid(fromDate) || !valid(toDate) || fromDate > toDate || toDate > localDateNow(undefined, now)) return null;
  return { fromDate, toDate };
}

export function createLocalApiApp(deps: LocalApiDeps): Hono {
  const app = new Hono();
  const demoNow = deps.demo ? new Date(deps.demo.referenceTime) : undefined;
  const readBounds = (c: Context, defaultDays: number) => {
    const bounds = readDateBounds(c, demoNow);
    if (bounds !== undefined || !demoNow) return bounds;
    const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || defaultDays));
    return { fromDate: localDateDaysAgo(days, undefined, demoNow), toDate: localDateNow(undefined, demoNow) };
  };
  const demoHistories = new Map<string, SessionHistory>();
  const readHistory: typeof readSessionHistory = async (dir, sources, options = {}) => {
    if (!deps.demo) return readSessionHistory(dir, sources, options);
    const key = JSON.stringify([...(options.sources ?? [])].sort());
    const cached = demoHistories.get(key);
    if (cached) return cached;
    const history = deps.demo.history;
    const selected = (source: string) => !options.sources?.length || options.sources.includes(source);
    const result = { messages: history.messages.filter(row => selected(row.source)), timingEvents: history.timingEvents.filter(row => selected(row.source)),
      observations: history.observations.filter(row => selected(row.source)), evidence: (history.evidence ?? []).filter(row => selected(row.source)), titles: new Map(history.titles), codexParents: new Map(history.codexParents), missingSources: history.missingSources.filter(selected) };
    demoHistories.set(key, result);
    return result;
  };
  const sessionQueries = new SessionQueryService(deps, readHistory);
  const readConfigView = () => {
    const config = deps.getConfig();
    return {
      deviceId: config.deviceId,
      statsSince: config.statsSince,
      localCollectSince: resolveLocalCollectSince(config),
      lastSyncAt: config.lastSyncAt ?? null,
      ...(deps.demo ? { demo: demoMetadata(deps.demo) } : {}),
    };
  };
  if (deps.demo) app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(c.req.method)) return c.json({ success: false, message: 'DEMO_READ_ONLY', data: null }, 403);
    await next();
  });
  app.use('*', cors());
  if (deps.demo) {
    app.get('/functions/tud-share-backgrounds', c => c.json(ok([])));
    app.get('/functions/tud-achievements', c => c.json(ok(deps.demo!.achievements)));
    app.get('/functions/tud-quota', c => c.json({ success: false, message: 'DEMO_QUOTA_UNAVAILABLE', data: null }, 503));
    app.get('/functions/tud-session-actions', c => c.json(ok({ directory: null, token: '', canOpenDirectory: false, canResume: false, resumeCommand: null, resumeReason: 'SESSION_ACTION_LOCAL_ONLY', reason: 'SESSION_ACTION_LOCAL_ONLY' })));
  } else {
    registerShareBackgroundApi(app, deps.dataDir);
    registerAchievementsApi(app, deps.dataDir);
    registerQuotaApi(app, deps.quota);
    registerSessionActionsApi(app, deps.dataDir, deps.sessionActions, deps.sessionActionsIpc);
  }

  app.get('/health', (c) => {
    if (process.env.QUOTERN_DEV_ISOLATED === '1' && process.env.QUOTERN_DEV_INSTANCE_ID) {
      c.header('X-Quotern-Dev-Instance', process.env.QUOTERN_DEV_INSTANCE_ID);
    }
    return c.json({ ok: true });
  });

  const summaryHandler = async (c: Context) => {
    const config = deps.getConfig();
    const rows = deps.bucketStore.getRows();
    const statsSince = resolveLocalCollectSince(config);
    if (deps.demo) return c.json(ok(aggregateUsageSummary(rows, statsSince, undefined, demoNow)));
    if (deps.aggregateCache) {
      await deps.aggregateCache.ensureLoaded();
      return c.json(ok(deps.aggregateCache.getUsageSummary(rows, statsSince)));
    }
    return c.json(ok(getUsageSummary(config, rows)));
  };

  app.get('/functions/tud-usage-summary', summaryHandler);
  app.get('/functions/tud-account-usage-summary', summaryHandler);

  app.get('/functions/tud-pricing', (c) => {
    c.header('Cache-Control', 'no-store');
    const { hasOverlay, updatedAt, refreshing } = getPricingStatus();
    // Custom source URLs can embed credentials; the panel needs only table state.
    return c.json(ok({ pricing: getEffectivePricingData(), status: { hasOverlay, updatedAt: deps.demo?.exportedAt ?? updatedAt, refreshing: deps.demo ? false : refreshing } }));
  });

  app.get('/functions/tud-usage-report', (c) => {
    try {
      const params = new URL(c.req.url).searchParams;
      const allowed = new Set(['period', 'days', 'fromDate', 'toDate', 'fromTime', 'toTime', 'sources', 'model', 'project']);
      for (const key of params.keys()) {
        if (!allowed.has(key) || params.getAll(key).length !== 1) throw new Error(`无效或重复的参数: ${key}`);
      }
      const days = params.get('days');
      if (days !== null && !/^\d+$/.test(days)) throw new Error('days 必须是正整数');
      const config = deps.getConfig();
      return c.json(ok(buildUsageReport(deps.bucketStore.getRows(), {
        period: (params.get('period') ?? undefined) as UsageReportPeriod | undefined,
        days: days === null ? undefined : Number(days),
        fromDate: params.get('fromDate') ?? undefined,
        toDate: params.get('toDate') ?? undefined,
        fromTime: params.get('fromTime') ?? undefined, toTime: params.get('toTime') ?? undefined,
        sources: params.has('sources') ? params.get('sources')!.split(',') : undefined,
        model: params.get('model') ?? undefined,
        project: params.get('project') ?? undefined,
      }, { collectSince: resolveLocalCollectSince(config), lastSyncAt: config.lastSyncAt, snapshot: 'runtime', now: demoNow })));
    } catch (error) {
      return c.json({ success: false, message: error instanceof Error ? error.message : 'INVALID_USAGE_QUERY', data: null }, 400);
    }
  });

  app.get('/functions/tud-usage-trend', (c) => {
    try {
      const params = new URL(c.req.url).searchParams;
      const allowed = new Set(['granularity', 'days', 'fromDate', 'toDate', 'fromTime', 'toTime', 'sources', 'model', 'project']);
      for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) throw new Error('INVALID_TREND_QUERY');
      const days = params.get('days');
      if (days !== null && !/^\d+$/.test(days)) throw new Error('INVALID_DAYS');
      const config = deps.getConfig();
      c.header('Cache-Control', 'no-store');
      return c.json(ok(aggregateUsageTrend(deps.bucketStore.getRows(), {
        granularity: (params.get('granularity') ?? 'daily') as TrendGranularity,
        days: days === null ? undefined : Number(days), fromDate: params.get('fromDate') ?? undefined, toDate: params.get('toDate') ?? undefined,
        fromTime: params.get('fromTime') ?? undefined, toTime: params.get('toTime') ?? undefined,
        sources: params.has('sources') ? params.get('sources')!.split(',') : undefined,
        model: params.get('model') ?? undefined, project: params.get('project') ?? undefined,
      }, { collectSince: resolveLocalCollectSince(config), lastSyncAt: config.lastSyncAt, snapshot: 'runtime', now: demoNow })));
    } catch (error) {
      return c.json({ success: false, message: error instanceof Error ? error.message : 'INVALID_TREND_QUERY', data: null }, 400);
    }
  });

  app.get('/functions/tud-usage-sessions', async (c) => {
    const bounds = readBounds(c, 90);
    if (bounds === null) return c.json({ success: false, message: 'INVALID_DATE_RANGE', data: null }, 400);
    const rawSources = c.req.query('sources');
    const sources = rawSources?.split(',').map((source) => normalizeSyncSource(source));
    if (sources?.some((source) => !source)) return c.json({ success: false, message: 'INVALID_SOURCE', data: null }, 400);
    const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || 90));
    const window = resolveAggregateWindow(days, resolveLocalCollectSince(deps.getConfig()), undefined, bounds);
    const fromDate = window.fromDate > window.statsSinceDate ? window.fromDate : window.statsSinceDate;
    const usageSources = [...new Set(deps.bucketStore.getRows().filter((row) => {
      const date = localDateAndHour(row.hour_start).date;
      return date >= fromDate && date <= window.toDate && inTimeBounds(row.hour_start, bounds) && (row.total_tokens > 0 || row.conversation_count > 0);
    }).map((row) => row.source))];
    const options = {
      ...bounds, fromDate, toDate: window.toDate,
      ...(sources ? { sources: sources as string[] } : {}),
    };
    if (!deps.demo) return c.json(ok(await readSessionMetrics(deps.dataDir, usageSources, options)));
    const history = await readHistory(deps.dataDir, usageSources, options);
    return c.json(ok(aggregateSessionMetrics(history.messages, { ...options, missingSources: history.missingSources, timingEvents: history.timingEvents })));
  });

  const sessionRange = (c: Context): SessionRangeQuery | null => {
    const bounds = readBounds(c, 7);
    if (bounds === null) return null;
    const sources = c.req.query('sources')?.split(',').map(source => normalizeSyncSource(source));
    if (sources?.some(source => !source)) return null;
    return { days: Math.min(365, Math.max(1, Number(c.req.query('days')) || 7)), bounds, sources: sources as string[] | undefined };
  };
  const sessionFilters = (c: Context): SessionListQuery | null => {
    const integer = (name: string, fallback: number) => {
      const raw = c.req.query(name);
      return raw === undefined ? fallback : /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : 0;
    };
    const page = integer('page', 1), pageSize = integer('pageSize', 12);
    const sort = c.req.query('sort') ?? 'recent', direction = c.req.query('direction') ?? 'descending';
    const filterSources = c.req.query('filterSources')?.split(',').map(source => normalizeSyncSource(source));
    if (page < 1 || ![12, 24, 48].includes(pageSize) || !['recent', 'tokens', 'cost', 'duration'].includes(sort) || !['ascending', 'descending'].includes(direction) || filterSources?.some(source => !source)) return null;
    return { page, pageSize, sort: sort as SessionListQuery['sort'], direction: direction as SessionListQuery['direction'], filterSources: filterSources as string[] | undefined,
      q: c.req.query('q'), project: c.req.query('project'), model: c.req.query('model'), group: c.req.query('group') };
  };

  app.get('/functions/tud-session-list', async c => {
    if (!isLocalPanelOrigin(c.req.header('Origin'), c.req.url)) return c.json({ success: false, message: 'SESSION_FORBIDDEN_ORIGIN', data: null }, 403);
    const range = sessionRange(c), filters = sessionFilters(c);
    if (!range || !filters) return c.json({ success: false, message: 'INVALID_SESSION_QUERY', data: null }, 400);
    c.header('Cache-Control', 'no-store');
    if (['csv', 'export'].includes(c.req.query('format') ?? '')) {
      const csv = sessionsToCsv(await sessionQueries.export(range, filters));
      if (c.req.query('format') === 'export') return c.json(ok({ csv }));
      c.header('Content-Type', 'text/csv; charset=utf-8'); c.header('Content-Disposition', 'attachment; filename="quotern-sessions.csv"');
      return c.body(csv);
    }
    return c.json(ok(await sessionQueries.list(range, filters)));
  });

  app.get('/functions/tud-session-detail', async c => {
    if (!isLocalPanelOrigin(c.req.header('Origin'), c.req.url)) return c.json({ success: false, message: 'SESSION_FORBIDDEN_ORIGIN', data: null }, 403);
    const source = normalizeSyncSource(c.req.query('source') ?? ''), sessionId = c.req.query('sessionId');
    const range = sessionRange(c);
    if (!source || !sessionId || sessionId.length > 512 || /[\u0000-\u001f]/.test(sessionId) || !range) return c.json({ success: false, message: 'INVALID_SESSION_TARGET', data: null }, 400);
    c.header('Cache-Control', 'no-store');
    return c.json(ok(await sessionQueries.detail({ ...range, collected: !range.bounds }, { source, sessionId })));
  });

  app.get('/functions/tud-session-activity', async c => {
    if (!isLocalPanelOrigin(c.req.header('Origin'), c.req.url)) return c.json({ success: false, message: 'SESSION_FORBIDDEN_ORIGIN', data: null }, 403);
    const targetSource = c.req.query('sessionSource'), targetId = c.req.query('sessionId');
    const targeted = targetSource !== undefined || targetId !== undefined;
    const preview = Boolean(deps.demo && !targeted && c.req.query('preview') === '6' && c.req.query('format') !== 'csv');
    if (targeted && (!['codex', 'claude', 'dsh'].includes(targetSource ?? '') || !targetId || targetId.length > 512 || /[\u0000-\u001f]/.test(targetId))) return c.json({ success: false, message: 'INVALID_SESSION_TARGET', data: null }, 400);
    // Notification lookup reads already-collected history; it never starts collection or widens localCollectSince.
    const bounds = targeted ? undefined : readBounds(c, 7);
    if (bounds === null) return c.json({ success: false, message: 'INVALID_DATE_RANGE', data: null }, 400);
    const sources = targeted ? [targetSource!] : c.req.query('sources')?.split(',').map(source => normalizeSyncSource(source));
    if (sources?.some(source => !source)) return c.json({ success: false, message: 'INVALID_SOURCE', data: null }, 400);
    const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || 7));
    c.header('Cache-Control', 'no-store');
    const snapshot = await sessionQueries.full({ days, bounds, sources: sources as string[] | undefined, collected: targeted });
    const model = c.req.query('model');
    const previewSessions = preview ? snapshot.sessions.filter(s => !model || s.models?.some(m => m.model === model) || s.model === model).sort((a,b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0,6) : undefined;
    if (targeted) snapshot.sessions = snapshot.sessions.filter(session => session.source === targetSource && session.sessionId === targetId);
    if(model)snapshot.sessions=snapshot.sessions.filter(s=>s.models?.some(m=>m.model===model)||s.model===model);
    if(c.req.query('format')==='csv') {
      c.header('Content-Type','text/csv; charset=utf-8');c.header('Content-Disposition','attachment; filename="quotern-sessions.csv"');
      return c.body(sessionsToCsv(snapshot.sessions));
    }
    if (previewSessions) {
      const sessionKey = (source: string, id: string) => JSON.stringify([source, id]);
      const keys = new Set(snapshot.sessions.map(s => sessionKey(s.source,s.sessionId)));
      snapshot.sessionCount = snapshot.sessions.length;
      snapshot.billing = snapshot.billing.map(({sessionRefs, ...row}) => ({...row, sessionCount:sessionRefs?.filter(s=>keys.has(sessionKey(s.source,s.sessionId))).length ?? 0}));
      snapshot.sessions = previewSessions;
    }
    return c.json(ok(snapshot));
  });

  app.get('/functions/tud-context-audit', async c => {
    if(!isLocalPanelOrigin(c.req.header('Origin'),c.req.url))return c.json({success:false,message:'SESSION_FORBIDDEN_ORIGIN',data:null},403);
    if (deps.demo) return c.json({ success: false, message: 'DEMO_CONTEXT_UNAVAILABLE', data: null }, 503);
    c.header('Cache-Control','no-store');
    const {auditContextSources}=await import('../context-audit.js');
    return c.json(ok(await auditContextSources()));
  });

  app.get('/functions/tud-session-directory',async c=>{
    if(!isLocalPanelOrigin(c.req.header('Origin'),c.req.url))return c.json({success:false,message:'SESSION_FORBIDDEN_ORIGIN',data:null},403);
    if (deps.demo) return c.json(ok({ directory: null }));
    const source=c.req.query('source')??'',sessionId=c.req.query('sessionId')??'';
    if(!['codex','claude','dsh','pi','zcode','antigravity'].includes(source)||!sessionId||sessionId.length>512||/[\u0000-\u001f]/.test(sessionId))return c.json({success:false,message:'INVALID_SESSION_TARGET',data:null},400);
    c.header('Cache-Control','no-store');const{readSessionDirectory}=await import('../session-directory.js');
    return c.json(ok({directory:await readSessionDirectory(deps.dataDir,source,sessionId)}));
  });

  app.get('/functions/tud-usage-daily', async (c) => {
    const bounds = readBounds(c, 90);
    if (bounds === null) return c.json({ success: false, message: 'INVALID_DATE_RANGE', data: null }, 400);
    const config = deps.getConfig();
    const rows = deps.bucketStore.getRows();
    const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || 90));
    const statsSince = resolveLocalCollectSince(config);
    if (deps.aggregateCache) {
      await deps.aggregateCache.ensureLoaded();
      return c.json(ok(deps.aggregateCache.getDaily(rows, days, statsSince, bounds)));
    }
    return c.json(ok(aggregateDaily(rows, days, statsSince, undefined, bounds)));
  });

  app.get('/functions/tud-usage-hourly', async (c) => {
    const bounds = readBounds(c, 1);
    if (bounds === null) return c.json({ success: false, message: 'INVALID_DATE_RANGE', data: null }, 400);
    const config = deps.getConfig();
    const rows = deps.bucketStore.getRows();
    const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || 1));
    const statsSince = resolveLocalCollectSince(config);
    if (deps.aggregateCache) {
      await deps.aggregateCache.ensureLoaded();
      return c.json(ok(deps.aggregateCache.getHourly(rows, days, statsSince, bounds)));
    }
    return c.json(ok(aggregateHourly(rows, days, statsSince, undefined, bounds)));
  });

  app.get('/functions/tud-usage-model-breakdown', async (c) => {
    const bounds = readBounds(c, 30);
    if (bounds === null) return c.json({ success: false, message: 'INVALID_DATE_RANGE', data: null }, 400);
    const config = deps.getConfig();
    const rows = deps.bucketStore.getRows();
    const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || 30));
    const statsSince = resolveLocalCollectSince(config);
    if (deps.aggregateCache) {
      await deps.aggregateCache.ensureLoaded();
      return c.json(
        ok(deps.aggregateCache.getModelBreakdown(rows, days, statsSince, bounds)),
      );
    }
    return c.json(ok(aggregateModelBreakdown(rows, days, statsSince, undefined, bounds)));
  });

  app.get('/functions/tud-sync-status', async (c) => {
    const config = deps.getConfig();
    if (deps.demo) return c.json(ok({ lastSyncAt: deps.demo.lastSyncAt, statsSince: deps.demo.collectSince, sources: {}, demo: demoMetadata(deps.demo) }));
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
    let custom = false;
    try {
      const body = await c.req.json<{ days?: number; custom?: boolean }>();
      if (body?.days != null) days = Number(body.days);
      custom = body?.custom === true;
    } catch {
      // empty body → default 7
    }
    try {
      const result = await ensureLocalCollectRange(deps, days, custom);
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
