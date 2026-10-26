import type { QuotaReport, QuotaReportProvider, QuotaReportWindow } from './report.js';
import { isSubscriptionChannelId, type SubscriptionChannelId } from './shared/subscription-channels.js';

export interface QuotaRecommendationQuery { provider: SubscriptionChannelId; model?: string; feature?: string }
export function validQuotaTarget(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value); }
export interface QuotaCandidate {
  id: string; result: 'eligible' | 'blocked' | 'excluded' | 'unknown'; reason: string;
  remainingPercent: number | null; fetchedAt: number | null;
  affectedPools: { id: string; remainingPercent: number; resetsAt: number | null }[];
}
/** Exact upstream model/group or feature IDs only. No guesses from a model/vendor name. */
function affected(p: QuotaReportProvider, q: QuotaRecommendationQuery): QuotaReportWindow[] | null {
  const base = p.windows.filter(w => /^(account:\d+|five-hour|weekly|seven-day)$/.test(w.id));
  if (!['codex', 'claude'].includes(q.provider) || !base.length) return null;
  // Partial Claude observations remain displayable, but cannot establish both shared limits.
  if (q.provider === 'claude' && (!base.some(w => w.id === 'five-hour') || !base.some(w => w.id === 'weekly' || w.id === 'seven-day'))) return null;
  if (!q.model && !q.feature) return base;
  const target = q.model ?? q.feature!;
  const specific = p.windows.filter(w => q.provider === 'claude' && q.model
    ? w.id === `model:${target.toLowerCase()}:weekly`
    : q.provider === 'codex' && q.feature ? /^feature:(.+):\d+$/.exec(w.id)?.[1] === target : false);
  return specific.length ? [...base, ...specific] : null;
}
export function recommendQuota(report: QuotaReport, query: QuotaRecommendationQuery) {
  if (!isSubscriptionChannelId(query.provider) || query.model !== undefined && !validQuotaTarget(query.model)
    || query.feature !== undefined && !validQuotaTarget(query.feature) || query.model && query.feature) throw new Error('INVALID_QUOTA_TARGET');
  const candidates: QuotaCandidate[] = report.providers.filter(p => p.provider === query.provider).map(p => {
    const c: QuotaCandidate = { id: p.id, result: 'excluded', reason: 'READ_FAILED', remainingPercent: null, fetchedAt: p.fetchedAt, affectedPools: [] };
    if (report.availability !== 'ready' || report.stale || p.stale) c.reason = 'STALE';
    else if (p.status !== 'ready' || p.diagnostic?.code) c.reason = 'READ_FAILED';
    else if (!p.identityVerified) c.reason = 'IDENTITY_UNKNOWN';
    else if (!p.canonicalId) c.reason = 'ACCOUNT_GROUP_UNKNOWN';
    else if (p.source !== 'native') c.reason = 'OBSERVATION_ONLY';
    else if (p.canonicalId !== p.id) c.reason = 'DUPLICATE_ACCOUNT';
    else {
      const windows = affected(p, query);
      if (!windows || windows.some(w => w.kind !== 'percentage' || w.usedPercent === null || w.stale)) { c.result = 'unknown'; c.reason = 'TARGET_SCOPE_UNKNOWN'; }
      else {
        c.affectedPools = windows.map(w => ({ id: w.id, remainingPercent: 100 - w.usedPercent!, resetsAt: w.resetsAt }));
        c.remainingPercent = Math.min(...c.affectedPools.map(w => w.remainingPercent));
        c.result = c.remainingPercent > 0 ? 'eligible' : 'blocked';
        c.reason = c.result === 'eligible' ? 'AVAILABLE_IN_KNOWN_POOLS' : 'POOL_EXHAUSTED';
      }
    }
    return c;
  });
  candidates.sort((a, b) => (b.result === 'eligible' ? 1 : 0) - (a.result === 'eligible' ? 1 : 0)
    || (b.remainingPercent ?? -1) - (a.remainingPercent ?? -1) || (b.fetchedAt ?? 0) - (a.fetchedAt ?? 0) || a.id.localeCompare(b.id));
  const best = candidates.find(c => c.result === 'eligible');
  return { schemaVersion: 1 as const, result: best ? 'recommended' : candidates.some(c => c.result === 'blocked') ? 'blocked' : 'unknown',
    runtime: report.runtime, readAt: report.readAt, generatedAt: report.generatedAt, target: query,
    recommendedId: best?.id ?? null, candidates };
}
