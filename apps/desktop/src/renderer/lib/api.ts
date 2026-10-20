import { appendDashboardRangeQuery, previousRollingRange, type DashboardDateRange } from './dashboard-date-range.js';
import type { LocalUsageMetrics } from 'quotern-core/local-metrics';
import type { SessionMetrics, UsageReport } from 'quotern-core';
import type { AchievementSnapshot, AchievementOperation, AchievementNotice } from 'quotern-core/achievements';
import type { PricingData, PricingStatus } from 'quotern-core';
import { fetchPricingCatalog as fetchPublishedPricingCatalog, pricingDataToCatalog, type PricingCatalogResponse } from '../../../../../packages/dashboard/src/lib/pricing-data';

export async function fetchPricingCatalog(): Promise<PricingCatalogResponse> {
  try {
    const data = await request<{ pricing: PricingData; status: Omit<PricingStatus, 'url'> }>('/functions/tud-pricing');
    return { ...pricingDataToCatalog(data.pricing, data.status.hasOverlay ? 'runtime' : 'bundled', data.status.updatedAt), refreshing: data.status.refreshing };
  } catch { return fetchPublishedPricingCatalog(); }
}

export async function fetchSessionMetrics(days: number, range?: DashboardDateRange, sources: readonly string[] = []): Promise<SessionMetrics> {
  const { others } = apiPrefixes();
  const query = new URLSearchParams({ days: String(days) });
  appendDashboardRangeQuery(query, range);
  if (sources.length) query.set('sources', sources.join(','));
  return request<SessionMetrics>(`${others}usage-sessions?${query}`, { headers: authHeaders() });
}

export async function fetchUsageReport(days: number, range?: DashboardDateRange, sources: readonly string[] = []): Promise<UsageReport> {
  const { others } = apiPrefixes();
  const query = new URLSearchParams({ period: 'summary' });
  if (range) {
    appendDashboardRangeQuery(query, range);
  } else {
    query.set('days', String(days));
  }
  if (sources.length) query.set('sources', sources.join(','));
  return request<UsageReport>(`${others}usage-report?${query.toString()}`, { headers: authHeaders() });
}

export async function fetchAchievements(): Promise<AchievementSnapshot> {
  return request<AchievementSnapshot>(`${apiPrefixes().others}achievements`, { headers: authHeaders() });
}

export async function updateAchievements(operation: AchievementOperation): Promise<{ snapshot: AchievementSnapshot; notice?: AchievementNotice }> {
  return request<{ snapshot: AchievementSnapshot; notice?: AchievementNotice }>(`${apiPrefixes().others}achievements`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(operation),
  });
}

export interface ModelUsageRow {
  localMetrics?: LocalUsageMetrics;
  model: string;
  tokens: number;
  costUsd: number;
  pct: number;
}

/**
 * Unified response envelope used by both the cloud API and the
 * CLI local-api (8452):
 *
 *   { success: true,  message: 'ok',        data: T }
 *   { success: false, message: 'CODE_NAME', data: null }
 *
 * `request<T>` enforces this contract at the fetch boundary:
 *   - non-2xx HTTP      → throw `Error('NAME ${status}')`
 *   - 2xx but `success=false` → throw `Error(message)` (server-side code)
 *   - 2xx and `success=true`  → return `data` (the inner payload, not the envelope)
 *
 * Callers always work with the unwrapped `data` shape (e.g. `UsageSummary`
 * directly), so they never have to walk `.data.xxx` and never see `null`
 * where an object was expected.
 */
interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
}

export const LOCAL_RUNTIME_RECOVERING_HINT = '本地服务正在恢复，请稍候';
const LOCAL_RUNTIME_RETRY_MS = 20_000;
const LOCAL_RUNTIME_RETRY_GAP_MS = 500;

export async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const envelope = await transportRequest<T>(input, init);
  if (!envelope || envelope.success !== true || envelope.data === null) {
    const code = envelope?.message ?? 'REQUEST_FAILED';
    throw new Error(
      code === 'LOCAL_RUNTIME_NOT_READY' ? LOCAL_RUNTIME_RECOVERING_HINT : code,
    );
  }
  return envelope.data;
}

function hasDesktopApi(): boolean {
  return typeof window !== 'undefined' && typeof window.tud?.api?.request === 'function';
}

function isRuntimeNotReadyBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  return (body as { message?: unknown }).message === 'LOCAL_RUNTIME_NOT_READY';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Prefer in-process Core IPC in Electron; fall back to HTTP fetch elsewhere. */
async function transportRequest<T>(
  input: string,
  init?: RequestInit,
): Promise<Envelope<T> | null> {
  if (hasDesktopApi()) {
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((value, key) => {
        headers[key] = value;
      });
    }
    const body =
      typeof init?.body === 'string'
        ? init.body
        : init?.body != null
          ? String(init.body)
          : undefined;
    const deadline = Date.now() + LOCAL_RUNTIME_RETRY_MS;
    for (;;) {
      const { status, body: raw } = await window.tud.api.request(input, {
        method: init?.method,
        body,
        headers,
      });
      if (status === 503 || isRuntimeNotReadyBody(raw)) {
        if (Date.now() >= deadline) {
          return {
            success: false,
            message: LOCAL_RUNTIME_RECOVERING_HINT,
            data: null,
          };
        }
        await sleep(LOCAL_RUNTIME_RETRY_GAP_MS);
        continue;
      }
      if (status >= 400 && (raw == null || typeof raw !== 'object')) {
        throw new Error(`${init?.method ?? 'GET'} ${input} → ${status}`);
      }
      return raw as Envelope<T>;
    }
  }

  const res = await fetch(input, init);
  try {
    return (await res.json()) as Envelope<T>;
  } catch {
    throw new Error(`${init?.method ?? 'GET'} ${input} → ${res.status}`);
  }
}

export interface SourceUsageRow {
  localMetrics?: LocalUsageMetrics;
  source: string;
  tokens: number;
  costUsd: number;
  pct: number;
  models: ModelUsageRow[];
}

export interface UsageSummary {
  localMetrics?: LocalUsageMetrics;
  todayLocalMetrics?: LocalUsageMetrics;
  totalTokens: number;
  totalCostUsd: number;
  todayTokens: number;
  todayCostUsd: number;
  statsSince: string;
  bySource: SourceUsageRow[];
}

export interface DailyProjectUsage {
  project: string;
  tokens: number;
  models: Record<string, number>;
}

export interface DailyUsageRow {
  date: string;
  tokens: number;
  costUsd: number;
  models: Record<string, number>;
  projects?: DailyProjectUsage[];
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  sources?: Array<{
    source: string;
    tokens: number;
    costUsd: number;
    localMetrics: LocalUsageMetrics;
  }>;
  localMetrics?: LocalUsageMetrics;
}

export interface DailyUsageResponse {
  days: DailyUsageRow[];
}

export interface HourlyUsageRow {
  date: string;
  hour: number;
  /** Tool / integration channel (e.g. `claude`, `cursor`). */
  source: string;
  tokens: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  localMetrics?: LocalUsageMetrics;
}

export interface HourlyUsageResponse {
  hours: HourlyUsageRow[];
  timeZone: string;
}

export interface ModelBreakdownRow {
  localMetrics?: LocalUsageMetrics;
  model: string;
  source: string;
  tokens: number;
  costUsd: number;
  pct: number;
}

export interface ProjectModelBreakdownRow {
  model: string;
  source: string;
  tokens: number;
  costUsd: number;
  pct: number;
}

export interface ProjectBreakdownRow {
  project: string;
  tokens: number;
  costUsd: number;
  pct: number;
  models?: ProjectModelBreakdownRow[];
}

export interface ModelBreakdownResponse {
  models: ModelBreakdownRow[];
  projects: ProjectBreakdownRow[];
}

export interface UsageDataset {
  window?: { dailyRows: DailyUsageRow[]; hourlyRows: HourlyUsageRow[]; previousHourlyRows: HourlyUsageRow[] };
  summary: UsageSummary;
  dailyRows: DailyUsageRow[];
  hourlyRows: HourlyUsageRow[];
  modelRows: ModelBreakdownRow[];
  projectRows: ProjectBreakdownRow[];
  syncStatus: SyncStatus | null;
}

export interface SyncStatus {
  lastSyncAt: string | null;
  /** Server ingest floor; present on cloud sync-status. */
  ingestMinOccurredAt?: string | null;
  statsSince: string;
  sources: Record<
    string,
    {
      status: string;
      hook: string;
      syncMode: string;
      message?: string;
    }
  >;
}

export interface TudConfigView {
  deviceId: string;
  statsSince: string;
  localCollectSince?: string;
  lastSyncAt: string | null;
}

/** Both browser and Electron panels read the local runtime. */
export function isCliBackend(): boolean {
  return true;
}

function functionsPrefix(): string {
  return '/functions/tud-';
}

function apiPrefixes(): { summary: string; others: string } {
  const prefix = functionsPrefix();
  return {
    summary: `${prefix}account-usage-summary`,
    others: prefix,
  };
}

function authHeaders(): Record<string, string> {
  return {};
}

export async function fetchSummary(): Promise<UsageSummary> {
  const { summary } = apiPrefixes();
  return request<UsageSummary>(summary, { headers: authHeaders() });
}

function dateRangeQuery(range?: DashboardDateRange): string {
  const query = new URLSearchParams();
  appendDashboardRangeQuery(query, range);
  return query.size ? `&${query}` : '';
}

export async function fetchDaily(days = 90, range?: DashboardDateRange): Promise<DailyUsageResponse> {
  const { others } = apiPrefixes();
  return request<DailyUsageResponse>(`${others}usage-daily?days=${days}${dateRangeQuery(range)}`, {
    headers: authHeaders(),
  });
}

export async function fetchHourly(days = 1, range?: DashboardDateRange): Promise<HourlyUsageResponse> {
  const { others } = apiPrefixes();
  return request<HourlyUsageResponse>(`${others}usage-hourly?days=${days}${dateRangeQuery(range)}`, {
    headers: authHeaders(),
  });
}

export async function fetchModelBreakdown(days = 30, range?: DashboardDateRange): Promise<ModelBreakdownResponse> {
  const { others } = apiPrefixes();
  return request<ModelBreakdownResponse>(
    `${others}usage-model-breakdown?days=${days}${dateRangeQuery(range)}`,
    { headers: authHeaders() },
  );
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  const { others } = apiPrefixes();
  return request<SyncStatus>(`${others}sync-status`, { headers: authHeaders() });
}

export type UsageDatasetFetchDays =
  | number
  | {
      dailyDays: number;
      breakdownDays: number;
      hourlyDays?: number;
      dailyRange?: DashboardDateRange;
      hourlyRange?: DashboardDateRange;
      breakdownRange?: DashboardDateRange;
    };

function normalizeUsageDatasetDays(days: UsageDatasetFetchDays): {
  dailyDays: number;
  breakdownDays: number;
  hourlyDays: number;
  dailyRange?: DashboardDateRange;
  hourlyRange?: DashboardDateRange;
  breakdownRange?: DashboardDateRange;
} {
  if (typeof days === 'number') {
    return { dailyDays: days, breakdownDays: days, hourlyDays: days };
  }
  return {
    ...days,
    dailyDays: days.dailyDays,
    breakdownDays: days.breakdownDays,
    hourlyDays: days.hourlyDays ?? days.breakdownDays,
  };
}

/**
 * Shared read model for both the root usage page and the visual Dashboard.
 * Keeping the parallel request and envelope normalization here prevents the
 * two routes from drifting into subtly different loading behavior.
 *
 * Pass a number to use the same window for daily + breakdown (legacy usage
 * page). Pass `{ dailyDays, breakdownDays, hourlyDays }` when the activity
 * heatmap needs a longer daily lookback than the selected tool/model range.
 */
export async function fetchUsageDataset(
  days: UsageDatasetFetchDays,
): Promise<UsageDataset> {
  const { dailyDays, breakdownDays, hourlyDays, dailyRange, hourlyRange, breakdownRange } =
    normalizeUsageDatasetDays(days);
  const [summary, syncStatus, daily, hourly, models, window] = await Promise.all([
    fetchSummary(),
    fetchSyncStatus().catch(() => null),
    fetchDaily(dailyDays, dailyRange),
    fetchHourly(hourlyDays, hourlyRange).catch(() => ({
      hours: [],
      timeZone: 'Asia/Shanghai',
    })),
    fetchModelBreakdown(breakdownDays, breakdownRange),
    breakdownRange?.fromTime ? Promise.all([
      fetchDaily(2, breakdownRange), fetchHourly(2, breakdownRange), fetchHourly(3, previousRollingRange(breakdownRange)),
    ]).then(([current, hours, previous]) => ({ dailyRows: current.days, hourlyRows: hours.hours, previousHourlyRows: previous.hours })) : undefined,
  ]);

  return {
    ...(window ? { window } : {}),
    summary,
    syncStatus,
    dailyRows: daily.days ?? [],
    hourlyRows: hourly.hours ?? [],
    modelRows: (models.models ?? []).filter((row) => row.tokens > 0),
    projectRows: (models.projects ?? []).filter((row) => row.tokens > 0),
  };
}

/** Thin refetch when daily cache already covers the heatmap window. */
export async function fetchUsageDatasetThin(
  previous: UsageDataset,
  breakdownDays: number,
  hourlyDays: number,
): Promise<UsageDataset> {
  const [summary, syncStatus, hourly, models] = await Promise.all([
    fetchSummary(),
    fetchSyncStatus().catch(() => null),
    fetchHourly(hourlyDays).catch(() => ({
      hours: [],
      timeZone: 'Asia/Shanghai',
    })),
    fetchModelBreakdown(breakdownDays),
  ]);

  return {
    summary,
    syncStatus: syncStatus ?? previous.syncStatus,
    dailyRows: previous.dailyRows,
    hourlyRows: hourly.hours ?? [],
    modelRows: (models.models ?? []).filter((row) => row.tokens > 0),
    projectRows: (models.projects ?? []).filter((row) => row.tokens > 0),
  };
}

export interface TriggerSyncResult {
  ok: boolean;
  results: unknown[];
  message: string;
}

export async function triggerSync(): Promise<TriggerSyncResult> {
  const { others } = apiPrefixes();
  return request<TriggerSyncResult>(`${others}trigger-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: '{}',
  });
}

export interface EnsureLocalRangeResult {
  expanded: boolean;
  localCollectSince: string;
  statsSince: string;
  sync: { ok: boolean; results: unknown[] } | null;
  message: string;
}

/** Expand local collect floor for today/7D/30D/90D and re-sync when needed. */
export async function ensureLocalRange(
  days: number,
  custom = false,
): Promise<EnsureLocalRangeResult> {
  const { others } = apiPrefixes();
  return request<EnsureLocalRangeResult>(`${others}ensure-local-range`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ days, custom }),
  });
}

export async function fetchConfig(): Promise<TudConfigView> {
  const { others } = apiPrefixes();
  return request<TudConfigView>(`${others}config`, { headers: authHeaders() });
}

export function apiErrorHint(message: string): string | null {
  const lower = message.toLowerCase();
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('local_runtime_not_ready') ||
    message.includes(LOCAL_RUNTIME_RECOVERING_HINT) ||
    message.includes('→ 404') ||
    message.includes('→ 503')
  ) {
    return isCliBackend()
      ? LOCAL_RUNTIME_RECOVERING_HINT
      : '请先运行 pnpm start，或确认 API 服务已启动。';
  }
  if (lower.includes('unauthorized') || message.includes('401')) {
    return isCliBackend()
      ? null
      : '请在「设置」中配置鉴权 Token，或检查 Token 是否有效。';
  }
  return null;
}
