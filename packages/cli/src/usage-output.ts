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

function formatText(report: UsageReport): string {
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
    `覆盖起点\t${cleanText(report.coverage.collectSince)} · limited=${report.coverage.limited}`,
    `最近同步\t${cleanText(report.coverage.lastSyncAt ?? '未知')}`,
    `快照\t${cleanText(report.coverage.snapshot)}${report.coverage.snapshot === 'persisted' ? '（读取时已落盘快照）' : ''}`,
    '提示\t费用信息包含来源报告与费率估算，不是实际账单。',
  ];
  return lines.join('\n');
}

export function formatUsageReport(
  report: UsageReport,
  format: 'text' | 'json' | 'csv',
): string {
  if (format === 'json') return JSON.stringify(report, null, 2);
  if (format === 'csv') return formatCsv(report);
  return formatText(report);
}
