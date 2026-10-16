import type { QuotaAnalysis, QuotaWindow } from '../../shared/quota';

export function commonQuotaResetAt(windows: QuotaWindow[]): number | null {
  if (windows.length < 2) return null;
  const at = windows[0].resetsAt;
  return at !== null && Number.isFinite(at) && at > 0
    && windows.every(window => window.timeKind !== 'expiry' && window.resetsAt === at) ? at : null;
}

export function quotaPaceLabel(analysis: QuotaAnalysis): string | null {
  const pace = analysis.paceDifference;
  return pace === null ? null : pace === 0 ? '节奏正常' : pace > 0 ? '使用较慢' : '使用偏快';
}

export function quotaPaceDescription(window: QuotaWindow, analysis: QuotaAnalysis): string | null {
  if (analysis.paceDifference === null) return null;
  const basis = analysis.paceBasis === 'workdays' ? '工作日安排' : analysis.paceBasis === 'automatic' ? '历史使用习惯' : '当前周期进度';
  const expected = Math.max(0, Math.min(100, Math.round(window.usedPercent + analysis.paceDifference)));
  return `当前已用 ${Math.round(window.usedPercent)}%，按${basis}预计使用 ${expected}%。`;
}
