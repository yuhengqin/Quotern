import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { queryDbJson, readSqliteWithSnapshot } from '../../parsers/sqlite.js';
import type { QuotaWindow } from '../shared/quota.js';
import { markQuotaIdentity, copyQuotaIdentity, markQuotaEvidence, privateQuotaEvidence, type QuotaAccountEvidence } from './quota-identity.js';
export { markQuotaEvidence, quotaEvidence } from './quota-identity.js';

type Obj = Record<string, unknown>;
type Account = QuotaAccountEvidence;
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

function accountsMatch(a: Account, b: Account): boolean {
  if (a.accountId && b.accountId) return a.accountId === b.accountId;
  if (a.organizationId && b.organizationId && a.organizationId !== b.organizationId) return false;
  // An email alone cannot distinguish multiple organizations on Claude.
  return Boolean(a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()
    && a.organizationId && b.organizationId && a.organizationId === b.organizationId);
}

export function selectQuotaObservation<T extends object>(native: T, candidates: readonly object[], now = Date.now() / 1000): T | object {
  const current = privateQuotaEvidence(native);
  if (!current?.public.identityVerified) return native;
  const raw = native as Obj;
  const currentAt = typeof raw.fetchedAt === 'number' && Number.isFinite(raw.fetchedAt) ? raw.fetchedAt : 0;
  const selected = candidates.filter(candidate => {
    const proof = privateQuotaEvidence(candidate), row = candidate as Obj;
    const at = proof?.public.observedAt;
    return proof?.public.identityVerified && accountsMatch(current.account, proof.account)
      && row.status === 'ready' && row.stale !== true && typeof at === 'number'
      && at > currentAt && at >= now - 1800 && at <= now + 60;
  }).sort((a, b) => privateQuotaEvidence(b)!.public.observedAt! - privateQuotaEvidence(a)!.public.observedAt!)[0];
  if (!selected) return native;
  const copy = copyQuotaIdentity(native, { ...selected,
    ...('planLabel' in native && !('planLabel' in selected) ? { planLabel: (native as Obj).planLabel } : {}),
    ...(typeof (native as Obj).retryAfterSeconds === 'number' ? { retryAfterSeconds: (native as Obj).retryAfterSeconds } : {}) });
  return markQuotaEvidence(copy, privateQuotaEvidence(selected)!.public, current.account);
}

export interface OMPQuotaObservation {
  provider: 'claude' | 'codex' | 'grok' | 'opencode' | 'antigravity';
  key: string;
  snapshot: { status: string; fetchedAt: number; windows: QuotaWindow[]; stale: boolean; message: string | null };
}

/** Exact, documented limit vocabularies. Unknown values never become zero use. */
export function observationsFromOMPRows(rows: readonly Obj[], now = Date.now() / 1000): OMPQuotaObservation[] {
  const routes: Record<string, OMPQuotaObservation['provider']> = { anthropic: 'claude', 'anthropic-oauth': 'claude', 'openai-codex': 'codex', 'xai-oauth': 'grok', 'opencode-go': 'opencode', 'google-antigravity': 'antigravity' };
  const groups = new Map<string, { provider: OMPQuotaObservation['provider']; account: Account; windows: Map<string, { at: number; window: QuotaWindow }> }>();
  for (const row of rows) {
    const provider = routes[text(row.provider).toLowerCase()];
    const fraction = row.used_fraction, stamp = row.recorded_at;
    if (!provider || typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || typeof stamp !== 'number' || !Number.isFinite(stamp) || stamp <= 0 || stamp / 1000 > now + 60) continue;
    const limit = text(row.limit_id).toLowerCase(), label = text(row.window_label).toLowerCase();
    let id = '', duration = 0;
    if (provider === 'claude') { if (limit === 'anthropic:5h') { id = 'five-hour'; duration = 18000; } else if (limit === 'anthropic:7d') { id = 'weekly'; duration = 604800; } }
    if (provider === 'codex') { if (/^openai-codex:.*primary$/.test(limit) || limit === 'openai-codex:primary') { id = 'five-hour'; duration = 18000; } else if (/^openai-codex:.*secondary$/.test(limit) || limit === 'openai-codex:secondary') { id = 'weekly'; duration = 604800; } }
    if (provider === 'opencode') { if (limit === 'rolling-5h') { id = 'five-hour'; duration = 18000; } else if (limit === 'weekly') { id = 'weekly'; duration = 604800; } else if (limit === 'monthly') { id = 'monthly'; duration = 2592000; } }
    if (provider === 'grok') { if (limit === 'xai-oauth:credits:1w') { id = 'weekly'; duration = 604800; } else if (limit === 'xai-oauth:included:1mo') { id = 'monthly'; duration = 2592000; } }
    if (provider === 'antigravity' && ['gemini-weekly', '3p-weekly'].includes(limit)) { id = limit; duration = 604800; }
    if (!id) continue;
    const durations: Record<string, number> = { '5h': 18000, '5 hours': 18000, '7d': 604800, weekly: 604800, '30d': 2592000, monthly: 2592000 };
    duration = durations[label] ?? duration;
    // Codex primary/secondary are ordinals. Require a recorded duration, then
    // use the same duration-based window identity as the native usage API.
    if (provider === 'codex') {
      if (!durations[label]) continue;
      id = `account:${duration}`;
    }
    const service = { codex: 'openai', claude: 'anthropic', grok: 'xai', opencode: 'opencode', antigravity: 'google' }[provider];
    const account: Account = { service, accountId: text(row.account_id), email: text(row.email), ...(provider === 'claude' ? { organizationId: text(row.account_id) } : {}) };
    const accountKey = text(row.account_key);
    if (!accountKey && !account.accountId && !account.email) continue;
    const key = hash([provider, accountKey || account.accountId || account.email]);
    const group = groups.get(key) ?? { provider, account, windows: new Map() };
    const at = stamp / 1000;
    const prior = group.windows.get(id);
    if (!prior || prior.at < at) group.windows.set(id, { at, window: { id, label: duration === 18000 ? '5h' : duration === 604800 ? '7d' : duration === 2592000 ? '30d' : text(row.label).slice(0, 60) || id,
      usedPercent: Math.min(100, fraction * 100), resetsAt: typeof row.resets_at === 'number' && row.resets_at > 0 ? row.resets_at / 1000 : null, durationSeconds: duration } });
    groups.set(key, group);
  }
  return [...groups].map(([key, group]) => {
    // Keep each refresh coherent; an old weekly row must not borrow a fresh short-window timestamp.
    const observedAt = Math.max(...[...group.windows.values()].map(value => value.at));
    const windows = [...group.windows.values()].filter(value => observedAt - value.at <= 60).map(value => value.window);
    const stale = observedAt < now - 1800;
    const snapshot = { status: 'ready', fetchedAt: observedAt, windows, stale, message: stale ? 'OMP 本地观察已过期' : null };
    const identityVerified = Boolean(group.account.accountId);
    markQuotaIdentity(snapshot, [group.provider, group.account.accountId || key]);
    markQuotaEvidence(snapshot, { source: 'omp', observer: 'OMP 本地记录', observedAt, identityVerified }, group.account);
    return { provider: group.provider, key, snapshot };
  });
}

export function readOMPQuotaObservations(database = process.env.QUOTERN_OMP_AGENT_DB || path.join(process.env.OMP_AGENT_DIR || path.join(homedir(), '.omp', 'agent'), 'agent.db')): OMPQuotaObservation[] {
  if (!existsSync(database)) return [];
  const rows = readSqliteWithSnapshot(database, db => queryDbJson(db, `SELECT provider, account_key, email, account_id, limit_id, label, window_label, used_fraction, status, resets_at, recorded_at FROM usage_history ORDER BY recorded_at DESC LIMIT 20000`));
  return observationsFromOMPRows(rows);
}

/** A failed read is not evidence that previously observed accounts disappeared. */
export function createOMPQuotaObservationReader(read = readOMPQuotaObservations): () => OMPQuotaObservation[] {
  let previous: OMPQuotaObservation[] = [];
  return () => {
    try { previous = read(); return previous; }
    catch {
      return previous.map(item => ({ ...item, snapshot: copyQuotaIdentity(item.snapshot,
        { ...item.snapshot, stale: true, message: 'OMP 本地读取暂不可用，保留上次观察' }) }));
    }
  };
}
