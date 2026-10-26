import { quotaNodeFetch } from '../quota/readers/quota-fetch-state.js';

export type BillingFetch = (url: string, init: RequestInit) => Promise<Response>;
export interface PlatformCosts {
  schemaVersion: 1; provider: 'openai'; provenance: 'platform-reported';
  status: 'not-configured' | 'not-queried' | 'ready' | 'partial' | 'unavailable'; code: string | null;
  startTime: number; endTime: number; fetchedAt: number | null; complete: boolean; projects: string[];
  totals: { currency: string; amount: number }[];
  rows: { startTime: number; endTime: number; currency: string; amount: number; projectId: string | null; lineItem: string | null }[];
  balance: null; grantedBalance: null; expiresAt: null; balanceStatus: 'unsupported';
}
export interface CostsQuery { apiKey?: string; projects?: readonly string[]; startTime: number; endTime: number; fetch?: BillingFetch }
export function emptyPlatformCosts(startTime: number, endTime: number, projects: readonly string[] = []): PlatformCosts {
  return { schemaVersion: 1, provider: 'openai', provenance: 'platform-reported', status: 'not-queried', code: null, startTime, endTime, fetchedAt: null,
    complete: false, projects: [...projects], totals: [], rows: [], balance: null, grantedBalance: null, expiresAt: null, balanceStatus: 'unsupported' };
}
export function validCostProjects(projects: readonly string[]): boolean {
  return projects.length <= 20 && projects.every(p => /^proj_[a-zA-Z0-9_-]{1,100}$/.test(p)) && new Set(projects).size === projects.length;
}
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('INVALID_RESPONSE');
  return v as Record<string, unknown>;
};
function label(v: unknown): string | null {
  return typeof v === 'string' && /^[a-zA-Z0-9_. /,():+-]{1,120}$/.test(v)
    && !/\bsk[-_][a-zA-Z0-9_-]+|\bbearer\s+\S+|\b(?:[a-z0-9]+[_ -])*(?:api[_ -]?key|token|secret)\s*[:=]\s*\S+/i.test(v) ? v : null;
}
async function boundedJson(response: Response, budget: { bytes: number }): Promise<unknown> {
  if (!response.body) throw new Error('INVALID_RESPONSE');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length; budget.bytes += part.value.length;
      if (bytes > 2 * 1024 * 1024 || budget.bytes > 8 * 1024 * 1024) { await reader.cancel(); throw new Error('RESPONSE_LIMIT'); }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}

/** Explicitly invoked, fixed official endpoint. Never refreshes or persists authentication. */
export async function readOpenAICosts(query: CostsQuery): Promise<PlatformCosts> {
  const result = emptyPlatformCosts(query.startTime, query.endTime);
  const key = query.apiKey?.trim(), projects = query.projects ?? [];
  if (!key) { result.status = 'not-configured'; result.code = 'ADMIN_KEY_REQUIRED'; return result; }
  if (key.length > 2048 || /[\r\n]/.test(key) || !validCostProjects(projects) || !Number.isSafeInteger(query.startTime) || !Number.isSafeInteger(query.endTime)
    || query.startTime <= 0 || query.endTime <= query.startTime || query.endTime - query.startTime > 91 * 86400) {
    result.status = 'unavailable'; result.code = 'INVALID_CONFIGURATION'; return result;
  }
  result.projects = [...projects];
  const params = new URLSearchParams({ start_time: String(query.startTime), end_time: String(query.endTime), bucket_width: '1d', limit: '31' });
  for (const p of projects) params.append('project_ids[]', p);
  params.append('group_by[]', 'project_id'); params.append('group_by[]', 'line_item');
  const cursors = new Set<string>(), budget = { bytes: 0 }, totals = new Map<string, number>();
  const overall = AbortSignal.timeout(45000); let invalidAmount = false, pages = 0;
  try {
    for (; pages < 10; pages++) {
      const response = await (query.fetch ?? quotaNodeFetch)(`https://api.openai.com/v1/organization/costs?${params}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
        signal: AbortSignal.any([overall, AbortSignal.timeout(15000)]),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP_${response.status}`); }
      const data = object(await boundedJson(response, budget));
      if (data.object !== 'page' || !Array.isArray(data.data) || typeof data.has_more !== 'boolean') throw new Error('INVALID_RESPONSE');
      if (data.has_more && (typeof data.next_page !== 'string' || data.next_page.length > 1024 || !data.next_page || cursors.has(data.next_page))) throw new Error('INVALID_RESPONSE');
      for (const bucketValue of data.data) {
        const bucket = object(bucketValue), start = bucket.start_time, end = bucket.end_time;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || (start as number) >= (end as number) || (start as number) < query.startTime || (start as number) >= query.endTime || (end as number) > query.endTime + 86400 || !Array.isArray(bucket.results)) throw new Error('INVALID_RESPONSE');
        for (const rowValue of bucket.results) {
          const row = object(rowValue), amount = row.amount && typeof row.amount === 'object' ? object(row.amount) : {};
          if (projects.length && (typeof row.project_id !== 'string' || !projects.includes(row.project_id))) { invalidAmount = true; continue; }
          if (typeof amount.value !== 'number' || !Number.isFinite(amount.value) || Math.abs(amount.value) > 1e12 || typeof amount.currency !== 'string' || !/^[a-zA-Z]{3}$/.test(amount.currency)) { invalidAmount = true; continue; }
          const currency = amount.currency.toLowerCase(), total = (totals.get(currency) ?? 0) + amount.value;
          if (!Number.isFinite(total) || Math.abs(total) > 1e15 || result.rows.length >= 10000) throw new Error('RESPONSE_LIMIT');
          totals.set(currency, total);
          result.rows.push({ startTime: start as number, endTime: end as number, currency, amount: amount.value,
            projectId: typeof row.project_id === 'string' && /^proj_[a-zA-Z0-9_-]{1,100}$/.test(row.project_id) ? row.project_id : null, lineItem: label(row.line_item) });
        }
      }
      if (!data.has_more) { result.complete = !invalidAmount; result.code = invalidAmount ? 'MISSING_AMOUNT' : null; break; }
      if (typeof data.next_page !== 'string' || data.next_page.length > 1024 || !data.next_page || cursors.has(data.next_page)) throw new Error('INVALID_RESPONSE');
      cursors.add(data.next_page); params.set('page', data.next_page);
    }
    if (pages === 10) result.code = 'RESPONSE_LIMIT';
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    result.code = /^(HTTP_[1-5]\d\d|INVALID_RESPONSE|RESPONSE_LIMIT)$/.test(message) ? message
      : error instanceof Error && /Timeout|Abort/.test(error.name) ? 'TIMEOUT' : error instanceof SyntaxError ? 'INVALID_RESPONSE' : 'NETWORK_ERROR';
  }
  result.totals = [...totals].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => a.currency.localeCompare(b.currency));
  if (result.complete && !result.totals.length) result.totals = [{ currency: 'usd', amount: 0 }];
  result.status = result.complete ? 'ready' : result.rows.length ? 'partial' : 'unavailable';
  result.fetchedAt = Date.now() / 1000;
  return result;
}
