import type { UsageReport } from './usage-report.js';

export interface UsageInsight {
  kind: 'project-growth' | 'project-new' | 'daily-spike' | 'model-shift' | 'source-share';
  tokens: number;
  percent?: number;
  project?: string;
  model?: string;
  source?: string;
  date?: string;
}
export interface UsageInsights {
  comparison: { fromTime: string; toTime: string } | null;
  findings: UsageInsight[];
}

/** Observed-token comparisons only: no price changes or unpriced amounts masquerade as growth. */
export function explainUsage(current: UsageReport, previous: UsageReport | null): UsageInsights {
  const result: UsageInsights = { comparison: previous?.fromTime && previous.toTime ? { fromTime: previous.fromTime, toTime: previous.toTime } : null, findings: [] };
  const total = current.summary.tokens, parts = current.breakdowns;
  if (!parts || total === 0) return result;
  const before = previous?.summary.tokens ?? 0;
  if (previous?.breakdowns && before > 0) {
    const projects = new Map(previous.breakdowns.projects.map(row => [row.key, row.tokens]));
    const growth = total - before;
    const contributors = parts.projects.map(row => ({ row, delta: row.tokens - (projects.get(row.key) ?? 0) })).sort((a, b) => b.delta - a.delta);
    const leader = contributors[0];
    if (growth >= 100000 && growth / before >= 0.25 && leader && leader.delta / growth >= 0.4) result.findings.push({ kind: 'project-growth', project: leader.row.project, tokens: leader.delta, percent: growth / before * 100 });
    const fresh = parts.projects.find(row => !projects.has(row.key) && row.tokens >= 100000 && row.tokens / total >= 0.3 && row.project !== leader?.row.project);
    if (fresh) result.findings.push({ kind: 'project-new', project: fresh.project, tokens: fresh.tokens, percent: fresh.tokens / total * 100 });
    const models = new Map(previous.breakdowns.models.map(row => [row.key, row.tokens / before]));
    const shift = parts.models.map(row => ({ row, change: row.tokens / total - (models.get(row.key) ?? 0) })).sort((a, b) => b.change - a.change)[0];
    if (total >= 100000 && shift && shift.change >= 0.2) result.findings.push({ kind: 'model-shift', model: shift.row.model, source: shift.row.source, tokens: shift.row.tokens, percent: shift.change * 100 });
  }
  const days = parts.daily.filter(row => row.tokens > 0).sort((a, b) => a.tokens - b.tokens);
  const median = days[Math.floor(days.length / 2)]?.tokens, peak = days[days.length - 1];
  if (days.length >= 3 && peak && median && peak.tokens >= 100000 && peak.tokens >= median * 3) result.findings.unshift({ kind: 'daily-spike', date: peak.fromDate, tokens: peak.tokens, percent: peak.tokens / total * 100 });
  if (result.findings.length < 3 && !current.filters.sources.length) {
    const sources = new Map<string, number>();
    for (const model of parts.models) if (model.source) sources.set(model.source, (sources.get(model.source) ?? 0) + model.tokens);
    const leading = [...sources].sort((a, b) => b[1] - a[1])[0];
    if (sources.size > 1 && leading && leading[1] / total >= 0.6) result.findings.push({ kind: 'source-share', source: leading[0], tokens: leading[1], percent: leading[1] / total * 100 });
  }
  result.findings = result.findings.slice(0, 3);
  return result;
}
