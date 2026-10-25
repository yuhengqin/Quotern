import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { registerShareBackgroundApi } from './share-background-api.js';
import { registerAchievementsApi } from './achievements-api.js';
import { registerQuotaApi, isLocalPanelOrigin } from './quota-api.js';

import type { LocalApiDeps } from './state.js';
import { inTimeBounds, validTimeBounds, type UsageBounds } from '../usage-window.js';
import {
  aggregateDaily,
  aggregateHourly,
  aggregateModelBreakdown,
  resolveAggregateWindow,
} from '../aggregate.js';
import { readSessionMetrics, readSessionHistory } from '../session-collector.js';
import { aggregateSessionActivity } from '../session-observation.js';
import { attachSessionTitles } from '../session-titles.js';
import { aggregateSessionMetrics, type SessionMessage } from '../session-metrics.js';
import { attributeTaskTimingEvents, type SessionTimingEvent } from '../task-timing.js';
import { computeTokens, getEffectivePricingData, getPricingStatus } from '../pricing/index.js';
import { localDateAndHour } from '../timezone.js';
import { resolveLocalCollectSince } from '../config.js';
import { normalizeSyncSource } from '../sync/index.js';
import { localDateNow } from '../timezone.js';
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

function readDateBounds(c: Context): UsageBounds | null | undefined {
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
  if (!valid(fromDate) || !valid(toDate) || fromDate > toDate || toDate > localDateNow()) return null;
  return { fromDate, toDate };
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
  registerShareBackgroundApi(app, deps.dataDir);
  registerAchievementsApi(app, deps.dataDir);
  registerQuotaApi(app, deps.quota);

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
    return c.json(ok({ pricing: getEffectivePricingData(), status: { hasOverlay, updatedAt, refreshing } }));
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
      }, { collectSince: resolveLocalCollectSince(config), lastSyncAt: config.lastSyncAt, snapshot: 'runtime' })));
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
      }, { collectSince: resolveLocalCollectSince(config), lastSyncAt: config.lastSyncAt, snapshot: 'runtime' })));
    } catch (error) {
      return c.json({ success: false, message: error instanceof Error ? error.message : 'INVALID_TREND_QUERY', data: null }, 400);
    }
  });

  app.get('/functions/tud-usage-sessions', async (c) => {
    const bounds = readDateBounds(c);
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
    return c.json(ok(await readSessionMetrics(deps.dataDir, usageSources, {
      ...bounds, fromDate, toDate: window.toDate,
      ...(sources ? { sources: sources as string[] } : {}),
    })));
  });

  app.get('/functions/tud-session-activity', async c => {
    if (!isLocalPanelOrigin(c.req.header('Origin'), c.req.url)) return c.json({ success: false, message: 'SESSION_FORBIDDEN_ORIGIN', data: null }, 403);
    const targetSource = c.req.query('sessionSource'), targetId = c.req.query('sessionId');
    const targeted = targetSource !== undefined || targetId !== undefined;
    if (targeted && (!['codex', 'claude', 'dsh'].includes(targetSource ?? '') || !targetId || targetId.length > 512 || /[\u0000-\u001f]/.test(targetId))) return c.json({ success: false, message: 'INVALID_SESSION_TARGET', data: null }, 400);
    // Notification lookup reads already-collected history; it never starts collection or widens localCollectSince.
    const bounds = targeted ? undefined : readDateBounds(c);
    if (bounds === null) return c.json({ success: false, message: 'INVALID_DATE_RANGE', data: null }, 400);
    const sources = targeted ? [targetSource!] : c.req.query('sources')?.split(',').map(source => normalizeSyncSource(source));
    if (sources?.some(source => !source)) return c.json({ success: false, message: 'INVALID_SOURCE', data: null }, 400);
    const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || 7));
    const window = resolveAggregateWindow(days, resolveLocalCollectSince(deps.getConfig()), undefined, bounds);
    const fromDate = targeted ? window.statsSinceDate : window.fromDate > window.statsSinceDate ? window.fromDate : window.statsSinceDate;
    const rows = deps.bucketStore.getRows().filter(row => {
      const date = localDateAndHour(row.hour_start).date;
      return date >= fromDate && date <= window.toDate && inTimeBounds(row.hour_start, bounds) && (!sources?.length || (sources as string[]).includes(row.source));
    });
    const usageSources = [...new Set(rows.map(row => row.source))];
    const options = { ...bounds, fromDate, toDate: window.toDate, ...(sources ? { sources: sources as string[] } : {}) };
    const history = await readSessionHistory(deps.dataDir, usageSources, options);
    const observed = new Set(history.observations.filter(event => event.usageKnown).map(event => event.source));
    const missingSources = [...new Set([...history.missingSources, ...usageSources.filter(source => !observed.has(source))])];
    c.header('Cache-Control', 'no-store');
    const snapshot = aggregateSessionActivity(history.observations, history.messages, { ...options, missingSources, totalTokens: rows.reduce((sum, row) => sum + computeTokens(row), 0) });
    snapshot.range = { fromDate, toDate: window.toDate, ...(bounds?.fromTime ? { fromTime: bounds.fromTime } : {}), ...(bounds?.toTime ? { toTime: bounds.toTime } : {}), kind: targeted ? 'collected' : 'selected' };
    await attachSessionTitles(snapshot.sessions, history.titles);
    const sessionKey = (source: string, id: string) => JSON.stringify([source, id]);
    const messages = new Map<string, SessionMessage[]>(), timings = new Map<string, SessionTimingEvent[]>();
    for (const message of history.messages) { const key = sessionKey(message.source, message.sessionId); const group = messages.get(key) ?? []; group.push(message); messages.set(key, group); }
    for (const event of attributeTaskTimingEvents(history.timingEvents, history.codexParents)) { const key = sessionKey(event.source, event.sessionId); const group = timings.get(key) ?? []; group.push(event); timings.set(key, group); }
    for (const session of snapshot.sessions) {
      const key = sessionKey(session.source, session.sessionId);
      const metric = aggregateSessionMetrics(messages.get(key) ?? [], { ...options, timingEvents: timings.get(key) ?? [] });
      session.taskSeconds = metric.taskSeconds; session.taskTimingKind = metric.taskTimingKind;
    }
    const labels = new Map<string, Set<string>>();
    for (const provider of (deps.getQuotaState?.() ?? deps.quota?.getState())?.providers ?? []) if (provider.provenance?.accountRef) {
      const names = labels.get(provider.provenance.accountRef) ?? new Set<string>();
      names.add(provider.profileLabel ?? '默认账号'); labels.set(provider.provenance.accountRef, names);
    }
    for (const row of [...snapshot.sessions.map(session => session.billing), ...snapshot.billing]) {
      if (row.accountRef && labels.has(row.accountRef)) row.accountLabel = [...labels.get(row.accountRef)!].join(' / ');
    }
    const { enrichSessionInsights, sessionsToCsv } = await import('../session-insights.js');
    const inWindow = (stamp: string) => { const date = localDateAndHour(stamp).date; return date >= fromDate && date <= window.toDate && inTimeBounds(stamp,bounds); };
    enrichSessionInsights(snapshot.sessions,history.messages.filter(m=>inWindow(m.timestamp)),history.evidence.filter(e=>e.kind==='metadata'||inWindow(e.timestamp)));
    if (targeted) snapshot.sessions = snapshot.sessions.filter(session => session.source === targetSource && session.sessionId === targetId);
    const model=c.req.query('model');
    if(model)snapshot.sessions=snapshot.sessions.filter(s=>s.models?.some(m=>m.model===model)||s.model===model);
    if(c.req.query('format')==='csv') {
      c.header('Content-Type','text/csv; charset=utf-8');c.header('Content-Disposition','attachment; filename="quotern-sessions.csv"');
      return c.body(sessionsToCsv(snapshot.sessions));
    }
    return c.json(ok(snapshot));
  });

  app.get('/functions/tud-context-audit', async c => {
    if(!isLocalPanelOrigin(c.req.header('Origin'),c.req.url))return c.json({success:false,message:'SESSION_FORBIDDEN_ORIGIN',data:null},403);
    c.header('Cache-Control','no-store');
    const {auditContextSources}=await import('../context-audit.js');
    return c.json(ok(await auditContextSources()));
  });

  app.get('/functions/tud-session-directory',async c=>{
    if(!isLocalPanelOrigin(c.req.header('Origin'),c.req.url))return c.json({success:false,message:'SESSION_FORBIDDEN_ORIGIN',data:null},403);
    const source=c.req.query('source')??'',sessionId=c.req.query('sessionId')??'';
    if(!['codex','claude','dsh'].includes(source)||!sessionId||sessionId.length>512||/[\u0000-\u001f]/.test(sessionId))return c.json({success:false,message:'INVALID_SESSION_TARGET',data:null},400);
    c.header('Cache-Control','no-store');const{readSessionDirectory}=await import('../session-directory.js');
    return c.json(ok({directory:await readSessionDirectory(deps.dataDir,source,sessionId)}));
  });

  app.get('/functions/tud-usage-daily', async (c) => {
    const bounds = readDateBounds(c);
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
    const bounds = readDateBounds(c);
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
    const bounds = readDateBounds(c);
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
