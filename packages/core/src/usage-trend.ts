import type { QueueBucket } from './types.js';
import { buildUsageReport, type UsageReportContext, type UsageReportQuery, type UsageReport } from './usage-report.js';
import { addLocalDays, localDateAndHour } from './timezone.js';
import { normalizeProjectName } from './project-label.js';
import { explainRowCost, roundCostUsd } from './pricing/index.js';

export type TrendGranularity = 'hourly' | 'daily' | 'weekly' | 'monthly';
export interface UsageTrendValue {
  tokens: number; costUsd: number | null; knownCostUsd: number; unpricedTokens: number;
  inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; reasoningTokens: number;
}
export interface UsageTrendPoint extends UsageTrendValue {
  key: string; fromDate: string; toDate: string; models: Record<string, UsageTrendValue>;
}
export interface UsageTrend {
  granularity: TrendGranularity; fromDate: string; toDate: string; timeZone: string;
  coverage: UsageReport['coverage']; models: string[]; points: UsageTrendPoint[];
}
const empty = (): UsageTrendValue => ({ tokens: 0, costUsd: 0, knownCostUsd: 0, unpricedTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 });
function keyFor(date: string, hour: number, grain: TrendGranularity): string {
  if (grain === 'hourly') return `${date}T${String(hour).padStart(2, '0')}`;
  if (grain === 'monthly') return date.slice(0, 7);
  if (grain === 'weekly') return addLocalDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
  return date;
}
function add(value: UsageTrendValue, row: QueueBucket) {
  const cost = explainRowCost(row);
  value.tokens += cost.tokens; value.knownCostUsd += cost.costUsd ?? 0; value.unpricedTokens += cost.unpricedTokens;
  value.inputTokens += row.input_tokens ?? 0; value.outputTokens += row.output_tokens ?? 0;
  value.cacheReadTokens += row.cached_input_tokens ?? 0; value.cacheWriteTokens += row.cache_creation_input_tokens ?? 0;
  value.reasoningTokens += row.reasoning_output_tokens ?? 0;
}
const finish = (v: UsageTrendValue) => { v.knownCostUsd = roundCostUsd(v.knownCostUsd); v.costUsd = v.unpricedTokens ? null : v.knownCostUsd; };

/** Accurate time × model projection. Its dimensions never infer costs from token shares. */
export function aggregateUsageTrend(rows: readonly QueueBucket[], query: UsageReportQuery & { granularity?: TrendGranularity }, context: UsageReportContext): UsageTrend {
  const granularity = query.granularity ?? 'daily';
  if (!['hourly', 'daily', 'weekly', 'monthly'].includes(granularity)) throw new Error('INVALID_GRANULARITY');
  const report = buildUsageReport(rows, { ...query, period: 'summary' }, context);
  const { fromDate, toDate } = report.coverage;
  // A bounded chart payload even when the CLI report allows a much wider range.
  if ((Date.parse(`${toDate}T00:00Z`) - Date.parse(`${fromDate}T00:00Z`)) / 86400000 > 366) throw new Error('TREND_RANGE_TOO_LARGE');
  const today = localDateAndHour(context.now ?? new Date());
  const points = new Map<string, UsageTrendPoint>();
  for (let date = fromDate; date <= toDate; date = addLocalDays(date, 1)) {
    const lastHour = granularity === 'hourly' ? date === today.date ? today.hour : 23 : 0;
    for (let hour = 0; hour <= lastHour; hour++) {
      const key = keyFor(date, hour, granularity);
      const previous = points.get(key);
      if (previous) previous.toDate = date;
      else points.set(key, { ...empty(), key, fromDate: date, toDate: date, models: Object.create(null) });
    }
  }
  const modelTotals = new Map<string, number>();
  for (const row of rows) {
    if (!row || !Number.isFinite(Date.parse(row.hour_start)) || ![row.input_tokens, row.output_tokens, row.cached_input_tokens, row.cache_creation_input_tokens, row.reasoning_output_tokens ?? 0].every(n => Number.isFinite(n) && n >= 0)) continue;
    const { date, hour } = localDateAndHour(row.hour_start);
    if (date < fromDate || date > toDate || (report.filters.sources.length && !report.filters.sources.includes(row.source))
      || (report.filters.model && row.model !== report.filters.model) || (report.filters.project && normalizeProjectName(row.project) !== report.filters.project)) continue;
    const point = points.get(keyFor(date, hour, granularity));
    if (!point) continue;
    const model = point.models[row.model] ??= empty();
    add(point, row); add(model, row);
    modelTotals.set(row.model, (modelTotals.get(row.model) ?? 0) + (explainRowCost(row).costUsd ?? 0));
  }
  for (const point of points.values()) { finish(point); Object.values(point.models).forEach(finish); }
  return { granularity, fromDate: report.fromDate, toDate: report.toDate, timeZone: report.timeZone, coverage: report.coverage,
    models: [...modelTotals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([model]) => model), points: [...points.values()] };
}
