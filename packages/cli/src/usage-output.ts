import type { UsageReport } from 'quotern-core';

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

function money(value: number): string {
  return `$${value.toFixed(6)}`;
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

function formatText(report: UsageReport): string {
  const display = displayCoverage(report);
  const lines = [
    `Quotern usage · ${cleanText(report.period)}`,
    `${cleanText(report.fromDate)} – ${cleanText(report.toDate)} · ${cleanText(report.timeZone)}`,
    ...report.rows.map((row) => {
      const cost = row.costUsd === null
        ? `未知（已知 ${money(row.knownCostUsd)}）`
        : money(row.costUsd);
      return [row.label, row.source ?? '', row.tokens, cost].map(cleanText).join('\t');
    }),
    '',
    `来源报告费用\t${money(report.summary.costExplanation.reportedCostUsd)}`,
    `按费率估算费用\t${money(report.summary.costExplanation.estimatedCostUsd)}`,
    `未定价 tokens\t${report.summary.costExplanation.unpricedTokens}`,
    `默认费率 tokens\t${report.summary.costExplanation.defaultPricedTokens}`,
    ...(['recorded', 'estimated', 'ledger', 'mixed', 'unknown'] as const).map(
      (quality) => `${quality} tokens\t${report.summary.costExplanation.tokenQualityTokens[quality]}`,
    ),
    `覆盖起点\t${cleanText(display.collectSince ?? '未知')} · limited=${report.coverage.limited}`,
    `最近同步完成\t${cleanText(display.lastSyncAt ?? '未知')}`,
    `报告读取时间\t${cleanText(display.readAt ?? '未知')}`,
    `快照\t${cleanText(report.coverage.snapshot)}${report.coverage.snapshot === 'persisted' ? '（读取时已落盘快照）' : ''}`,
    '提示\t最近同步完成时间不代表所有来源的数据均已更新至此时。',
    '提示\t费用信息包含来源报告与费率估算，不是实际账单。',
  ];
  return lines.join('\n');
}

export function formatUsageReport(
  report: UsageReport,
  format: 'text' | 'json' | 'csv',
  options: { compact?: boolean } = {},
): string {
  if (format === 'json') return options.compact ? JSON.stringify(compactReport(report)) : JSON.stringify(report, null, 2);
  if (format === 'csv') return formatCsv(report);
  return formatText(report);
}
