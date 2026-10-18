import { createHash } from 'node:crypto';
import { computeRowCost, isModelPriced, explainRowCost } from './pricing/index.js';
import { claudeRequestPricingFact, normalizeClaudeUsage } from './parsers/claude.js';
import { serviceTierFromEvent, TOKEN_FIELDS, type RequestPricingFact, type TokenParts } from './pricing/request-pricing.js';
import { localDateAndHour } from './timezone.js';
import type { SessionMessage, SessionMetricOptions } from './session-metrics.js';
import { accountReference } from './account-reference.js';
import { toUtcHalfHourStart } from './queue/keys.js';
import { inTimeBounds } from './usage-window.js';

export interface SessionBilling {
  service: string;
  mode: 'subscription' | 'api' | 'unknown';
  accountRef: string | null;
  accountLabel?: string;
  evidence: 'recorded' | 'unknown';
}
export interface SessionContextObservation {
  usedTokens: number | null;
  limitTokens: number | null;
  kind: 'recorded' | 'request-input' | 'post-compaction';
  observedAt: string;
}
export interface SessionObservation {
  tokenParts?: TokenParts;
  pricingFact?: RequestPricingFact;
  requestKnown?: boolean;
  costBasis?: 'request-facts';
  id: string;
  source: string;
  sessionId: string;
  timestamp: string;
  model: string;
  tokens: number;
  usageKnown: boolean;
  costUsd: number | null;
  costKind: 'recorded' | 'estimated' | 'unknown';
  costScope?: 'session-total';
  costIncomplete?: boolean;
  billing: SessionBilling;
  context?: SessionContextObservation;
  projectLabel?: string;
  profileId?: string;
  parentId?: string;
  /** Hash of a source record, allowing exact fork replays to be discarded. */
  replayKey?: string;
}
export interface ObservationContext {
  observationTier?: RequestPricingFact['serviceTier'];
  sessionId: string;
  parentId?: string;
  projectLabel?: string;
  profileId?: string;
  observationModel?: string;
  observationProvider?: string;
  observationAccount?: string;
  observationAuth?: string;
  observationTotal?: Record<string, number>;
  observationCost?: number;
  observationLimit?: number;
}
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const text = (v: unknown): string => typeof v === 'string' ? v.trim().slice(0, 120) : '';
const count = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
const positive = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const emptyBilling = (): SessionBilling => ({ service: 'unknown', mode: 'unknown', accountRef: null, evidence: 'unknown' });

function timestamp(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v < 1e12 ? v * 1000 : v : Date.parse(String(v));
  return Number.isFinite(n) && Math.abs(n) < 8.64e15 ? new Date(n).toISOString() : null;
}

/** Provider/auth fields are evidence; model names and zero costs are not. */
function billing(provider: string, auth: string, account: string): SessionBilling {
  auth = auth.toLowerCase();
  const aliases: Record<string, string> = { 'openai-codex': 'openai', 'anthropic-oauth': 'anthropic', 'xai-oauth': 'xai', 'opencode-go': 'opencode' };
  const service = /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(provider) ? aliases[provider] ?? provider : 'unknown';
  const mode = ['chatgpt', 'oauth', 'oauth_token', 'claude.ai', 'subscription'].includes(auth) ? 'subscription'
    : ['api', 'api_key', 'apikey'].includes(auth) ? 'api'
      : Object.hasOwn(aliases, provider) ? 'subscription' : 'unknown';
  return { service, mode, accountRef: account || null, evidence: service === 'unknown' && mode === 'unknown' ? 'unknown' : 'recorded' };
}

/** Whitelisted numerical metadata only. No message content or secrets survive. */
export function extractSessionObservation(source: string, record: Obj, context: ObservationContext): SessionObservation | null {
  const payload = obj(record.payload), body = obj(record.message);
  if (source === 'codex') context.observationTier = serviceTierFromEvent(record, context.observationTier);
  if (source === 'codex' && record.type === 'session_meta') {
    const nextId = text(payload.id);
    if (nextId && nextId !== context.sessionId) {
      context.observationProvider = undefined; context.observationAccount = undefined; context.observationAuth = undefined;
    }
    context.sessionId = text(payload.id) || context.sessionId;
    context.parentId = text(payload.forked_from_id) || context.parentId;
    context.observationProvider = text(payload.model_provider) || context.observationProvider;
    if (text(payload.creator_account_id)) context.observationAccount = accountReference('openai', text(payload.creator_account_id));
    return null;
  }
  if (source === 'codex' && record.type === 'turn_context') {
    context.observationModel = text(payload.model) || context.observationModel;
    context.observationAuth = text(payload.auth_mode) || context.observationAuth;
    return null;
  }
  if ((source === 'pi' || source === 'omp') && record.type === 'session') {
    context.sessionId = text(record.id) || context.sessionId;
    return null;
  }
  if (!['codex', 'claude', 'pi', 'omp', 'opencode'].includes(source)) return null;
  let usage: Obj = {}, id = '', model = context.observationModel ?? 'unknown';
  let clock = timestamp(record.timestamp ?? body.timestamp ?? obj(record.time).completed ?? obj(record.time).created);
  let provider = context.observationProvider ?? '', account = context.observationAccount ?? '', auth = context.observationAuth ?? '';
  let contextual: SessionContextObservation | undefined;
  let tokenParts = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0 };
  let usageKnown = false, costUsd: number | null = null, reportedTotal = 0;
  let pricingFact: RequestPricingFact | undefined, requestKnown = false;
  let costScope: 'session-total' | undefined, costIncomplete = false;
  if (source === 'codex') {
    const event = payload.type === 'token_count' ? payload : obj(payload.msg);
    if (event.type !== 'token_count') return null;
    const info = obj(event.info), total = obj(info.total_token_usage), last = obj(info.last_token_usage);
    // A plan recorded alongside this call is positive evidence. Missing windows
    // are not evidence of API billing, and current login state cannot label history.
    if (!auth && ['openai', 'openai-codex'].includes(provider)) {
      const rate = obj(event.rate_limits ?? info.rate_limits);
      const plan = text(rate.plan_type).toLowerCase();
      if (['free', 'go', 'plus', 'pro', 'prolite', 'team', 'business', 'enterprise', 'edu', 'education'].includes(plan)) auth = 'subscription';
      else if (['api', 'api_key', 'apikey'].includes(plan)) auth = 'api';
    }
    if (!Object.keys(total).length && !Object.keys(last).length) return null;
    model = text(info.model) || model;
    const keys = ['input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_creation_input_tokens', 'reasoning_output_tokens', 'total_tokens'];
    const normalized: Record<string, number> = {};
    const current: Record<string, number> = {};
    const alias = (value: Obj, key: string) => value[key] ?? (key === 'cache_creation_input_tokens' ? value.cache_write_input_tokens : key === 'cached_input_tokens' ? value.cache_read_input_tokens : undefined);
    for (const key of keys) current[key] = count(alias(total, key));
    if (total.cache_creation_input_tokens == null && total.cache_write_input_tokens != null) current.input_tokens = Math.max(0, current.input_tokens! - count(total.cache_write_input_tokens));
    const previous = context.observationTotal;
    const repeated = Object.keys(total).length > 0 && previous && JSON.stringify(previous) === JSON.stringify(current);
    if (Object.keys(total).length) {
      const reset = previous && current.total_tokens! < (previous.total_tokens ?? 0);
      for (const key of keys) normalized[key] = previous && !reset ? Math.max(0, current[key]! - (previous[key] ?? 0)) : 0;
      context.observationTotal = current;
    }
    if (Object.keys(last).length && !repeated) {
      for (const key of keys) normalized[key] = count(alias(last, key));
      if (last.cache_creation_input_tokens == null && last.cache_write_input_tokens != null) normalized.input_tokens = Math.max(0, normalized.input_tokens! - count(last.cache_write_input_tokens));
    }
    for (const key of keys) normalized[key] ??= 0;
    const cached = normalized.cached_input_tokens!, reasoning = normalized.reasoning_output_tokens!;
    tokenParts = { input_tokens: Math.max(0, normalized.input_tokens! - cached), output_tokens: Math.max(0, normalized.output_tokens! - reasoning), cached_input_tokens: cached, cache_creation_input_tokens: normalized.cache_creation_input_tokens!, reasoning_output_tokens: reasoning };
    reportedTotal = normalized.total_tokens!;
    usageKnown = !repeated && (Object.keys(last).length > 0 || Boolean(previous));
    requestKnown = Object.keys(last).length > 0 && !repeated;
    id = digest([record.timestamp, Object.keys(total).length ? total : last]);
    const capacity = positive(info.model_context_window);
    if (capacity) context.observationLimit = capacity;
    if (typeof last.input_tokens === 'number') contextual = { usedTokens: count(last.input_tokens) + count(last.output_tokens), limitTokens: capacity ?? context.observationLimit ?? null, kind: 'recorded', observedAt: clock ?? '' };
  } else if (source === 'claude') {
    context.sessionId = text(record.sessionId) || context.sessionId;
    if (record.isSidechain === true) return null;
    if (record.type === 'system' && record.subtype === 'compact_boundary') {
      const post = positive(obj(record.compactMetadata).postTokens);
      id = `compact:${text(record.uuid) || clock}`;
      contextual = { usedTokens: post, limitTokens: context.observationLimit ?? null, kind: 'post-compaction', observedAt: clock ?? '' };
    } else if (record.type === 'cost-state' && typeof record.totalCostUSD === 'number' && Number.isFinite(record.totalCostUSD) && record.totalCostUSD >= 0) {
      // Session totals are evidence, but cannot be allocated to individual requests.
      costUsd = Math.max(0, record.totalCostUSD - (context.observationCost ?? 0));
      context.observationCost = record.totalCostUSD;
      costScope = 'session-total'; costIncomplete = record.hasUnknownModelCost === true;
      id = `cost:${clock}`;
    } else {
      if (record.type !== 'assistant' || !Object.keys(obj(body.usage)).length) return null;
      usage = obj(body.usage); usageKnown = true;
      model = text(body.model) || model;
      id = `call:${text(body.id) || text(record.uuid)}:${text(record.requestId)}`;
      const normalized = normalizeClaudeUsage(usage);
      tokenParts = { input_tokens: normalized.input_tokens, output_tokens: normalized.output_tokens, cached_input_tokens: normalized.cached_input_tokens, cache_creation_input_tokens: normalized.cache_creation_input_tokens, reasoning_output_tokens: 0 };
      requestKnown = true;
      pricingFact = claudeRequestPricingFact(id, clock ?? '', usage);
      const capacity = positive(record.context_window ?? usage.context_window);
      if (capacity) context.observationLimit = capacity;
      contextual = { usedTokens: tokenParts.input_tokens + tokenParts.cached_input_tokens + tokenParts.cache_creation_input_tokens, limitTokens: capacity ?? context.observationLimit ?? null, kind: 'request-input', observedAt: clock ?? '' };
      provider = text(record.provider ?? body.provider); auth = text(record.authType ?? body.authType);
    }
  } else {
    const data = source === 'opencode' ? Object.keys(body).length ? body : record : body;
    if (!['assistant', 'compaction'].includes(text(data.role ?? data.type))) return null;
    usage = obj(source === 'opencode' ? data.tokens : data.usage);
    if (!Object.keys(usage).length) return null;
    usageKnown = true;
    requestKnown = true;
    context.sessionId = text(data.sessionID ?? data.sessionId ?? record.sessionID ?? record.sessionId) || context.sessionId;
    model = text(obj(data.model).id ?? data.modelID ?? data.model) || model;
    provider = text(data.providerID ?? data.provider ?? obj(data.model).providerID);
    auth = text(data.authType ?? data.credential_type);
    account = text(data.accountId) ? accountReference(billing(provider, auth, '').service, text(data.accountId)) : '';
    clock ??= timestamp(obj(data.time).completed ?? obj(data.time).created);
    id = `call:${text(record.id ?? data.id)}`;
    const cached = obj(usage.cache);
    tokenParts = { input_tokens: count(usage.input), output_tokens: count(usage.output), cached_input_tokens: count(usage.cacheRead ?? cached.read), cache_creation_input_tokens: count(usage.cacheWrite ?? cached.write), reasoning_output_tokens: count(usage.reasoningTokens ?? usage.reasoning) };
    reportedTotal = count(usage.totalTokens);
    const cost = source === 'opencode' ? data.cost : obj(usage.cost).total;
    if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) costUsd = cost;
    const capacity = positive(data.contextWindow ?? usage.contextWindow);
    contextual = { usedTokens: tokenParts.input_tokens + tokenParts.cached_input_tokens + tokenParts.cache_creation_input_tokens, limitTokens: capacity, kind: 'request-input', observedAt: clock ?? '' };
  }
  if (!clock || !context.sessionId || !id || id === 'call:') return null;
  const tokens = Math.max(reportedTotal, Object.values(tokenParts).reduce((a, b) => a + b, 0));
  if (usageKnown && !pricingFact) pricingFact = { ...tokenParts, id, timestamp: clock,
    ...(requestKnown ? { requestInputTokens: tokenParts.input_tokens + tokenParts.cached_input_tokens + tokenParts.cache_creation_input_tokens } : {}),
    ...(source === 'codex' ? { serviceTier: context.observationTier } : {}) };
  let costKind: SessionObservation['costKind'] = costUsd === null ? 'unknown' : 'recorded';
  if (costUsd === null && usageKnown && isModelPriced(model, source)) {
    costUsd = computeRowCost({ ...tokenParts, pricing_requests: pricingFact ? [pricingFact] : undefined, hour_start: clock, source, model, project: '', total_tokens: tokens, conversation_count: 0 });
    costKind = 'estimated';
  }
  context.observationModel = model;
  return { id, source, sessionId: context.sessionId, timestamp: clock, model, tokens, usageKnown, costUsd, costKind,
    ...(usageKnown ? { tokenParts, pricingFact, requestKnown } : {}),
    ...(costKind !== 'recorded' && pricingFact ? { costBasis: 'request-facts' as const } : {}),
    ...(costScope ? { costScope, costIncomplete } : {}),
    billing: billing(provider, auth, account), ...(contextual ? { context: { ...contextual, observedAt: clock } } : {}),
    ...(context.projectLabel ? { projectLabel: context.projectLabel } : {}), ...(context.profileId ? { profileId: context.profileId } : {}),
    ...(context.parentId ? { parentId: context.parentId } : {}), ...(source === 'codex' ? { replayKey: (() => {
      const info = obj(obj(payload.type === 'token_count' ? payload : payload.msg).info);
      return digest([info.total_token_usage, info.last_token_usage]);
    })() } : {}) };
}

export interface SessionActivity {
  models?: SessionModelUsage[];
  detailsComplete?: boolean;
  unallocatedCostUsd?: number | null;
  taskSeconds?: number | null;
  taskTimingKind?: string;
  sessionTitle?: string;
  source: string; sessionId: string; projectLabel: string; model: string; lastActivityAt: string;
  tokens: number | null; sharePercent: number | null; costUsd: number | null;
  costKind: 'recorded' | 'estimated' | 'mixed' | 'unknown'; billing: SessionBilling;
  context: SessionContextObservation | null; profileId?: string;
}
export interface SessionActivitySnapshot {
  sessions: SessionActivity[]; totalTokens: number; attributedTokens: number; otherTokens: number;
  tokenTotalMismatch: boolean; missingSources: string[]; observedAt: string;
  billing: { service: string; mode: SessionBilling['mode']; accountRef: string | null; accountLabel?: string; tokens: number; costUsd: number | null; costKind: SessionActivity['costKind'];
    /** Exact contributing sessions; absent only in responses from older runtimes. */
    sessionRefs?: Pick<SessionActivity, 'source' | 'sessionId'>[] }[];
}
export interface SessionModelUsage {
  model: string; tokens: number; requests: number | null;
  input_tokens: number | null; output_tokens: number | null; cached_input_tokens: number | null;
  cache_creation_input_tokens: number | null; reasoning_output_tokens: number | null;
  costUsd: number | null; knownCostUsd: number; costKind: SessionActivity['costKind'];
  serviceTiers: string[];
}

export function mergeSessionObservation(previous: SessionObservation | undefined, next: SessionObservation): SessionObservation {
  if (!previous) return next;
  if (next.source === 'codex' && next.tokens < previous.tokens) return { ...next, tokens: previous.tokens, costUsd: previous.costUsd, costKind: previous.costKind,
    usageKnown: previous.usageKnown, tokenParts: previous.tokenParts, pricingFact: previous.pricingFact, requestKnown: previous.requestKnown, costBasis: previous.costBasis, costIncomplete: previous.costIncomplete };
  return next.timestamp >= previous.timestamp ? next : previous;
}

export function aggregateSessionActivity(events: readonly SessionObservation[], messages: readonly SessionMessage[], options: SessionMetricOptions & { totalTokens: number; now?: number }): SessionActivitySnapshot {
  const inRange = (source: string, stamp: string, usageBucket = false) => {
    if (options.sources?.length && !options.sources.includes(source)) return false;
    if (!Number.isFinite(Date.parse(stamp))) return false;
    if (!inTimeBounds(usageBucket ? toUtcHalfHourStart(stamp)! : stamp, options)) return false;
    const date = localDateAndHour(stamp, options.timeZone).date;
    return (!options.fromDate || date >= options.fromDate) && (!options.toDate || date <= options.toDate);
  };
  const selected = new Map<string, SessionObservation>();
  for (const e of events) {
    const key = JSON.stringify([e.source, e.sessionId, e.id]);
    selected.set(key, mergeSessionObservation(selected.get(key), repriceObservation(e)));
  }
  const ordered = [...selected.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const bySession = new Map<string, SessionObservation[]>();
  for (const event of ordered.filter(e => e.source === 'codex')) {
    const rows = bySession.get(event.sessionId) ?? [];
    rows.push(event); bySession.set(event.sessionId, rows);
  }
  // Match only the inherited prefix. A later identical new call remains real usage.
  const inherited = new Set<SessionObservation>();
  const missingParents = new Set<string>();
  for (const rows of bySession.values()) {
    const parentId = rows[0]?.parentId;
    if (!parentId) continue;
    const parent = bySession.get(parentId);
    if (!parent) { missingParents.add('codex'); continue; }
    let copied = 0;
    for (let start = 0; start < parent.length; start++) {
      let length = 0;
      while (length < rows.length && start + length < parent.length && rows[length]!.replayKey && rows[length]!.replayKey === parent[start + length]!.replayKey) length++;
      copied = Math.max(copied, length);
    }
    for (const event of rows.slice(0, copied)) inherited.add(event);
  }
  const groups = new Map<string, { row: SessionActivity; events: SessionObservation[] }>();
  const ensure = (source: string, sessionId: string, stamp: string, projectLabel?: string) => {
    const key = JSON.stringify([source, sessionId]);
    let group = groups.get(key);
    if (!group) {
      group = { row: { source, sessionId, projectLabel: projectLabel || '未识别项目', model: 'unknown', lastActivityAt: stamp, tokens: null, sharePercent: null, costUsd: null, costKind: 'unknown', billing: emptyBilling(), context: null }, events: [] };
      groups.set(key, group);
    }
    if (stamp > group.row.lastActivityAt) group.row.lastActivityAt = stamp;
    if (projectLabel) group.row.projectLabel = projectLabel;
    return group;
  };
  for (const m of messages) if (inRange(m.source, m.timestamp)) ensure(m.source, m.sessionId, m.timestamp, m.projectLabel);
  for (const e of ordered) {
    if (!inRange(e.source, e.timestamp, e.usageKnown) || inherited.has(e)) continue;
    const g = ensure(e.source, e.sessionId, e.timestamp, e.projectLabel), row = g.row;
    g.events.push(e);
    if (e.usageKnown) row.tokens = (row.tokens ?? 0) + e.tokens;
    if (e.model !== 'unknown') row.model = e.model;
    if (e.context && (!row.context || e.context.observedAt >= row.context.observedAt)) row.context = e.context;
    if (e.profileId) row.profileId = e.profileId;
  }
  const attributedTokens = [...groups.values()].reduce((sum, g) => sum + (g.row.tokens ?? 0), 0);
  const totalTokens = Math.max(attributedTokens, Math.max(0, options.totalTokens));
  const services = new Map<string, SessionActivitySnapshot['billing'][number]>();
  const serviceCosts = new Map<string, Set<string>>();
  const serviceSessions = new Map<string, Set<string>>();
  const addBilling = (proof: SessionBilling, tokens: number, costUsd: number | null, costKind: string, session?: SessionActivity) => {
    const key = JSON.stringify([proof.service, proof.mode, proof.accountRef]);
    const service = services.get(key) ?? { service: proof.service, mode: proof.mode, accountRef: proof.accountRef, tokens: 0, costUsd: null, costKind: 'unknown' as const, sessionRefs: [] };
    if (session) {
      const refs = serviceSessions.get(key) ?? new Set<string>();
      const ref = JSON.stringify([session.source, session.sessionId]);
      if (!refs.has(ref)) service.sessionRefs!.push({ source: session.source, sessionId: session.sessionId });
      refs.add(ref); serviceSessions.set(key, refs);
    }
    service.tokens += tokens;
    if (costUsd !== null) service.costUsd = (service.costUsd ?? 0) + costUsd;
    const kinds = serviceCosts.get(key) ?? new Set<string>();
    if (tokens > 0 || costUsd !== null) kinds.add(costKind);
    service.costKind = kinds.size === 1 ? [...kinds][0] as SessionActivity['costKind'] : kinds.size > 1 ? 'mixed' : 'unknown';
    serviceCosts.set(key, kinds); services.set(key, service);
  };
  const sessions = [...groups.values()].map(g => {
    const row = g.row;
    const totals = g.events.filter(event => event.costScope === 'session-total');
    const calls = g.events.filter(event => event.usageKnown);
    const services = new Set(calls.map(event => event.billing.service).filter(service => service !== 'unknown'));
    const modes = new Set(calls.map(event => event.billing.mode));
    const accounts = new Set(calls.map(event => event.billing.accountRef));
    row.billing = { service: services.size > 1 ? 'mixed' : [...services][0] ?? 'unknown', mode: modes.size === 1 ? [...modes][0]! : 'unknown',
      accountRef: accounts.size === 1 ? [...accounts][0]! : null, evidence: services.size ? 'recorded' : 'unknown' };
    const costs = totals.length ? totals : calls;
    const knownCosts = costs.filter(event => event.costUsd !== null);
    row.costUsd = knownCosts.length ? knownCosts.reduce((sum, event) => sum + event.costUsd!, 0) : null;
    const kinds = new Set(costs.filter(event => event.tokens > 0 || event.costUsd !== null).map(event => event.costKind));
    if (costs.some(event => event.costIncomplete)) kinds.add('unknown');
    row.costKind = kinds.size === 1 ? [...kinds][0]! : kinds.size > 1 ? 'mixed' : 'unknown';
    row.models = summarizeSessionModels(calls);
    row.detailsComplete = calls.length > 0 && calls.every(event => event.tokenParts && TOKEN_FIELDS.reduce((sum, key) => sum + event.tokenParts![key], 0) === event.tokens);
    row.unallocatedCostUsd = totals.length ? row.costUsd : null;
    row.sharePercent = row.tokens !== null && totalTokens > 0 ? row.tokens / totalTokens * 100 : null;
    for (const event of calls) addBilling(event.billing, event.tokens, totals.length ? null : event.costUsd, totals.length ? 'unknown' : event.costKind, row);
    for (const event of totals) addBilling(event.billing, 0, event.costUsd, event.costIncomplete ? 'mixed' : event.costKind, row);
    return row;
  }).sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1) || b.lastActivityAt.localeCompare(a.lastActivityAt));
  if (totalTokens > attributedTokens) addBilling(emptyBilling(), totalTokens - attributedTokens, null, 'unknown');
  return { sessions, totalTokens, attributedTokens, otherTokens: Math.max(0, totalTokens - attributedTokens), tokenTotalMismatch: attributedTokens > options.totalTokens,
    missingSources: [...new Set([...(options.missingSources ?? []), ...missingParents])], observedAt: new Date(options.now ?? Date.now()).toISOString(), billing: [...services.values()].sort((a, b) => b.tokens - a.tokens) };
}

function repriceObservation(event: SessionObservation): SessionObservation {
  if (!event.usageKnown || !event.tokenParts || event.costKind === 'recorded' || event.costBasis !== 'request-facts') return event;
  const cost = explainRowCost({ ...event.tokenParts, pricing_requests: event.pricingFact ? [event.pricingFact] : undefined,
    hour_start: event.timestamp, source: event.source, model: event.model, project: '', total_tokens: event.tokens, conversation_count: 0 });
  return { ...event, costUsd: cost.costUsd, costKind: cost.costUsd === null ? 'unknown' : 'estimated', costIncomplete: cost.unpricedTokens > 0 };
}
function summarizeSessionModels(events: SessionObservation[]): SessionModelUsage[] {
  const groups = new Map<string, SessionObservation[]>();
  for (const event of events) { const rows = groups.get(event.model) ?? []; rows.push(event); groups.set(event.model, rows); }
  return [...groups].map(([model, rows]) => {
    const complete = rows.every(row => !!row.tokenParts);
    const kinds = new Set(rows.map(row => row.costKind));
    const knownCostUsd = rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
    const parts = Object.fromEntries(TOKEN_FIELDS.map(key => [key, complete ? rows.reduce((sum, row) => sum + row.tokenParts![key], 0) : null])) as Record<typeof TOKEN_FIELDS[number], number | null>;
    return { ...parts, model, tokens: rows.reduce((sum, row) => sum + row.tokens, 0), requests: rows.every(row => row.requestKnown === true) ? rows.length : null,
      costUsd: rows.some(row => row.costUsd === null || row.costIncomplete) ? null : knownCostUsd, knownCostUsd,
      costKind: kinds.size === 1 ? [...kinds][0]! : 'mixed' as const, serviceTiers: [...new Set(rows.map(row => row.pricingFact?.serviceTier ?? 'unknown'))] };
  }).sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model));
}
