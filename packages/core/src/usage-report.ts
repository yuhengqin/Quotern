import { readFile } from 'node:fs/promises';
import type { QueueBucket } from './types.js';
import type { TokenQuality } from './token-quality.js';
import { aggregateLocalMetrics, type LocalUsageMetrics } from './local-metrics.js';
import { normalizeProjectName } from './project-label.js';
import { normalizeSyncSource } from './sync/index.js';
import { configPath } from './paths.js';
import { loadBucketsForRange } from './queue/index.js';
import {
  applyRemotePricingOverlay, computeRowCost, explainRowCost,
  loadCachedPricingOverlay, roundCostUsd, type RowCostExplanation,
} from './pricing/index.js';
import { addLocalDays, DEFAULT_STATS_TIMEZONE, localDateAndHour, localDateDaysAgo, localDateNow } from './timezone.js';

export const USAGE_REPORT_PERIODS = ['summary', 'daily', 'weekly', 'monthly', 'models', 'projects'] as const;
export type UsageReportPeriod = typeof USAGE_REPORT_PERIODS[number];
export interface UsageReportQuery {
  period?: UsageReportPeriod;
  days?: number;
  fromDate?: string;
  toDate?: string;
  sources?: readonly string[];
  model?: string;
  project?: string;
}

export interface CostExplanation {
  version: 1;
  knownCostUsd: number;
  reportedCostUsd: number;
  estimatedCostUsd: number;
  totalTokens: number;
  unpricedTokens: number;
  defaultPricedTokens: number;
  /** Token amounts by recorded provenance; mixed buckets cannot be split retrospectively. */
  tokenQualityTokens: Record<TokenQuality | 'unknown', number>;
  entries: RowCostExplanation[];
}

export interface UsageReportTotals {
  tokens: number;
  /** Null whenever some consumed token fields lack prices. knownCostUsd is the priced subtotal. */
  costUsd: number | null;
  knownCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  localMetrics: LocalUsageMetrics;
  costExplanation: CostExplanation;
}
export interface UsageReportRow extends UsageReportTotals {
  key: string;
  label: string;
  source?: string;
  model?: string;
  project?: string;
  fromDate?: string;
  toDate?: string;
}
export interface UsageReport {
  schemaVersion: 1;
  period: UsageReportPeriod;
  timeZone: string;
  fromDate: string;
  toDate: string;
  filters: { sources: string[]; model: string | null; project: string | null };
  coverage: {
    collectSince: string;
    fromDate: string;
    toDate: string;
    limited: boolean;
    snapshot: 'persisted' | 'runtime';
    lastSyncAt: string | null;
    readAt: string;
    invalidRows: number;
  };
  summary: UsageReportTotals;
  rows: UsageReportRow[];
}
export interface UsageReportContext {
  collectSince: string;
  lastSyncAt?: string | null;
  snapshot?: 'persisted' | 'runtime';
  now?: Date;
}

export function aggregateCostExplanation(rows: readonly QueueBucket[]): CostExplanation {
  const result: CostExplanation = {
    version: 1, knownCostUsd: 0, reportedCostUsd: 0, estimatedCostUsd: 0,
    totalTokens: 0, unpricedTokens: 0, defaultPricedTokens: 0,
    tokenQualityTokens: { recorded: 0, estimated: 0, ledger: 0, mixed: 0, unknown: 0 }, entries: [],
  };
  const entries = new Map<string, RowCostExplanation>();
  for (const row of rows) {
    const detail = explainRowCost(row);
    const cost = computeRowCost(row);
    result.knownCostUsd += cost;
    result.totalTokens += detail.tokens;
    result.unpricedTokens += detail.unpricedTokens;
    if (detail.costKind === 'reported') result.reportedCostUsd += cost;
    else result.estimatedCostUsd += cost;
    if (detail.matchMethod === 'default') result.defaultPricedTokens += detail.tokens;
    const quality = row.collector === 'codex-ledger' ? 'ledger' : row.token_quality;
    result.tokenQualityTokens[quality && Object.hasOwn(result.tokenQualityTokens, quality) ? quality : 'unknown'] += detail.tokens;
    const key = JSON.stringify([detail.source, detail.model, detail.matchMethod, detail.priceTable, detail.matchedModel, detail.costKind]);
    const previous = entries.get(key);
    if (previous) {
      previous.tokens += detail.tokens;
      previous.unpricedTokens += detail.unpricedTokens;
      previous.costUsd = previous.costUsd === null && detail.costUsd === null ? null : (previous.costUsd ?? 0) + (detail.costUsd ?? 0);
    } else {
      entries.set(key, { ...detail });
    }
  }
  result.knownCostUsd = roundCostUsd(result.knownCostUsd);
  result.reportedCostUsd = roundCostUsd(result.reportedCostUsd);
  result.estimatedCostUsd = roundCostUsd(result.estimatedCostUsd);
  result.entries = [...entries.values()].map((entry) => ({ ...entry, costUsd: entry.costUsd === null ? null : roundCostUsd(entry.costUsd) }))
    .sort((a, b) => b.tokens - a.tokens || a.source.localeCompare(b.source) || a.model.localeCompare(b.model));
  return result;
}

function totals(rows: readonly QueueBucket[]): UsageReportTotals {
  const costExplanation = aggregateCostExplanation(rows);
  const sum = (key: keyof Pick<QueueBucket, 'input_tokens' | 'output_tokens' | 'cached_input_tokens' | 'cache_creation_input_tokens' | 'reasoning_output_tokens'>) => rows.reduce((n, row) => n + (row[key] ?? 0), 0);
  return {
    tokens: costExplanation.totalTokens,
    costUsd: costExplanation.unpricedTokens > 0 ? null : costExplanation.knownCostUsd,
    knownCostUsd: costExplanation.knownCostUsd,
    inputTokens: sum('input_tokens'), outputTokens: sum('output_tokens'),
    cacheReadTokens: sum('cached_input_tokens'), cacheWriteTokens: sum('cache_creation_input_tokens'), reasoningTokens: sum('reasoning_output_tokens'),
    localMetrics: aggregateLocalMetrics(rows), costExplanation,
  };
}

export function isUsageReportDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}

function validBucket(row: QueueBucket): boolean {
  return !!row && typeof row.source === 'string' && typeof row.model === 'string' && typeof row.project === 'string'
    && Number.isFinite(Date.parse(row.hour_start))
    && [row.input_tokens, row.output_tokens, row.cached_input_tokens, row.cache_creation_input_tokens, row.reasoning_output_tokens ?? 0, row.conversation_count ?? 0]
      .every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0);
}

/** Pure query over the same local buckets as the UI. Does not widen collection or read raw conversations. */
export function buildUsageReport(rows: readonly QueueBucket[], query: UsageReportQuery, context: UsageReportContext): UsageReport {
  const now = context.now ?? new Date();
  const period = query.period ?? 'summary';
  if (!(USAGE_REPORT_PERIODS as readonly string[]).includes(period)) throw new Error('无效的报表类型');
  if (!Number.isFinite(Date.parse(context.collectSince))) throw new Error('本地配置的采集起点无效');
  if (query.days !== undefined && (!Number.isInteger(query.days) || query.days < 1 || query.days > 3660)) throw new Error('days 必须是 1 到 3660 的整数');
  const explicitRange = query.fromDate !== undefined || query.toDate !== undefined;
  if (explicitRange && (query.days !== undefined || !isUsageReportDate(query.fromDate) || !isUsageReportDate(query.toDate))) {
    throw new Error('日期须同时提供有效的 fromDate/toDate，且不能同时指定 days');
  }
  const fromDate = query.fromDate ?? localDateDaysAgo(query.days ?? 7, DEFAULT_STATS_TIMEZONE, now);
  const toDate = query.toDate ?? localDateNow(DEFAULT_STATS_TIMEZONE, now);
  if (fromDate > toDate || toDate > localDateNow(DEFAULT_STATS_TIMEZONE, now)) throw new Error('日期范围无效或晚于今天');
  const sources = [...new Set((query.sources ?? []).map((source) => {
    const normalized = normalizeSyncSource(source);
    if (!source.trim() || normalized === null) throw new Error(`未知的数据源: ${source}`);
    return normalized;
  }))];
  if (sources.includes(undefined) && sources.length > 1) throw new Error('all 不能与其他数据源同时使用');
  const selectedSources: string[] = sources.filter((source) => source !== undefined);
  const model = query.model?.trim() ?? null;
  const project = query.project === undefined ? null : normalizeProjectName(query.project.trim());
  if (query.model !== undefined && !model || query.project !== undefined && !query.project.trim()) throw new Error('模型和项目筛选不能为空');
  const floorDate = localDateAndHour(context.collectSince).date;
  const effectiveFrom = floorDate > fromDate ? floorDate : fromDate;
  let invalidRows = 0;
  const selected = rows.filter((row) => {
    if (!validBucket(row)) { invalidRows++; return false; }
    const date = localDateAndHour(row.hour_start).date;
    return date >= effectiveFrom && date <= toDate
      && (!selectedSources.length || selectedSources.includes(row.source))
      && (!model || row.model === model)
      && (!project || normalizeProjectName(row.project || 'unknown') === project);
  });
  const groups = new Map<string, { identity: Omit<UsageReportRow, keyof UsageReportTotals>; rows: QueueBucket[] }>();
  for (const row of selected) {
    const date = localDateAndHour(row.hour_start).date;
    let key = 'summary';
    let identity: Omit<UsageReportRow, keyof UsageReportTotals> = { key, label: '合计' };
    if (period === 'models') {
      key = JSON.stringify([row.source, row.model]);
      identity = { key, label: row.model, source: row.source, model: row.model };
    } else if (period === 'projects') {
      key = normalizeProjectName(row.project || 'unknown');
      identity = { key, label: key, project: key };
    } else if (period !== 'summary') {
      key = period === 'daily' ? date : period === 'monthly' ? date.slice(0, 7)
        : addLocalDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
      const start = period === 'monthly' ? `${key}-01` : key;
      const end = period === 'weekly' ? addLocalDays(start, 6) : period === 'monthly'
        ? new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).toISOString().slice(0, 10) : date;
      identity = { key, label: key, fromDate: start < effectiveFrom ? effectiveFrom : start, toDate: end > toDate ? toDate : end };
    }
    const group = groups.get(key) ?? { identity, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  const summary = totals(selected);
  const reportRows = [...groups.values()].map((group) => ({ ...group.identity, ...totals(group.rows) }));
  reportRows.sort(period === 'models' || period === 'projects' ? (a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key) : (a, b) => a.key.localeCompare(b.key));
  if (period === 'summary' && !reportRows.length) reportRows.push({ key: 'summary', label: '合计', ...summary });
  return {
    schemaVersion: 1, period, timeZone: DEFAULT_STATS_TIMEZONE, fromDate, toDate,
    filters: { sources: selectedSources, model, project },
    coverage: {
      collectSince: context.collectSince, fromDate: effectiveFrom, toDate,
      limited: Date.parse(context.collectSince) > Date.parse(`${fromDate}T00:00:00+08:00`),
      snapshot: context.snapshot ?? 'runtime', lastSyncAt: context.lastSyncAt ?? null, readAt: now.toISOString(), invalidRows,
    }, summary, rows: reportRows,
  };
}

/** Read only persisted metadata and queue snapshots. No config repair, locks, runtime ownership or network. */
export async function readUsageReport(dataDir: string, query: UsageReportQuery, options?: { now?: Date }): Promise<UsageReport> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(configPath(dataDir), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('未找到本地用量配置，请先使用 Quotern 采集数据或指定 --data-dir');
    throw new Error('无法读取本地用量配置；只读查询不会修复配置', { cause: error });
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('本地用量配置无效');
  const config = raw as Record<string, unknown>;
  const collectSince = typeof config.localCollectSince === 'string' && config.localCollectSince.trim()
    ? config.localCollectSince : config.statsSince;
  if (typeof collectSince !== 'string' || !Number.isFinite(Date.parse(collectSince))) throw new Error('本地配置的采集起点无效');
  const rows = await loadBucketsForRange(dataDir, collectSince);
  if (!loadCachedPricingOverlay(dataDir)) applyRemotePricingOverlay(null);
  return buildUsageReport(rows, query, {
    collectSince, snapshot: 'persisted', now: options?.now,
    lastSyncAt: typeof config.lastSyncAt === 'string' && Number.isFinite(Date.parse(config.lastSyncAt)) ? config.lastSyncAt : null,
  });
}
