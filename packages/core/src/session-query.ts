import { resolveAggregateWindow } from './aggregate.js';
import { resolveLocalCollectSince } from './config.js';
import type { LocalApiDeps } from './server/state.js';
import { computeTokens, getPricingSnapshot } from './pricing/index.js';
import { aggregateSessionActivity, prepareSessionObservations, type PreparedSessionObservations, type SessionActivity, type SessionActivitySnapshot, type SessionObservation } from './session-observation.js';
import { readSessionHistory, type SessionHistory } from './session-collector.js';
import type { SessionMetricOptions, SessionMessage } from './session-metrics.js';
import { aggregateTaskTiming, attributeTaskTimingEvents, type SessionTimingEvent } from './task-timing.js';
import { attachSessionTitles, sessionTitleKey } from './session-titles.js';
import { enrichSessionInsights, type SessionEvidence } from './session-insights.js';
import { pageSessionList, selectSessionList, sessionKey, sessionTree, type SessionDetailResponse, type SessionListPage, type SessionListQuery } from './session-list.js';
import { localDateAndHour } from './timezone.js';
import { inTimeBounds, type UsageBounds } from './usage-window.js';

export interface SessionRangeQuery { days: number; bounds?: UsageBounds; sources?: string[]; collected?: boolean }
interface RangeState {
  history: SessionHistory; prepared: PreparedSessionObservations; options: SessionMetricOptions; snapshot: SessionActivitySnapshot;
  modelRows: Map<string, SessionActivity>; clocks?: { messages: Map<string, SessionMessage[]>; timings: Map<string, SessionTimingEvent[]> };
  durations: Map<string, ReturnType<typeof aggregateTaskTiming>>;
}

function markRelationCycles(rows: SessionActivity[]): void {
  const byId = new Map(rows.map(row => [sessionKey(row), row])), checked = new Set<string>();
  for (const row of rows) {
    const path: SessionActivity[] = [], positions = new Map<string, number>();
    let cursor: SessionActivity | undefined = row;
    while (cursor?.relation?.parentId && !checked.has(sessionKey(cursor))) {
      const id = sessionKey(cursor), position = positions.get(id);
      if (position !== undefined) {
        for (const member of path.slice(position)) member.relation!.relationConflict = true;
        break;
      }
      positions.set(id, path.length); path.push(cursor);
      cursor = byId.get(sessionKey({ source: cursor.source, sessionId: cursor.relation.parentId }));
    }
    for (const member of path) checked.add(sessionKey(member));
  }
}

/** Per-runtime caches. Page numbers never duplicate the expensive range snapshot. */
export class SessionQueryService {
  private readonly ranges = new Map<string, RangeState>();
  private readonly historyIds = new WeakMap<SessionObservation[], number>();
  private nextHistoryId = 0;
  private prepared = new WeakMap<SessionObservation[], PreparedSessionObservations>();
  private pricing = getPricingSnapshot();

  constructor(private readonly deps: LocalApiDeps, private readonly readHistory: typeof readSessionHistory) {}

  private async range(query: SessionRangeQuery): Promise<RangeState> {
    const bucketRevision = this.deps.bucketStore.getRevision();
    const window = resolveAggregateWindow(query.days, resolveLocalCollectSince(this.deps.getConfig()), undefined, query.bounds);
    const fromDate = query.collected ? window.statsSinceDate : window.fromDate > window.statsSinceDate ? window.fromDate : window.statsSinceDate;
    const options = { ...query.bounds, fromDate, toDate: window.toDate, ...(query.sources?.length ? { sources: [...new Set(query.sources)].sort() } : {}) };
    const rows = this.deps.bucketStore.getRows().filter(row => {
      const date = localDateAndHour(row.hour_start).date;
      return date >= fromDate && date <= window.toDate && inTimeBounds(row.hour_start, query.bounds) && (!options.sources?.length || options.sources.includes(row.source));
    });
    const usageSources = [...new Set(rows.map(row => row.source))];
    const history = await this.readHistory(this.deps.dataDir, usageSources, options);
    if (this.deps.bucketStore.getRevision() !== bucketRevision) return this.range(query);
    const pricing = getPricingSnapshot();
    if (pricing.builtin !== this.pricing.builtin || pricing.overlay !== this.pricing.overlay) {
      this.pricing = pricing; this.ranges.clear(); this.prepared = new WeakMap();
    }
    let historyId = this.historyIds.get(history.observations);
    if (!historyId) { historyId = ++this.nextHistoryId; this.historyIds.set(history.observations, historyId); }
    const key = JSON.stringify([historyId, bucketRevision, options, history.missingSources, usageSources.sort(), Boolean(query.collected)]);
    const hit = this.ranges.get(key);
    if (hit) { this.ranges.delete(key); this.ranges.set(key, hit); return hit; }
    let prepared = this.prepared.get(history.observations);
    if (!prepared) { prepared = prepareSessionObservations(history.observations); this.prepared.set(history.observations, prepared); }
    const observed = new Set(history.observations.filter(event => event.usageKnown).map(event => event.source));
    const missingSources = [...new Set([...history.missingSources, ...usageSources.filter(source => !observed.has(source))])];
    const snapshot = aggregateSessionActivity([], history.messages, { ...options, prepared, modelDetails: false, missingSources,
      totalTokens: rows.reduce((sum, row) => sum + computeTokens(row), 0), now: this.deps.demo ? Date.parse(this.deps.demo.referenceTime) : undefined });
    snapshot.range = { fromDate, toDate: window.toDate, ...(query.bounds?.fromTime ? { fromTime: query.bounds.fromTime } : {}), ...(query.bounds?.toTime ? { toTime: query.bounds.toTime } : {}), kind: query.collected ? 'collected' : 'selected' };
    const metadata = new Map<string, SessionEvidence[]>();
    for (const event of history.evidence) if (event.kind === 'metadata') {
      const id = sessionKey(event), group = metadata.get(id) ?? []; group.push(event); metadata.set(id, group);
    }
    for (const row of snapshot.sessions) {
      const events = (metadata.get(sessionKey(row)) ?? []).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const parentId = [...events].reverse().find(event => event.parentId)?.parentId ?? null;
      const relationKind = [...events].reverse().find(event => event.relationKind)?.relationKind ?? 'unknown';
      row.relation = { parentId, relationKind, relationConflict: events.some(event => event.relationConflict) || new Set(events.map(event => event.parentId).filter(Boolean)).size > 1,
        agentNickname: [...events].reverse().find(event => event.agentNickname?.trim())?.agentNickname ?? null,
        agentRole: [...events].reverse().find(event => event.agentRole?.trim())?.agentRole ?? null };
    }
    markRelationCycles(snapshot.sessions);
    const state = { history, prepared, options, snapshot, modelRows: new Map(), durations: new Map() };
    this.ranges.set(key, state);
    while (this.ranges.size > 12) this.ranges.delete(this.ranges.keys().next().value!);
    return state;
  }

  private async titled(state: RangeState, rows = state.snapshot.sessions): Promise<SessionActivity[]> {
    const result = rows.map(row => ({ ...row, billing: { ...row.billing } }));
    if (this.deps.demo) for (const row of result) row.sessionTitle = state.history.titles.get(sessionTitleKey(row.source, row.sessionId))?.title;
    else await attachSessionTitles(result, state.history.titles);
    return result;
  }

  private labels(snapshot: SessionActivitySnapshot): void {
    const labels = new Map<string, Set<string>>();
    for (const provider of (this.deps.getQuotaState?.() ?? this.deps.quota?.getState())?.providers ?? []) if (provider.provenance?.accountRef) {
      const names = labels.get(provider.provenance.accountRef) ?? new Set<string>();
      names.add(provider.profileLabel ?? '默认账号'); labels.set(provider.provenance.accountRef, names);
    }
    for (const row of [...snapshot.sessions.map(session => session.billing), ...snapshot.billing]) if (row.accountRef && labels.has(row.accountRef)) row.accountLabel = [...labels.get(row.accountRef)!].join(' / ');
  }

  private timing(state: RangeState, row: SessionActivity) {
    const id = sessionKey(row), cached = state.durations.get(id);
    if (cached) return cached;
    if (!state.clocks) {
      const messages = new Map<string, SessionMessage[]>(), timings = new Map<string, SessionTimingEvent[]>();
      for (const message of state.history.messages) { const key = sessionKey(message), group = messages.get(key) ?? []; group.push(message); messages.set(key, group); }
      for (const event of attributeTaskTimingEvents(state.history.timingEvents, state.history.codexParents)) { const key = sessionKey(event), group = timings.get(key) ?? []; group.push(event); timings.set(key, group); }
      state.clocks = { messages, timings };
    }
    const metric = aggregateTaskTiming(state.clocks.messages.get(id) ?? [], state.clocks.timings.get(id) ?? [], state.options);
    state.durations.set(id, metric);
    return metric;
  }

  async list(query: SessionRangeQuery, filters: SessionListQuery): Promise<SessionListPage> {
    const state = await this.range(query);
    const sessions = await this.titled(state);
    if (filters.sort === 'duration') for (const row of sessions) row.taskSeconds = this.timing(state, row).taskSeconds;
    const page = pageSessionList({ ...state.snapshot, sessions, billing: state.snapshot.billing.map(row => ({ ...row })) }, filters);
    page.sessions = page.sessions.map(row => ({ source: row.source, sessionId: row.sessionId, sessionTitle: row.sessionTitle, projectLabel: row.projectLabel, model: row.model,
      lastActivityAt: row.lastActivityAt, tokens: row.tokens, costUsd: row.costUsd, costKind: row.costKind, sharePercent: row.sharePercent,
      billing: row.billing, context: null, modelNames: row.modelNames, relation: row.relation, detailLevel: 'summary' }));
    if (page.range) page.range = { ...page.range, sources: query.sources ?? [] };
    this.labels(page);
    return page;
  }

  private async hydrate(state: RangeState, identities?: Set<string>): Promise<SessionActivity[]> {
    const selected = state.snapshot.sessions.filter(row => !identities || identities.has(sessionKey(row)));
    const missing = new Set(selected.filter(row => !state.modelRows.has(sessionKey(row))).map(sessionKey));
    if (missing.size) {
      const prepared = { ...state.prepared, events: state.prepared.events.filter(event => missing.has(sessionKey(event))) };
      const full = aggregateSessionActivity([], state.history.messages.filter(message => missing.has(sessionKey(message))), { ...state.options, prepared, totalTokens: state.snapshot.totalTokens });
      for (const row of full.sessions) state.modelRows.set(sessionKey(row), row);
    }
    const result = await this.titled(state, selected.map(row => state.modelRows.get(sessionKey(row))!));
    for (const row of result) {
      const metric = this.timing(state, row); row.taskSeconds = metric.taskSeconds; row.taskTimingKind = metric.taskTimingKind; row.detailLevel = 'full';
    }
    const keys = new Set(result.map(sessionKey));
    const inWindow = (stamp: string) => { const date = localDateAndHour(stamp).date; return date >= state.options.fromDate! && date <= state.options.toDate! && inTimeBounds(stamp, state.options); };
    enrichSessionInsights(result, state.history.messages.filter(message => keys.has(sessionKey(message)) && inWindow(message.timestamp)),
      state.history.evidence.filter(event => event.kind === 'metadata' || inWindow(event.timestamp)));
    const allRows = new Map(state.snapshot.sessions.map(row => [sessionKey(row), row]));
    for (const row of result) if (row.insights) {
      row.insights.orphan = Boolean(row.insights.parentId && !allRows.has(sessionKey({ source: row.source, sessionId: row.insights.parentId })));
      if (allRows.get(sessionKey(row))?.relation?.relationConflict) row.insights.relationConflict = true;
      if (this.deps.demo) row.insights.resumeCommand = null;
    }
    return result;
  }

  async full(query: SessionRangeQuery): Promise<SessionActivitySnapshot> {
    const state = await this.range(query);
    const snapshot = { ...state.snapshot, sessions: await this.hydrate(state), billing: state.snapshot.billing.map(row => ({ ...row })) };
    this.labels(snapshot);
    return snapshot;
  }

  async detail(query: SessionRangeQuery, target: Pick<SessionActivity, 'source' | 'sessionId'>): Promise<SessionDetailResponse> {
    const state = await this.range(query), id = sessionKey(target);
    const row = state.snapshot.sessions.find(row => sessionKey(row) === id);
    if (!row) return { session: null, range: state.snapshot.range };
    const { children } = sessionTree(state.snapshot.sessions), members = new Set([id]), pending = [row];
    for (let index = 0; index < pending.length; index++) for (const child of children.get(sessionKey(pending[index]!)) ?? []) if (!members.has(sessionKey(child))) { members.add(sessionKey(child)); pending.push(child); }
    const sessions = await this.hydrate(state, members);
    const snapshot = { ...state.snapshot, sessions, billing: [] };
    this.labels(snapshot);
    return { session: sessions.find(row => sessionKey(row) === id) ?? null, range: state.snapshot.range };
  }

  async export(query: SessionRangeQuery, filters: SessionListQuery): Promise<SessionActivity[]> {
    const full = await this.full(query);
    return selectSessionList(full, filters).selected;
  }
}
