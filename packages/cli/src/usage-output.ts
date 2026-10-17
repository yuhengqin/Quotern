import type { UsageReport } from 'quotern-core';
import type { SupportedLocale } from 'quotern-i18n';
import { cliT, systemCliLocale } from './i18n/locale.js';

const CSV_HEADERS = [
  'period',
  'label',
  'source',
  'model',
  'project',
  'from_date',
  'to_date',
  'tokens',
  'cost_usd',
  'known_cost_usd',
  'unpriced_tokens',
  'default_priced_tokens',
  'request_count',
  'cache_reuse_rate',
  'collect_since',
  'coverage_limited',
  'last_sync_at',
  'snapshot',
  'time_zone',
] as const;

function csvCell(value: unknown, protectFormula = false): string {
  if (value == null) return '';

  let text = String(value);
  if (protectFormula && /^[=+\-@\t]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function formatCsv(report: UsageReport): string {
  const header = CSV_HEADERS.join(',');
  const lines = report.rows.map((row) => {
    const values: unknown[] = [
      report.period,
      row.label,
      row.source,
      row.model,
      row.project,
      row.fromDate ?? report.fromDate,
      row.toDate ?? report.toDate,
      row.tokens,
      row.costUsd,
      row.knownCostUsd,
      row.costExplanation.unpricedTokens,
      row.costExplanation.defaultPricedTokens,
      row.localMetrics.requestCount,
      row.localMetrics.cacheHitRate,
      report.coverage.collectSince,
      report.coverage.limited,
      report.coverage.lastSyncAt,
      report.coverage.snapshot,
      report.timeZone,
    ];
    return values.map((value, index) => csvCell(value, index >= 1 && index <= 4)).join(',');
  });

  return [header, ...lines].join('\r\n');
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
}

function money(value: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 6, maximumFractionDigits: 6,
  }).format(value);
}

function displayTextDate(value: string, locale: SupportedLocale): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) return value;
  if (locale === 'zh-CN') {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
  }).format(date);
}

function displayTextTimestamp(value: string | null, timeZone: string, locale: SupportedLocale): string | null {
  if (value === null || !Number.isFinite(Date.parse(value))) return null;
  if (locale === 'zh-CN') {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone, numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(value));
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')} (${timeZone})`;
  }
  return `${new Intl.DateTimeFormat(locale, {
    timeZone, year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date(value))} (${timeZone})`;
}

function displayTimestamp(value: string | null, timeZone: string): string | null {
  if (value === null || !Number.isFinite(Date.parse(value))) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, calendar: 'iso8601', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')} (${timeZone})`;
}

function displayCoverage(report: UsageReport) {
  return {
    collectSince: displayTimestamp(report.coverage.collectSince, report.timeZone),
    lastSyncAt: displayTimestamp(report.coverage.lastSyncAt, report.timeZone),
    readAt: displayTimestamp(report.coverage.readAt, report.timeZone),
  };
}

function compactCost(explanation: UsageReport['summary']['costExplanation']) {
  const { reportedCostUsd, estimatedCostUsd, unpricedTokens, defaultPricedTokens, tokenQualityTokens } = explanation;
  return { reportedCostUsd, estimatedCostUsd, unpricedTokens, defaultPricedTokens, tokenQualityTokens };
}

/** Presentation only: Core still owns all aggregation, grouping and quality semantics. */
function compactReport(report: UsageReport) {
  const { costExplanation, ...summary } = report.summary;
  return {
    schemaVersion: report.schemaVersion,
    view: 'compact',
    period: report.period,
    timeZone: report.timeZone,
    fromDate: report.fromDate,
    toDate: report.toDate,
    filters: report.filters,
    coverage: { ...report.coverage, display: displayCoverage(report) },
    summary: { ...summary, costExplanation: compactCost(costExplanation) },
    rows: report.rows.map((row) => ({
      label: row.label, source: row.source, model: row.model, project: row.project,
      fromDate: row.fromDate, toDate: row.toDate,
      tokens: row.tokens, costUsd: row.costUsd, knownCostUsd: row.knownCostUsd,
      costExplanation: compactCost(row.costExplanation),
    })),
  };
}

function formatText(report: UsageReport, locale: SupportedLocale): string {
  const display = {
    collectSince: displayTextTimestamp(report.coverage.collectSince, report.timeZone, locale),
    lastSyncAt: displayTextTimestamp(report.coverage.lastSyncAt, report.timeZone, locale),
    readAt: displayTextTimestamp(report.coverage.readAt, report.timeZone, locale),
  };
  const label = (key: string) => cliT(locale, `report.${key}`);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const unknown = label('unknown');
  const lines = [
    cliT(locale, 'report.title', { period: label(`period.${report.period}`) }),
    `${cleanText(displayTextDate(report.fromDate, locale))} – ${cleanText(displayTextDate(report.toDate, locale))} · ${cleanText(report.timeZone)}`,
    ...report.rows.map((row) => {
      const cost = row.costUsd === null
        ? cliT(locale, 'report.unknownCost', { known: money(row.knownCostUsd, locale) })
        : money(row.costUsd, locale);
      return [row.label, row.source ?? '', number(row.tokens), cost].map(cleanText).join('\t');
    }),
    '',
    `${label('reportedCost')}\t${money(report.summary.costExplanation.reportedCostUsd, locale)}`,
    `${label('estimatedCost')}\t${money(report.summary.costExplanation.estimatedCostUsd, locale)}`,
    `${label('unpricedTokens')}\t${number(report.summary.costExplanation.unpricedTokens)}`,
    `${label('defaultPricedTokens')}\t${number(report.summary.costExplanation.defaultPricedTokens)}`,
    ...(['recorded', 'estimated', 'ledger', 'mixed', 'unknown'] as const).map(
      (quality) => `${label(`quality.${quality}`)} tokens\t${number(report.summary.costExplanation.tokenQualityTokens[quality])}`,
    ),
    `${label('coverage')}\t${cleanText(display.collectSince ?? unknown)} · ${label(report.coverage.limited ? 'limited' : 'complete')}`,
    `${label('lastSync')}\t${cleanText(display.lastSyncAt ?? unknown)}`,
    `${label('readAt')}\t${cleanText(display.readAt ?? unknown)}`,
    `${label('snapshot')}\t${label(report.coverage.snapshot === 'persisted' ? 'snapshotPersisted' : 'snapshotRuntime')}`,
    `${label('tip')}\t${label('syncCaveat')}`,
    `${label('tip')}\t${label('costCaveat')}`,
  ];
  return lines.join('\n');
}

export function formatUsageReport(
  report: UsageReport,
  format: 'text' | 'json' | 'csv',
  options: { compact?: boolean; locale?: SupportedLocale } = {},
): string {
  if (format === 'json') return options.compact ? JSON.stringify(compactReport(report)) : JSON.stringify(report, null, 2);
  if (format === 'csv') return formatCsv(report);
  return formatText(report, options.locale ?? systemCliLocale());
}
