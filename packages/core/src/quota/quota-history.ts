import { prepareSessionObservations, type SessionObservation } from '../session-observation.js';
import type { QuotaSample } from './shared/quota.js';

/** Internal safe snapshot of the selected slot; private partition keys never leave the manager. */
export interface QuotaHistorySource {
  providerId: string; label: string; revision: number;
  windows: Array<{ id: string; label: string; groupLabel?: string; samples: QuotaSample[] }>;
}
export interface QuotaHistoryUsage {
  tokens: number; knownCostUsd: number; costComplete: boolean; sessionCount: number;
  /** Observed local activity per observed percentage point, never a subscription exchange rate. */
  tokensPerPercent: number | null;
}
export interface QuotaHistoryCycle {
  id: string; startedAt: number | null; resetsAt: number | null;
  firstObservedAt: number; lastObservedAt: number; lastUsedPercent: number;
  observedUsedPercent: number | null; discontinuous: boolean; sampleCount: number;
  samples: Array<Pick<QuotaSample, 'at' | 'usedPercent'>>;
  usage: QuotaHistoryUsage | null;
}
export interface QuotaHistoryReport {
  providerId: string; label: string;
  windows: Array<{ id: string; label: string; groupLabel?: string; cycles: QuotaHistoryCycle[] }>;
  observedAt: number;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const joinKey = (service: string, accountRef: string) => JSON.stringify([service, accountRef]);

export function buildQuotaHistoryReport(source: QuotaHistorySource, observations: readonly SessionObservation[], now = Date.now() / 1000): QuotaHistoryReport {
  const accounts = new Map<string, Array<{ at: number; event: SessionObservation }>>();
  for (const event of prepareSessionObservations(observations).events) {
    if (!event.usageKnown || event.billing.mode !== 'subscription' || event.billing.evidence !== 'recorded' || !event.billing.accountRef) continue;
    const at = Date.parse(event.timestamp) / 1000;
    if (!Number.isFinite(at)) continue;
    const key = joinKey(event.billing.service, event.billing.accountRef), rows = accounts.get(key) ?? [];
    rows.push({ at, event }); accounts.set(key, rows);
  }
  for (const rows of accounts.values()) rows.sort((a, b) => a.at - b.at);
  return { providerId: source.providerId, label: source.label, observedAt: now, windows: source.windows.map(window => {
    const samples = [...new Map(window.samples.filter(row => finite(row.at) && row.at <= now + 60 && row.at >= now - 90 * 86400 && finite(row.usedPercent) && row.usedPercent >= 0 && row.usedPercent <= 100)
      .map(row => [row.at, row])).values()].sort((a, b) => a.at - b.at);
    const segments: Array<{ rows: QuotaSample[]; discontinuous: boolean }> = [];
    for (const row of samples) {
      const previous = segments.at(-1), last = previous?.rows.at(-1);
      const reset = finite(row.resetsAt) && row.resetsAt > row.at ? row.resetsAt : null;
      const oldReset = last && finite(last.resetsAt) && last.resetsAt > last.at ? last.resetsAt : null;
      const sameReset = reset === null && oldReset === null || reset !== null && oldReset !== null && Math.abs(reset - oldReset) <= 60;
      const rollback = Boolean(last && row.usedPercent < last.usedPercent);
      const identityChange = Boolean(last && (last.accountRef !== row.accountRef || last.service !== row.service));
      if (!previous || !sameReset || rollback) segments.push({ rows: [{ ...row, resetsAt: reset }], discontinuous: Boolean(sameReset && rollback) });
      else { previous.rows.push({ ...row, resetsAt: reset }); previous.discontinuous ||= identityChange; }
    }
    const cycles = segments.slice(-512).map(({ rows, discontinuous }): QuotaHistoryCycle => {
      const first = rows[0]!, last = rows.at(-1)!;
      const duration = first.durationSeconds;
      const trustworthyDuration = finite(duration) && duration > 0 && duration <= 366 * 86400 && rows.every(row => row.durationSeconds === duration);
      const startedAt = trustworthyDuration && last.resetsAt !== null && last.resetsAt - duration <= first.at ? last.resetsAt - duration : null;
      const observedUsedPercent = rows.length > 1 && last.resetsAt !== null && !discontinuous ? last.usedPercent - first.usedPercent : null;
      const trustedAccount = Boolean(first.accountRef && first.service && rows.every(row => row.accountRef === first.accountRef && row.service === first.service));
      let usage: QuotaHistoryUsage | null = null;
      if (trustedAccount && rows.length > 1 && last.at > first.at) {
        const events = (accounts.get(joinKey(first.service!, first.accountRef!)) ?? []).filter(row => row.at >= first.at && row.at < last.at).map(row => row.event);
        if (events.length) {
          const tokens = events.reduce((sum, event) => sum + event.tokens, 0);
          usage = { tokens, knownCostUsd: events.reduce((sum, event) => sum + (event.costScope !== 'session-total' ? event.costUsd ?? 0 : 0), 0),
            costComplete: events.every(event => event.costUsd !== null && !event.costIncomplete && event.costScope !== 'session-total'),
            sessionCount: new Set(events.map(event => JSON.stringify([event.source, event.sessionId]))).size,
            tokensPerPercent: source.providerId === 'codex' && /^account:\d+$/.test(window.id) && observedUsedPercent !== null && observedUsedPercent > 0 ? tokens / observedUsedPercent : null };
        }
      }
      // Preserve endpoints and sampling counts, but keep detail transport bounded.
      const step = Math.max(1, Math.ceil((rows.length - 1) / 239));
      const chart = rows.filter((_, index) => index % step === 0 || index === rows.length - 1).map(row => ({ at: row.at, usedPercent: row.usedPercent }));
      return { id: `${window.id}:${first.at}`, startedAt, resetsAt: last.resetsAt, firstObservedAt: first.at, lastObservedAt: last.at,
        lastUsedPercent: last.usedPercent, observedUsedPercent, discontinuous, sampleCount: rows.length, samples: chart, usage };
    }).reverse();
    return { id: window.id, label: window.label, groupLabel: window.groupLabel, cycles };
  }).filter(window => window.cycles.length > 0) };
}
