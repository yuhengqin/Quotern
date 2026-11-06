import { Link } from '@tanstack/react-router';
import { useTranslation } from 'quotern-i18n/react';
import type { SessionActivity } from 'quotern-core';
import { HelpPopover } from './HelpPopover';
import { formatSessionTokens } from '@/lib/session-metric-format';
import type { DetailFormat } from './SessionUsageBreakdown';
import { sourceLabel } from '@/lib/tokens';
import { createSessionDetailSearch } from '../lib/session-page';
import type { DetailRange } from '../lib/session-detail';
import { DEFAULT_STATS_TIMEZONE } from '../lib/stats-timezone';

export function SessionDiagnosticsSection({ row, range, format }: { row: SessionActivity; range?: DetailRange; format: DetailFormat }) {
  const { t, i18n } = useTranslation();
  const diagnostics = row.insights?.diagnostics;
  const dispatches = row.insights?.dispatches ?? [];
  return <>
    {!!diagnostics?.findings.length && <section className="space-y-3 border-t border-separator pt-4" aria-label={t('usage.diagnostics.title')}>
      <div className="flex items-center gap-1"><h3 className="font-semibold">{t('usage.diagnostics.title')}</h3><HelpPopover title={t('usage.diagnostics.title')}><p>{t('usage.diagnostics.note')}</p>{diagnostics.coverage !== 'complete' && <p>{t('usage.detail.partialCoverage')}</p>}</HelpPopover></div>
      <ul className="divide-y divide-separator">{diagnostics.findings.map(finding => <li key={finding.code} className="space-y-1 py-3 first:pt-0">
        <p className="text-sm font-medium">{t(`usage.diagnostics.${finding.code}`)}</p>
        <p className="text-xs text-muted">{t(`usage.diagnostics.${finding.code}.advice`)}</p>
        {!!finding.evidence.length && <details className="text-xs"><summary className="min-h-7 cursor-pointer rounded py-1 text-accent outline-offset-2 focus-visible:outline-2">{t('usage.diagnostics.evidence', { count: finding.count })}</summary>
          <ul className="space-y-1 py-2 font-mono">{finding.evidence.map(evidence => <li key={evidence.eventId} className="break-words [overflow-wrap:anywhere]">{new Date(evidence.timestamp).toLocaleString(i18n.language, { timeZone: DEFAULT_STATS_TIMEZONE, hour12: false })} · {evidence.tool}{evidence.target && ` · ${evidence.target}`}{evidence.characters !== undefined && ` · ${evidence.characters.toLocaleString(i18n.language)} chars`}</li>)}</ul>
          {finding.estimatedTokens !== undefined && <p className="text-muted">{t('usage.diagnostics.estimate', { tokens: formatSessionTokens(finding.estimatedTokens) })}</p>}
        </details>}
      </li>)}</ul>
    </section>}
    {!!dispatches.length && <section className="space-y-3 border-t border-separator pt-4" aria-label={t('usage.dispatch.title')}>
      <div className="flex items-center gap-1"><h3 className="font-semibold">{t('usage.dispatch.title')}</h3><HelpPopover title={t('usage.dispatch.title')}><p>{t('usage.dispatch.note')}</p></HelpPopover></div>
      <ul className="divide-y divide-separator">{dispatches.map(link => <li key={`${link.source}:${link.sessionId}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-xs">
        <div className="min-w-0 space-y-1"><Link to="/sessions" search={createSessionDetailSearch(link, range)} target="_blank" rel="noopener noreferrer" className="inline-block min-h-7 break-words rounded py-1 text-accent underline underline-offset-2 outline-offset-2 focus-visible:outline-2">{link.sessionTitle || sourceLabel(link.source)}</Link><p className="text-muted">{sourceLabel(link.source)} · {t(`usage.dispatch.${link.evidence}`)}</p></div>
        <span className="tabular-nums">{formatSessionTokens(link.tokens)} Token · {format.money(link.costUsd, link.knownCostUsd)}{link.costUsd === null && link.knownCostUsd > 0 && <span className="block text-muted">{t('usage.explorer.partial')}</span>}</span>
      </li>)}</ul>
    </section>}
  </>;
}
