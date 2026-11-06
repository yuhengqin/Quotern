import { quotaNodeFetch } from './readers/quota-fetch-state.js';
import type { BillingError, BillingOrganization, BillingReport, BillingSection, BillingSource, ConsoleCostRow, ConsoleDetails } from './shared/billing.js';

const origins = { extra: 'https://claude.ai', console: 'https://console.anthropic.com' } as const;
export const validBillingSource = (value: unknown): value is BillingSource => value === 'extra' || value === 'console';
export const validBillingOrganization = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const label = (value: unknown): string | null => typeof value === 'string' && value.trim() && value.length <= 240 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;
const fail = (code: string): never => { throw new Error(code); };
const errors = new Set<BillingError>(['BILLING_AUTH', 'BILLING_CHALLENGE', 'BILLING_RATE_LIMIT', 'BILLING_NETWORK', 'BILLING_HTTP', 'BILLING_INVALID_RESPONSE', 'BILLING_RESPONSE_TOO_LARGE', 'BILLING_CURRENCY']);
const errorCode = (error: unknown): BillingError => error instanceof Error && errors.has(error.message as BillingError) ? error.message as BillingError : 'BILLING_NETWORK';

/** Accept a sessionKey value or a pasted Cookie header. Other cookies are discarded. */
export function normalizeBillingCookie(input: unknown): string {
  if (typeof input !== 'string' || input.length > 16_384 || /[^\x20-\x7e]/.test(input)) return fail('BILLING_COOKIE_INVALID');
  const value = input.trim().replace(/^Cookie:\s*/i, '');
  if (!value) return fail('BILLING_COOKIE_INVALID');
  if (!value.includes('=')) {
    if (/[;\s,]/.test(value)) return fail('BILLING_COOKIE_INVALID');
    return `sessionKey=${value}`;
  }
  const allowed = new Set(['sessionKey', 'cf_clearance', '__cf_bm', 'anthropic-device-id']), selected = new Map<string, string>();
  for (const part of value.split(';')) {
    const match = /^\s*([^=\s]+)=([^;]*)\s*$/.exec(part);
    if (!match || !allowed.has(match[1]!)) continue;
    const cookie = match[2]!.trim();
    if (!cookie || /[\s,]/.test(cookie) || selected.has(match[1]!)) return fail('BILLING_COOKIE_INVALID');
    selected.set(match[1]!, cookie);
  }
  if (!selected.has('sessionKey')) return fail('BILLING_COOKIE_INVALID');
  return [...selected].map(([key, cookie]) => `${key}=${cookie}`).join('; ');
}

export function usdFromCents(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER ? number / 100 : null;
}
function currency(value: Record<string, unknown>, required = false): void {
  if (value.currency === undefined && !required) return;
  if (typeof value.currency !== 'string' || value.currency.toUpperCase() !== 'USD') fail('BILLING_CURRENCY');
}
async function readJson(source: BillingSource, path: string, cookie: string, fetcher: typeof fetch): Promise<unknown> {
  try {
    const response = await fetcher(`${origins[source]}/api${path}`, { method: 'GET', headers: { Cookie: cookie, Accept: 'application/json' }, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12_000) });
    if (response.headers.get('cf-mitigated') === 'challenge' || response.headers.get('content-type')?.includes('text/html')) { await response.body?.cancel(); return fail('BILLING_CHALLENGE'); }
    if (!response.ok) { await response.body?.cancel(); return fail(response.status === 401 || response.status === 403 ? 'BILLING_AUTH' : response.status === 429 ? 'BILLING_RATE_LIMIT' : 'BILLING_HTTP'); }
    const max = 2 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); return fail('BILLING_RESPONSE_TOO_LARGE'); }
    if (!response.body) return fail('BILLING_INVALID_RESPONSE');
    const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > max) { await reader.cancel(); return fail('BILLING_RESPONSE_TOO_LARGE'); } parts.push(next.value); }
    } finally { reader.releaseLock(); }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); }
    catch { return fail('BILLING_INVALID_RESPONSE'); }
  } catch (error) { return fail(errorCode(error)); }
}
function object(value: unknown): Record<string, unknown> { return record(value) ? value : fail('BILLING_INVALID_RESPONSE'); }

export async function discoverBillingOrganizations(source: BillingSource, input: string, fetcher: typeof fetch = quotaNodeFetch): Promise<BillingOrganization[]> {
  const value = await readJson(source, '/organizations', normalizeBillingCookie(input), fetcher);
  const rows = Array.isArray(value) ? value : record(value) && Array.isArray(value.data) ? value.data : fail('BILLING_INVALID_RESPONSE');
  if (rows.length > 200) return fail('BILLING_INVALID_RESPONSE');
  const result = new Map<string, BillingOrganization>();
  for (const row of rows) {
    if (!record(row)) return fail('BILLING_INVALID_RESPONSE');
    const id = row.uuid ?? row.id, name = label(row.name);
    if (!validBillingOrganization(id) || !name) return fail('BILLING_INVALID_RESPONSE');
    result.set(id, { id, name });
  }
  return [...result.values()];
}

export function parseConsoleDetails(value: unknown, from: string, until: string, names = new Map<string, string>()): ConsoleDetails {
  const input = object(value); currency(input);
  if (!['costs', 'web_search_costs', 'code_execution_costs'].some(key => record(input[key]))) return fail('BILLING_INVALID_RESPONSE');
  let complete = record(input.costs) && input.has_more !== true && !input.next_page && !input.next_cursor, unknownRows = 0, cents = 0, known = 0;
  const rows: ConsoleCostRow[] = [];
  for (const key of ['costs', 'web_search_costs', 'code_execution_costs']) {
    const dates = input[key];
    if (dates === undefined || dates === null) continue;
    if (!record(dates)) { complete = false; unknownRows++; continue; }
    for (const [day, entries] of Object.entries(dates)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day || day < from || day >= until || !Array.isArray(entries)) { complete = false; unknownRows++; continue; }
      for (const entry of entries) {
        if (rows.length >= 20_000) { complete = false; unknownRows++; continue; }
        if (!record(entry)) { complete = false; unknownRows++; continue; }
        const usd = usdFromCents(entry.total), keyId = label(entry.key_id), model = key === 'costs' ? label(entry.model_name)?.replace(/ Usage$/, '') ?? null : key === 'web_search_costs' ? 'Web Search' : 'Code Execution';
        if (usd === null) { complete = false; unknownRows++; } else { cents += usd * 100; known++; }
        rows.push({ day, keyId, keyName: keyId ? names.get(keyId) ?? null : null, model, usd });
      }
    }
  }
  const totalUsd = known ? cents / 100 : unknownRows ? null : 0;
  return { from, until, totalUsd, complete, unknownRows, rows: rows.sort((a, b) => a.day.localeCompare(b.day) || (a.keyId ?? '').localeCompare(b.keyId ?? '') || (a.model ?? '').localeCompare(b.model ?? '')) };
}

export async function readBillingReport(source: BillingSource, organization: string, cookie: string, options: { fetch?: typeof fetch; now?: Date; previous?: BillingReport | null } = {}): Promise<BillingReport> {
  if (!validBillingOrganization(organization)) return fail('BILLING_ORGANIZATION_INVALID');
  const fetcher = options.fetch ?? quotaNodeFetch, now = options.now ?? new Date(), at = now.getTime() / 1000, previous = options.previous;
  const get = (path: string) => readJson(source, `/organizations/${encodeURIComponent(organization)}${path}`, normalizeBillingCookie(cookie), fetcher);
  async function section<T>(read: () => Promise<T>, old?: BillingSection<T>): Promise<BillingSection<T>> {
    try { return { data: await read(), observedAt: at, stale: false, error: null }; }
    catch (error) { return { data: old?.data ?? null, observedAt: old?.observedAt ?? null, stale: !!old?.data, error: errorCode(error) }; }
  }
  if (source === 'extra') {
    const [spend, grants] = await Promise.all([
      section(async () => { const v = object(await get('/overage_spend_limit')); currency(v, true); return { enabled: typeof v.is_enabled === 'boolean' ? v.is_enabled : null, usedUsd: usdFromCents(v.used_credits), limitUsd: usdFromCents(v.monthly_credit_limit) }; }, previous?.spend),
      section(async () => { const v = object(await get('/overage_credit_grant')); currency(v, true); return { remainingUsd: usdFromCents(v.remaining_balance), grantedUsd: usdFromCents(v.total_granted) }; }, previous?.grants),
    ]);
    return { attemptedAt: at, spend, grants };
  }
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10), until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  const [currentSpend, prepaid, details] = await Promise.all([
    section(async () => { const v = object(await get('/current_spend')); currency(v); return { usd: usdFromCents(v.amount), resetsAt: typeof v.resets_at === 'string' && Number.isFinite(Date.parse(v.resets_at)) ? new Date(v.resets_at).toISOString() : null }; }, previous?.currentSpend),
    section(async () => { const v = object(await get('/prepaid/credits')); currency(v, true); return { usd: usdFromCents(v.amount) }; }, previous?.prepaid),
    section(async () => {
      const [cost, keys] = await Promise.allSettled([get(`/workspaces/default/usage_cost?starting_on=${from}&ending_before=${until}&group_by=api_key_id`), get('/api_keys?status=active')]);
      if (cost.status === 'rejected') throw cost.reason;
      const names = new Map<string, string>(), rawKeys = keys.status === 'fulfilled' ? keys.value : null;
      const list = Array.isArray(rawKeys) ? rawKeys : record(rawKeys) && Array.isArray(rawKeys.data) ? rawKeys.data : [];
      for (const key of list) if (record(key) && label(key.id) && label(key.name)) names.set(label(key.id)!, label(key.name)!);
      return parseConsoleDetails(cost.value, from, until, names);
    }, previous?.details),
  ]);
  return { attemptedAt: at, currentSpend, prepaid, details };
}
