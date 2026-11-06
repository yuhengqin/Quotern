import { Link } from '@tanstack/react-router';
import { useTranslation } from 'quotern-i18n/react';
import type { UsageReport } from 'quotern-core';
import { HelpPopover } from './HelpPopover';
import { formatSessionTokens } from '@/lib/session-metric-format';
import { sourceLabel } from '@/lib/tokens';
import { parseSessionPageSearch } from '../lib/session-page';
import { DEFAULT_STATS_TIMEZONE } from '../lib/stats-timezone';

export function UsageInsightsPanel({ report }: { report: UsageReport | null | undefined }) {
  const { t, i18n } = useTranslation();
  if (!report?.insights?.findings.length) return null;
  const comparison = report.insights.comparison;
  const date = (stamp: string) => new Date(stamp).toLocaleString(i18n.language, { timeZone: DEFAULT_STATS_TIMEZONE, hour12: false });
  return <section className="mt-4 rounded-xl border border-separator bg-surface px-4 py-3" aria-label={t('usage.findings.title')}>
    <div className="mb-1 flex items-center gap-1"><h2 className="text-sm font-medium">{t('usage.findings.title')}</h2><HelpPopover title={t('usage.findings.title')}><p>{t('usage.findings.note')}</p>{comparison && <p>{t('usage.findings.comparison')}: {date(comparison.fromTime)} – {date(comparison.toTime)}</p>}</HelpPopover></div>
    <ul className="divide-y divide-separator">{report.insights.findings.map((finding, index) => {
      const targetDate = finding.date;
      const fromTime = report.fromTime && targetDate ? new Date(Math.max(Date.parse(report.fromTime), Date.parse(`${targetDate}T00:00:00+08:00`))).toISOString() : report.fromTime;
      const toTime = report.toTime && targetDate ? new Date(Math.min(Date.parse(report.toTime), Date.parse(`${targetDate}T00:00:00+08:00`) + 86400000)).toISOString() : report.toTime;
      const search = parseSessionPageSearch({ start: targetDate ?? report.fromDate, end: targetDate ?? report.toDate, fromTime, toTime,
        scopeSources: report.filters.sources, sources: finding.source ? [finding.source] : [], project: finding.project ?? report.filters.project ?? '', model: finding.model ?? report.filters.model ?? '', sort: 'tokens', direction: 'descending' });
      return <li key={`${finding.kind}:${index}`} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-xs">
        <p className="min-w-0 break-words [overflow-wrap:anywhere]">{t(`usage.findings.${finding.kind}`, { ...finding, tokens: formatSessionTokens(finding.tokens), source: finding.source ? sourceLabel(finding.source) : '', percent: finding.percent?.toLocaleString(i18n.language, { maximumFractionDigits: 1 }) })}</p>
        <Link to="/sessions" search={search} className="shrink-0 rounded py-1 text-accent underline underline-offset-2 outline-offset-2 focus-visible:outline-2">{t('usage.findings.view')}</Link>
      </li>;
    })}</ul>
  </section>;
}
