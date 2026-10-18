import type {
  DailyUsageRow,
  ModelBreakdownRow,
  SourceUsageRow,
  UsageSummary,
} from './api';
import { localDateDaysAgo, localDateNow } from './stats-timezone';
import type { LocalUsageMetrics } from 'quotern-core/local-metrics';
import { mergeCompleteLocalMetrics } from './local-metric-details.ts';
import { i18n, normalizeLocale, translate, type SupportedLocale } from 'quotern-i18n';

export type TimeRangeKey = 'week' | 'month' | 'all';

export const TIME_RANGE_OPTIONS: {
  key: TimeRangeKey;
  label: string;
  days: number;
}[] = [
  { key: 'week', get label() { return translate(normalizeLocale(i18n.resolvedLanguage), 'desktop.timeRange.week'); }, days: 7 },
  { key: 'month', get label() { return translate(normalizeLocale(i18n.resolvedLanguage), 'desktop.timeRange.month'); }, days: 30 },
  { key: 'all', get label() { return translate(normalizeLocale(i18n.resolvedLanguage), 'desktop.timeRange.all'); }, days: 365 },
];

export function daysForRange(key: TimeRangeKey): number {
  return TIME_RANGE_OPTIONS.find((o) => o.key === key)?.days ?? 30;
}

/** Asia/Shanghai YYYY-MM-DD for today and (today - days + 1). */
export function rangeDateBounds(days: number, now = new Date()): {
  start: string;
  end: string;
} {
  return {
    start: localDateDaysAgo(days, undefined, now),
    end: localDateNow(undefined, now),
  };
}

/**
 * Display label for the active query window.
 * For the all-time option, clamp start to statsSince when it falls inside the window.
 */
export function formatRangeLabel(
  key: TimeRangeKey,
  statsSince: string | null | undefined,
  now = new Date(),
  locale: SupportedLocale = normalizeLocale(i18n.resolvedLanguage),
): string {
  const days = daysForRange(key);
  const { start, end } = rangeDateBounds(days, now);
  let from = start;
  if (key === 'all' && statsSince) {
    const sinceDay = statsSince.slice(0, 10);
    if (sinceDay > from) from = sinceDay;
  }
  return `${formatCalendarDate(from, locale)} ~ ${formatCalendarDate(end, locale)}`;
}

function formatCalendarDate(isoDay: string, locale: SupportedLocale): string {
  const [year, month, day] = isoDay.split('-').map(Number);
  if (!year || !month || !day) return isoDay;
  // The API day is already defined in Asia/Shanghai. UTC here only prevents
  // presentation from shifting that calendar day in a different local zone.
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

/** Build Agent / overview summary scoped to the fetched model breakdown. */
export function buildSummaryFromRange(
  dailyRows: DailyUsageRow[],
  modelRows: ModelBreakdownRow[],
  statsSince: string,
  todayFallback?: { tokens: number; costUsd: number },
): UsageSummary {
  const totalTokens = dailyRows.reduce((s, d) => s + d.tokens, 0);
  const totalCostUsd = dailyRows.reduce((s, d) => s + d.costUsd, 0);

  const today = localDateNow();
  const todayRow = dailyRows.find((d) => d.date === today);
  const todayTokens = todayRow?.tokens ?? todayFallback?.tokens ?? 0;
  const todayCostUsd = todayRow?.costUsd ?? todayFallback?.costUsd ?? 0;

  const bySource = buildBySourceFromModels(modelRows, totalTokens);

  return {
    totalTokens,
    totalCostUsd: Math.round(totalCostUsd * 1e8) / 1e8,
    todayTokens,
    todayCostUsd: Math.round(todayCostUsd * 1e8) / 1e8,
    statsSince,
    bySource,
  };
}

function buildBySourceFromModels(
  modelRows: ModelBreakdownRow[],
  totalTokens: number,
): SourceUsageRow[] {
  type Acc = {
    tokens: number;
    costUsd: number;
    metricParts: (LocalUsageMetrics | undefined)[];
    models: Map<string, {
      tokens: number;
      costUsd: number;
      metricParts: (LocalUsageMetrics | undefined)[];
    }>;
  };
  const map = new Map<string, Acc>();

  for (const row of modelRows) {
    if (row.tokens <= 0) continue;
    let src = map.get(row.source);
    if (!src) {
      src = { tokens: 0, costUsd: 0, metricParts: [], models: new Map() };
      map.set(row.source, src);
    }
    src.tokens += row.tokens;
    src.costUsd += row.costUsd;
    src.metricParts.push(row.localMetrics);
    const m = src.models.get(row.model) ?? { tokens: 0, costUsd: 0, metricParts: [] };
    m.tokens += row.tokens;
    m.costUsd += row.costUsd;
    m.metricParts.push(row.localMetrics);
    src.models.set(row.model, m);
  }

  const grand =
    totalTokens > 0
      ? totalTokens
      : [...map.values()].reduce((s, v) => s + v.tokens, 0);

  return Array.from(map.entries())
    .map(([source, v]) => ({
      source,
      localMetrics: mergeCompleteLocalMetrics(v.metricParts),
      tokens: v.tokens,
      costUsd: Math.round(v.costUsd * 1e8) / 1e8,
      pct: grand > 0 ? Math.round((v.tokens / grand) * 1000) / 10 : 0,
      models: Array.from(v.models.entries())
        .map(([model, m]) => ({
          model,
          localMetrics: mergeCompleteLocalMetrics(m.metricParts),
          tokens: m.tokens,
          costUsd: Math.round(m.costUsd * 1e8) / 1e8,
          pct: v.tokens > 0 ? Math.round((m.tokens / v.tokens) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.tokens - a.tokens),
    }))
    .sort((a, b) => b.tokens - a.tokens);
}
