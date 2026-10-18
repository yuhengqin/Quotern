import { appendDashboardRangeQuery, previousRollingRange, type DashboardDateRange } from './dashboard-date-range.ts';
import { LEADERBOARD_DEFAULT_LIMIT } from 'quotern-core/leaderboard';
export { fetchPricingCatalog } from './pricing-data.ts';
export type { PricingCatalogRow, PricingCatalogResponse } from './pricing-data.ts';
import type {
  LeaderboardMetric,
  LeaderboardOverviewResponse,
  LeaderboardRange,
  LeaderboardResponse,
  UsageReport,
} from 'quotern-core';
import type { LocalUsageMetrics } from 'quotern-core/local-metrics';
import type { SessionMetrics } from 'quotern-core';
import { appendDeviceIdsQuery } from './device-filter.ts';
import type { AchievementSnapshot, AchievementOperation, AchievementNotice } from 'quotern-core/achievements';

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

export type {
  LeaderboardBoard,
  LeaderboardMetric,
  LeaderboardOverviewResponse,
  LeaderboardRange,
  LeaderboardResponse,
  LeaderboardRow,
  LeaderboardUserProfile,
  ToolLeaderboard,
} from 'quotern-core';

export interface LeaderboardFilterOptions {
  tools: Array<{ key: string; displayName: string }>;
  models: Array<{ tool: string; model: string }>;
}

export interface LeaderboardFilters {
  tool?: string;
  model?: string;
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

export async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    // Non-JSON body (e.g. plain "404 Not Found" from a missed proxy).
    throw new Error(`${init?.method ?? 'GET'} ${input} → ${res.status}`);
  }
  if (!res.ok || !body || body.success !== true || body.data === null) {
    const code = body?.message ?? `HTTP ${res.status}`;
    throw new Error(code);
  }
  return body.data;
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
  return request<UsageSummary>(appendDeviceIdsQuery(summary), {
    headers: authHeaders(),
  });
}

function dateRangeQuery(range?: DashboardDateRange): string {
  const query = new URLSearchParams();
  appendDashboardRangeQuery(query, range);
  return query.size ? `&${query}` : '';
}

export async function fetchDaily(days = 90, range?: DashboardDateRange): Promise<DailyUsageResponse> {
  const { others } = apiPrefixes();
  return request<DailyUsageResponse>(
    appendDeviceIdsQuery(`${others}usage-daily?days=${days}${dateRangeQuery(range)}`),
    {
      headers: authHeaders(),
    },
  );
}

export async function fetchHourly(days = 1, range?: DashboardDateRange): Promise<HourlyUsageResponse> {
  const { others } = apiPrefixes();
  return request<HourlyUsageResponse>(
    appendDeviceIdsQuery(`${others}usage-hourly?days=${days}${dateRangeQuery(range)}`),
    {
      headers: authHeaders(),
    },
  );
}

export async function fetchModelBreakdown(days = 30, range?: DashboardDateRange): Promise<ModelBreakdownResponse> {
  const { others } = apiPrefixes();
  return request<ModelBreakdownResponse>(
    appendDeviceIdsQuery(`${others}usage-model-breakdown?days=${days}${dateRangeQuery(range)}`),
    { headers: authHeaders() },
  );
}

export async function fetchLeaderboard(
  days: number,
  metric: LeaderboardMetric,
  limit = LEADERBOARD_DEFAULT_LIMIT,
): Promise<LeaderboardResponse> {
  const { others } = apiPrefixes();
  const query = new URLSearchParams({
    days: String(days),
    limit: String(limit),
    metric,
  });
  return request<LeaderboardResponse>(
    `${others}leaderboard?${query.toString()}`,
    { headers: authHeaders() },
  );
}

export async function fetchLeaderboardOverview(
  range: LeaderboardRange,
  limit = LEADERBOARD_DEFAULT_LIMIT,
  filters: LeaderboardFilters = {},
): Promise<LeaderboardOverviewResponse> {
  const { others } = apiPrefixes();
  const query = new URLSearchParams({
    range,
    limit: String(limit),
  });
  if (filters.tool) query.set('tool', filters.tool);
  if (filters.model) query.set('model', filters.model);
  return request<LeaderboardOverviewResponse>(
    `${others}leaderboard-overview?${query.toString()}`,
    { headers: authHeaders() },
  );
}

export interface LeaderboardPreference {
  hideFromLeaderboard: boolean;
}

export async function fetchLeaderboardPreference(): Promise<LeaderboardPreference> {
  const { others } = apiPrefixes();
  return request<LeaderboardPreference>(`${others}leaderboard-preference`, {
    headers: authHeaders(),
  });
}

export async function updateLeaderboardPreference(
  hideFromLeaderboard: boolean,
): Promise<LeaderboardPreference> {
  const { others } = apiPrefixes();
  return request<LeaderboardPreference>(`${others}leaderboard-preference`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ hideFromLeaderboard }),
  });
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  const { others } = apiPrefixes();
  return request<SyncStatus>(`${others}sync-status`, { headers: authHeaders() });
}

function fetchSyncStatusIfCli(): Promise<SyncStatus | null> {
  if (!isCliBackend()) return Promise.resolve(null);
  return fetchSyncStatus().catch(() => null);
}

/** Split windows so heatmap can keep long daily history while tool/model
 *  breakdown follows the selected dashboard range. */
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
  if (!isCliBackend()) {
    const { hydrateActiveDeviceIds, resolveDeviceFilterUserKey } = await import(
      './device-filter.ts'
    );
    hydrateActiveDeviceIds(resolveDeviceFilterUserKey());
  }
  const { dailyDays, breakdownDays, hourlyDays, dailyRange, hourlyRange, breakdownRange } =
    normalizeUsageDatasetDays(days);
  const [summary, syncStatus, daily, hourly, models, window] = await Promise.all([
    fetchSummary(),
    fetchSyncStatusIfCli(),
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

/** Thin refetch when daily/hourly cache already covers the heatmap window. */
export async function fetchUsageDatasetThin(
  previous: UsageDataset,
  breakdownDays: number,
  hourlyDays: number,
): Promise<UsageDataset> {
  if (!isCliBackend()) {
    const { hydrateActiveDeviceIds, resolveDeviceFilterUserKey } = await import(
      './device-filter.ts'
    );
    hydrateActiveDeviceIds(resolveDeviceFilterUserKey());
  }
  const [summary, syncStatus, hourly, models] = await Promise.all([
    fetchSummary(),
    fetchSyncStatusIfCli(),
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
    message.includes('→ 404') ||
    message.includes('→ 503')
  ) {
    return '请先运行 pnpm start，或确认 API 服务已启动。';
  }
  if (lower.includes('unauthorized') || message.includes('401')) {
    return isCliBackend()
      ? null
      : '请在「设置」中配置鉴权 Token，或检查 Token 是否有效。';
  }
  return null;
}
