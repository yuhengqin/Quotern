import type { QuotaAnalysis, QuotaProviderState, QuotaWindow } from '../../shared/quota';

export function isQuotaStatusOnly(provider: Pick<QuotaProviderState, 'windows' | 'details' | 'resetCredits'>): boolean {
  return provider.windows.length === 0 && provider.details.length === 0 && provider.resetCredits === null;
}

/** Nominal month length is used only for presentation order, never for analysis. */
function periodOrder(window: QuotaWindow): number | null {
  if (window.timeKind === 'expiry' || window.analysisEligible === false) return null;
  const label = window.label.trim();
  const period = /^(\d+(?:\.\d+)?)\s*([hd])$/i.exec(label);
  if (period) return Number(period[1]) * (period[2].toLowerCase() === 'h' ? 3600 : 86400);
  if (/^(月限额|月度额度|月度共享额度)$/.test(label) || /^(monthly|limit_month_total)$/.test(window.id)) return 31 * 86400;
  if (/^(周限额|周额度)$/.test(label) || /^(weekly|seven-day|limit_7d)$/.test(window.id)) return 7 * 86400;
  if (/^(日限额|每日额度)$/.test(label) || window.id === 'daily') return 86400;
  const hours = /^(\d+(?:\.\d+)?)\s*小时(?:限额|额度)$/.exec(label);
  if (hours) return Number(hours[1]) * 3600;
  return /^(five-hour|five_hour|limit_5h)$/.test(window.id) ? 18000 : null;
}

export function sortQuotaWindows(windows: QuotaWindow[]): QuotaWindow[] {
  const sorted = windows.filter(window => periodOrder(window) !== null)
    .sort((a, b) => periodOrder(b)! - periodOrder(a)!);
  let index = 0;
  return windows.map(window => periodOrder(window) === null ? window : sorted[index++]);
}

function quotaScope(providerId: string, window: QuotaWindow): string {
  if (window.timeKind === 'expiry') return window.id;
  if (providerId === 'codex' && window.id.startsWith('feature:')) return window.id.slice(0, window.id.lastIndexOf(':'));
  if (window.groupLabel || window.id.startsWith('model:')) return window.id;
  if (providerId === 'grok' && ['session', 'daily', 'weekly', 'monthly', 'billing'].includes(window.id)) return 'account';
  if (periodOrder(window) !== null && ['codex', 'claude', 'kimi', 'grok', 'zcode', 'minimax', 'opencode'].includes(providerId)) return 'account';
  return window.id;
}

export function quotaTrendWindows(providerId: string, windows: QuotaWindow[]): Set<string> {
  const eligible = windows.filter(window => window.analysisEligible !== false);
  const length = (window: QuotaWindow) => Number.isFinite(window.durationSeconds) && window.durationSeconds! > 0
    ? window.durationSeconds! : periodOrder(window) ?? Number.POSITIVE_INFINITY;
  const shortest = new Map<string, number>();
  for (const window of eligible) {
    const scope = quotaScope(providerId, window);
    shortest.set(scope, Math.min(shortest.get(scope) ?? Number.POSITIVE_INFINITY, length(window)));
  }
  // Select before checking samples: missing short-cycle history must not fall
  // back to a longer cycle. Unknown independent pools keep their own trend.
  return new Set(eligible.filter(window => length(window) === shortest.get(quotaScope(providerId, window))).map(window => window.id));
}

/** Keep the first forecast that can occur before a related reset or limit blocks use. */
export function quotaForecasts(providerId: string, windows: QuotaWindow[], analyses: Record<string, QuotaAnalysis>, now: number): Map<string, number> {
  const eligible = windows.filter(window => window.analysisEligible !== false);
  const firstByScope = new Map<string, { id: string; at: number }>();
  for (const window of eligible) {
    const at = analyses[window.id]?.etaAt;
    if (!at || !Number.isFinite(at) || at <= now || window.usedPercent >= 100 || !window.resetsAt || at >= window.resetsAt) continue;
    const scope = quotaScope(providerId, window);
    const order = periodOrder(window) ?? (providerId === 'grok' && window.id === 'billing' ? Number.POSITIVE_INFINITY : null);
    const blocked = eligible.some(other => quotaScope(providerId, other) === scope && (
      other.usedPercent >= 100 || (other.resetsAt !== null && other.resetsAt <= at)
      || (other.resetsAt === null && periodOrder(other) !== null && order !== null && periodOrder(other)! < order)
    ));
    if (blocked) continue;
    const current = firstByScope.get(scope);
    if (!current || at < current.at) firstByScope.set(scope, { id: window.id, at });
  }
  return new Map([...firstByScope.values()].map(value => [value.id, value.at]));
}

export function quotaWindowLabel(providerId: string, window: QuotaWindow): string {
  const labels: Record<string, string> = { '月度额度': '月限额', '月度共享额度': '月限额', '每日额度': '日限额', 'Opus 周限额': 'Opus 模型周限额' };
  const cursor: Record<string, string> = { Cursor: 'Cursor模型额度', 'Cursor Models': 'Cursor模型额度', Other: '其他模型额度', 'Other Models': '其他模型额度' };
  const period = /^(\d+(?:\.\d+)?)\s*([hd])$/i.exec(window.label);
  const label = providerId === 'cursor' && cursor[window.label] ? cursor[window.label]
    : period ? period[1] === '7' && period[2].toLowerCase() === 'd' ? '周限额'
      : period[1] === '1' && period[2].toLowerCase() === 'd' ? '日限额'
        : `${period[1]} ${period[2].toLowerCase() === 'h' ? '小时' : '天'}限额`
      : labels[window.label] ?? window.label.replace(/^(\d+(?:\.\d+)?)\s*小时额度$/, '$1 小时限额');
  return /^opus$/i.test(window.groupLabel ?? '') ? `Opus 模型${label}` : [window.groupLabel, label].filter(Boolean).join(' ');
}

export function quotaDisplayDetails(providerId: string, details: QuotaProviderState['details']): QuotaProviderState['details'] {
  if (providerId !== 'copilot') return details;
  const chat = details.find(detail => detail.id === 'chat');
  const completions = details.find(detail => detail.id === 'completions');
  const merge = chat?.text === '无限' && completions?.text === '无限';
  return details.flatMap(detail => {
    if (merge && detail.id === 'completions') return [];
    if (merge && detail.id === 'chat') return [{ id: 'chat-completions', label: '聊天与代码补全', text: '无限', resetsAt: null }];
    return [{ ...detail, label: detail.id === 'completions' ? '代码补全' : detail.id === 'chat' && detail.label === 'Chat' ? '聊天' : detail.label }];
  });
}

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
