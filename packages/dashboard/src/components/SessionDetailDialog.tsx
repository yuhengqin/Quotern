import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button, Modal, Popover, ToggleButton, ToggleButtonGroup, Tooltip } from '@heroui/react';
import { ChevronRight, Copy, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import type { SupportedLocale } from 'quotern-i18n';
import type { SessionActivity } from 'quotern-core';
import { request } from '@/lib/api';
import { formatSessionDuration, formatSessionTokens, formatSessionUsd } from '@/lib/session-metric-format';
import { sourceLabel } from '@/lib/tokens';
import { DEFAULT_STATS_TIMEZONE, getStatsTimezoneLabel } from '../lib/stats-timezone';
import { accountLabel, costLabel, modeLabel, serviceLabel } from '../lib/session-labels';
import { parseSessionPageSearch } from '../lib/session-page';
import { buildSessionDetail, formatExactSessionNumber, sessionDetailExport, type DetailRange, type DetailScope } from '../lib/session-detail';
import { ProviderIcon } from './ProviderIcon';
import { FilterMenuPopover } from './FilterMenu';
import { DetailDisclosure, DetailValue, SessionModelBreakdown, SessionTokenBreakdown, type DetailFormat } from './SessionUsageBreakdown';

const groupLabels = { own: 'usage.detail.own', subagent: 'usage.insights.subagent', fork: 'usage.detail.forks', unknown: 'usage.detail.otherRelated' } as const;

/** One dedicated dialog, shared by the browser and Desktop renderers. */
export function SessionDetailDialog({ row, range, showTokenShare = false, onClose }: { row: SessionActivity; range?: DetailRange; showTokenShare?: boolean; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  const [scope, setScope] = useState<DetailScope>('thread');
  const [exact, setExact] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [directory, setDirectory] = useState<string | null>(null);
  const [directoryState, setDirectoryState] = useState<'loading' | 'ready' | 'error' | 'unsupported'>('loading');
  const [directoryAttempt, setDirectoryAttempt] = useState(0);
  const detail = useMemo(() => buildSessionDetail(row, scope), [row, scope]);
  const insight = row.insights;

  useEffect(() => {
    let active = true;
    setDirectory(null);
    if (!['codex', 'claude', 'dsh'].includes(row.source)) { setDirectoryState('unsupported'); return; }
    setDirectoryState('loading');
    const query = new URLSearchParams({ source: row.source, sessionId: row.sessionId });
    void request<{ directory: string | null }>(`/functions/tud-session-directory?${query}`).then(result => {
      if (active) { setDirectory(result.directory); setDirectoryState('ready'); }
    }).catch(() => { if (active) setDirectoryState('error'); });
    return () => { active = false; };
  }, [row.source, row.sessionId, directoryAttempt]);

  const copy = async (value: string, label: string) => {
    setMoreOpen(false);
    try { await navigator.clipboard.writeText(value); setFeedback(`${label} · ${t('usage.insights.copied')}`); }
    catch { setFeedback(t('usage.insights.copyFailed')); }
  };
  const format: DetailFormat = {
    tokens: value => exact ? formatExactSessionNumber(value, locale) : formatSessionTokens(value),
    number: value => value == null ? t('usage.insights.unknown') : exact ? formatExactSessionNumber(value, locale) : value.toLocaleString(locale, { maximumFractionDigits: 1 }),
    money: (value, known = 0) => value == null
      ? known > 0 ? exact ? `≥ $${formatExactSessionNumber(known, locale)}` : formatSessionUsd(known, locale, { lowerBound: true }) : t('usage.activity.amountUnknown')
      : exact ? `$${formatExactSessionNumber(value, locale)}` : formatSessionUsd(value, locale),
  };
  const date = (stamp: string | null | undefined) => stamp && Number.isFinite(Date.parse(stamp))
    ? new Date(stamp).toLocaleString(locale, { timeZone: DEFAULT_STATS_TIMEZONE, hour12: false }) : t('usage.insights.unknown');
  const period = range ? range.fromTime && range.toTime ? `${date(range.fromTime)} – ${date(range.toTime)}` : range.fromDate === range.toDate ? range.fromDate : `${range.fromDate} – ${range.toDate}` : t('usage.explorer.range');
  const scopeLabel = t(detail.scope === 'thread' ? 'usage.detail.thread' : 'usage.detail.own');
  const taskDuration = row.taskSeconds != null && exact ? `${formatExactSessionNumber(row.taskSeconds, locale)} s` : formatSessionDuration(row.taskSeconds ?? null);
  const performance = insight?.performance;
  const metrics = insight ? [
    { label: 'usage.insights.messageCount', value: insight.messageCount },
    { label: 'usage.insights.toolCalls', value: insight.signals.toolCalls },
    { label: 'usage.insights.editTurns', value: insight.signals.editTurns },
    { label: 'usage.insights.retryTurns', value: insight.signals.retryTurns },
    { label: 'usage.insights.firstPass', value: insight.signals.firstPass },
    { label: 'usage.insights.errorCount', value: insight.signals.errorCount },
    { label: 'usage.insights.compactionCount', value: insight.signals.compactionCount },
    { label: 'usage.insights.costPerEdit', value: insight.signals.costPerEdit },
    { label: 'usage.insights.tokensPerEdit', value: insight.signals.tokensPerEdit },
  ] : [];
  const available = metrics.filter(metric => metric.value != null), missing = metrics.filter(metric => metric.value == null);
  const activitySummary = [insight?.messageCount != null ? `${t('usage.insights.messageCount')} ${format.number(insight.messageCount)}` : '', insight?.signals.toolCalls != null ? `${t('usage.insights.toolCalls')} ${format.number(insight.signals.toolCalls)}` : ''].filter(Boolean).join(' · ') || t('usage.detail.noActivity');
  const columnClass = 'grid grid-cols-2 items-baseline gap-x-3 gap-y-1 [&>:first-child]:col-span-2 sm:grid-cols-[minmax(0,1fr)_minmax(5rem,auto)_minmax(6rem,auto)] sm:[&>:first-child]:col-span-1';

  return <Modal isOpen onOpenChange={open => { if (!open) onClose(); }}>
    <Modal.Backdrop><Modal.Container scroll="inside" size="lg"><Modal.Dialog className="max-w-3xl text-foreground" style={{ fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif' }}>
      <Modal.CloseTrigger aria-label={t('usage.detail.close')} />
      <Modal.Header className="border-b border-separator pb-3 pr-12">
        <div className="flex min-w-0 items-start gap-3"><span className="mt-1 shrink-0"><ProviderIcon provider={row.source} size={22} /></span><div className="min-w-0">
          <Modal.Heading className="break-words text-lg leading-7">{row.sessionTitle ?? t('usage.insights.detailTitle')}</Modal.Heading>
          <p className="mt-1 break-words text-xs text-muted">{sourceLabel(row.source)} · {row.projectLabel}</p>
        </div></div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {insight?.resumeCommand && <Button size="sm" variant="secondary" onPress={() => void copy(insight.resumeCommand!, t('usage.insights.copyResume'))}><Copy className="size-3.5" aria-hidden />{t('usage.insights.copyResume')}</Button>}
          <Popover isOpen={moreOpen} onOpenChange={setMoreOpen}>
            <Button size="sm" variant="tertiary" aria-label={t('usage.detail.more')}><MoreHorizontal className="size-4" aria-hidden />{t('usage.detail.more')}</Button>
            <FilterMenuPopover placement="bottom start" className="w-56" bodyClassName="flex flex-col gap-1 p-2">
              <Button size="sm" variant="tertiary" className="justify-start" onPress={() => void copy(sessionDetailExport(row, detail.scope, range), t('usage.detail.copyExact'))}>{t('usage.detail.copyExact')}</Button>
              {directory && <Button size="sm" variant="tertiary" className="justify-start" onPress={() => void copy(directory, t('usage.insights.copyDirectory'))}>{t('usage.insights.copyDirectory')}</Button>}
              <Button size="sm" variant="tertiary" className="justify-start" onPress={() => void copy(row.sessionId, t('usage.detail.copyId'))}>{t('usage.detail.copyId')}</Button>
            </FilterMenuPopover>
          </Popover>
          <Button size="sm" variant="tertiary" aria-pressed={exact} onPress={() => { setExact(!exact); setFeedback(''); }}>{t(exact ? 'usage.detail.compact' : 'usage.detail.exact')}</Button>
        </div>
        {feedback && <p role="status" className="mt-1 text-xs">{feedback}</p>}
      </Modal.Header>
      <Modal.Body className="space-y-6 overscroll-contain pt-4 text-sm leading-6 text-foreground">
        <section aria-label={t('usage.detail.summary')} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-xs text-muted"><p>{t(range?.kind === 'collected' ? 'usage.detail.collectedRange' : 'usage.detail.selectedRange')}: <span className="text-foreground">{period}</span></p><p>{getStatsTimezoneLabel()}</p></div>
            {detail.hasDescendants && detail.threadAvailable ? <ToggleButtonGroup size="sm" selectionMode="single" disallowEmptySelection selectedKeys={[detail.scope]} aria-label={t('usage.detail.usageScope')} onSelectionChange={keys => { setScope(keys.has('thread') ? 'thread' : 'own'); setFeedback(''); }}>
              <ToggleButton id="thread">{t('usage.detail.thread')}</ToggleButton><ToggleButton id="own"><ToggleButtonGroup.Separator />{t('usage.detail.own')}</ToggleButton>
            </ToggleButtonGroup> : <span className="text-xs text-muted">{scopeLabel}</span>}
          </div>
          <dl className="grid grid-cols-2 divide-x divide-separator rounded-xl border border-separator">
            <div className="min-w-0 p-3 sm:p-4"><dt className="text-xs text-muted">{t('usage.common.totalTokens')}</dt><dd className="mt-2 break-words text-xl font-semibold leading-tight tabular-nums [overflow-wrap:anywhere] sm:text-2xl">{format.tokens(detail.usage.tokens)}</dd></div>
            <div className="min-w-0 p-3 sm:p-4"><dt className="text-xs text-muted">{t('usage.common.cost')} · {costLabel(detail.usage.costKind, locale)}</dt><dd className="mt-2 break-words text-xl font-semibold leading-tight tabular-nums [overflow-wrap:anywhere] sm:text-2xl">{format.money(detail.usage.costUsd, detail.usage.knownCostUsd)}</dd></div>
          </dl>
          <p className="text-xs text-muted">{t(detail.scope === 'thread' ? 'usage.detail.threadNote' : 'usage.detail.ownNote')}{detail.usage.costUsd === null && detail.usage.knownCostUsd > 0 && <> · {t('usage.explorer.partial')}</>}</p>
          {detail.hasDescendants && detail.threadAvailable && detail.scope === 'thread' && <div aria-label={t('usage.detail.attribution')}>
            <div className={`${columnClass} pb-1 text-xs text-muted`} aria-hidden><span>{t('usage.detail.attribution')}</span><span className="text-right">Token</span><span className="text-right">{t('usage.common.cost')}</span></div>
            {detail.groups.map(group => group.kind === 'own' ? <div key={group.kind} className={`${columnClass} py-2`}><span>{t(groupLabels[group.kind])}</span><span className="break-all text-right tabular-nums">{format.tokens(group.tokens)}</span><span className="break-all text-right tabular-nums">{format.money(group.costUsd, group.knownCostUsd)}</span></div> : <details key={group.kind} className="group/related">
              <summary className={`${columnClass} cursor-pointer list-none rounded-md py-2 outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent`}><span className="flex min-w-0 items-center gap-1"><ChevronRight className="size-3.5 shrink-0 group-open/related:rotate-90" aria-hidden />{t(groupLabels[group.kind])} ({group.members.length})</span><span className="break-all text-right tabular-nums">{format.tokens(group.tokens)}</span><span className="break-all text-right tabular-nums">{format.money(group.costUsd, group.knownCostUsd)}</span></summary>
              <ul className="space-y-2 rounded-lg bg-surface-secondary p-3">{group.members.map(member => <li key={`${member.source}:${member.sessionId}`} className="space-y-1 text-xs"><div className={columnClass}><span className="min-w-0 break-words">{member.sessionTitle ?? member.agentNickname ?? member.sessionId}{member.agentRole && <span className="block text-muted">{member.agentRole}</span>}</span><span className="break-all text-right tabular-nums">{format.tokens(member.tokens)}</span><span className="break-all text-right tabular-nums">{format.money(member.costUsd, member.knownCostUsd)}</span></div>{['codex', 'claude', 'dsh'].includes(member.source) && <Link to="/sessions" search={previous => ({ ...parseSessionPageSearch(previous), group: undefined, sessionSource: member.source, sessionId: member.sessionId, sessionFocus: String(Date.now()) })} onClick={onClose} className="text-accent underline underline-offset-2">{t('usage.detail.viewHistory')}</Link>}</li>)}</ul>
            </details>)}
          </div>}
          {detail.legacyCombined && <div className="space-y-2 rounded-lg bg-surface-secondary p-3 text-xs"><p>{t('usage.detail.legacyThread')}</p><dl className="space-y-2"><DetailValue label={t('usage.detail.thread')} value={`${format.tokens(detail.legacyCombined.tokens)} Token · ${format.money(detail.legacyCombined.costUsd, detail.legacyCombined.knownCostUsd)}`} /><DetailValue label={t('usage.insights.subagent')} value={`${format.tokens(detail.legacyCombined.subagentTokens)} Token · ${format.money(detail.legacyCombined.subagentCostUsd)}`} /></dl></div>}
          {row.insights?.relationConflict && <p className="text-xs text-warning">{t('usage.detail.relationConflict')}</p>}
        </section>

        <SessionTokenBreakdown usage={detail.usage} format={format} />
        <SessionModelBreakdown usage={detail.usage} format={format} />

        <section aria-label={t('usage.detail.performance')}>
          <h3 className="mb-3 font-semibold">{t('usage.detail.performance')} <span className="text-xs font-normal text-muted">· {t('usage.detail.own')}</span></h3>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div><dt className="text-xs text-muted">{t('usage.insights.speed')}</dt><dd className="mt-1 text-lg tabular-nums">{performance?.tokensPerSecond != null ? `≈ ${format.number(performance.tokensPerSecond)} tok/s` : <span className="text-sm text-muted">{t('usage.detail.noSamples')}</span>}</dd>{performance && <p className="text-xs text-muted">{t('usage.insights.samples')}: {format.number(performance.estimatedRequestCount)}{performance.estimatedDurationMs != null && <> · {t('usage.detail.sampleDuration')}: {exact ? `${formatExactSessionNumber(performance.estimatedDurationMs, locale)} ms` : `${(performance.estimatedDurationMs / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} s`}</>}</p>}</div>
            <div><dt className="text-xs text-muted">{t('usage.detail.averageWait')}</dt><dd className="mt-1 text-lg tabular-nums">{performance?.ttftMs != null ? exact ? `${formatExactSessionNumber(performance.ttftMs, locale)} ms` : `${(performance.ttftMs / 1000).toLocaleString(locale, { maximumFractionDigits: 2 })} s` : <span className="text-sm text-muted">{t('usage.detail.noSamples')}</span>}</dd>{performance && <p className="text-xs text-muted">{t('usage.insights.samples')}: {format.number(performance.ttftSampleCount)}</p>}</div>
          </dl>
          <p className="mt-3 text-xs text-muted">{t('usage.detail.performanceNote')}</p>
        </section>

        <div>
          <DetailDisclosure title={t('usage.detail.activity')} summary={activitySummary}>
            <p className="text-xs text-muted">{t('usage.detail.own')} · {t(insight?.signals.coverage === 'unsupported' ? 'usage.detail.unsupported' : insight?.signals.coverage === 'complete' ? 'usage.detail.covered' : 'usage.detail.partialCoverage')}</p>
            {available.length > 0 && <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">{available.map(metric => <DetailValue key={metric.label} label={t(metric.label)} value={typeof metric.value === 'boolean' ? t(metric.value ? 'usage.detail.signalPresent' : 'usage.detail.signalAbsent') : metric.label === 'usage.insights.costPerEdit' ? format.money(metric.value) : metric.label === 'usage.insights.tokensPerEdit' ? format.tokens(metric.value) : format.number(metric.value)} />)}</dl>}
            {missing.length > 0 && <p className="text-xs text-muted">{t('usage.detail.notRecordedMetrics')}: {missing.map(metric => t(metric.label)).join('、')}</p>}
            {!insight && <p className="text-muted">{t('usage.detail.noActivity')}</p>}
            <p className="text-xs text-muted">{t('usage.insights.evidenceNote')}</p>
          </DetailDisclosure>
          <DetailDisclosure title={t('usage.detail.sessionInfo')} summary={row.taskSeconds != null ? `${t('usage.explorer.taskTime')} ${taskDuration}` : undefined}>
            <dl className="space-y-2">
              <DetailValue label={t('usage.activity.recent')} value={date(row.lastActivityAt)} />
              <DetailValue label={t('usage.insights.firstActivity')} value={date(insight?.firstActivityAt)} />
              {row.taskSeconds != null && <DetailValue label={t('usage.explorer.taskTime')} value={`${taskDuration} · ${t(row.taskTimingKind === 'recorded' ? 'usage.session.recordedTime' : row.taskTimingKind === 'mixed' ? 'usage.session.includesEstimate' : 'usage.session.estimate')}`} />}
              <DetailValue label={t('usage.detail.billing')} value={`${serviceLabel(row.billing.service, locale)} · ${modeLabel(row.billing.mode, locale)}`} />
              <DetailValue label={t('usage.detail.account')} value={accountLabel(row.billing, locale, 'usage.activity.sessionAccountUnknown')} />
              {!row.models?.length && row.model !== 'unknown' && <DetailValue label={t('usage.common.model')} value={row.model} />}
              {showTokenShare && row.sharePercent != null && <DetailValue label={t('usage.detail.ownShare')} value={<Tooltip><Tooltip.Trigger className="cursor-help underline decoration-dotted underline-offset-4">{row.sharePercent.toLocaleString(locale, { maximumFractionDigits: 1 })}%</Tooltip.Trigger><Tooltip.Content className="max-w-xs">{t('usage.activity.contributionFilterNote')} {t('usage.activity.contributionNote')}</Tooltip.Content></Tooltip>} />}
              {insight?.parentId && <DetailValue label={t('usage.detail.parent')} value={<span className="break-all font-mono text-xs">{insight.parentId} · {t(insight.relationKind === 'fork' ? 'usage.insights.relationFork' : insight.relationKind === 'subagent' ? 'usage.insights.relationSubagent' : 'usage.insights.relationUnknown')}</span>} />}
              {(insight?.agentNickname || insight?.agentRole) && <DetailValue label={t('usage.detail.agentIdentity')} value={[insight.agentNickname, insight.agentRole].filter(Boolean).join(' · ')} />}
            </dl>
            {insight?.orphan && <p className="text-xs text-muted">{t('usage.detail.orphan')}</p>}
            <div><div className="flex items-center justify-between gap-2"><p className="text-xs text-muted">{t('usage.detail.sessionId')}</p><Button size="sm" variant="tertiary" onPress={() => void copy(row.sessionId, t('usage.detail.copyId'))}>{t('usage.detail.copyId')}</Button></div><code className="block break-all rounded-lg bg-surface-secondary px-3 py-2 text-xs">{row.sessionId}</code></div>
            <div><div className="flex items-center justify-between gap-2"><p className="text-xs text-muted">{t('usage.detail.directory')}</p>{directory && <Button size="sm" variant="tertiary" onPress={() => void copy(directory, t('usage.insights.copyDirectory'))}>{t('usage.insights.copyDirectory')}</Button>}</div>
              <p className="break-all font-mono text-xs">{directory ?? t(directoryState === 'loading' ? 'usage.activity.loading' : directoryState === 'error' ? 'usage.detail.directoryError' : 'usage.insights.unknown')}</p>
              {directoryState === 'error' && <Button size="sm" variant="tertiary" onPress={() => setDirectoryAttempt(value => value + 1)}>{t('usage.detail.retry')}</Button>}
            </div>
            {insight?.resumeCommand && <div><p className="mb-1 text-xs text-muted">{t('usage.detail.resumeCommand')}</p><code className="block break-all rounded-lg bg-surface-secondary p-3 text-xs">{insight.resumeCommand}</code></div>}
          </DetailDisclosure>
          <DetailDisclosure title={t('usage.detail.dataNotes')}>
            <p>{t('usage.detail.rangeNote')}</p><p>{t('usage.insights.priceNote')}</p><p>{t('usage.insights.evidenceNote')}</p>
            {row.billing.mode === 'unknown' && <p>{t('usage.activity.insufficientBillingEvidence')}</p>}
            {!detail.usage.detailsComplete && <p>{t('usage.explorer.missingDetails')}</p>}
            <p>{t('usage.detail.roundingNote')}</p><p>{t('usage.detail.privacy')}</p>
          </DetailDisclosure>
        </div>
      </Modal.Body>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>
  </Modal>;
}
