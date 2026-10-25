import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button, Modal, ToggleButton, ToggleButtonGroup, Tooltip } from '@heroui/react';
import { ChevronRight, Copy } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import type { SupportedLocale } from 'quotern-i18n';
import type { SessionActivity } from 'quotern-core';
import { request } from '@/lib/api';
import { formatSessionDuration, formatSessionTokens, formatSessionUsd } from '@/lib/session-metric-format';
import { sourceLabel } from '@/lib/tokens';
import { DEFAULT_STATS_TIMEZONE, getStatsTimezoneLabel } from '../lib/stats-timezone';
import { accountLabel, costLabel, modeLabel, serviceLabel } from '../lib/session-labels';
import { parseSessionPageSearch } from '../lib/session-page';
import { buildSessionDetail, type DetailRange, type DetailScope } from '../lib/session-detail';
import { ProviderIcon } from './ProviderIcon';
import { useAppToastQueue } from '@/components/AppToastContext';
import { DetailValue, SessionModelBreakdown, SessionPricingDetails, type DetailFormat } from './SessionUsageBreakdown';
import { HelpPopover } from './HelpPopover';

const groupLabels = { own: 'usage.detail.own', subagent: 'usage.insights.subagent', fork: 'usage.detail.forks', unknown: 'usage.detail.otherRelated' } as const;

interface SessionActions {
  key: string;
  directory: string | null;
  token: string | null;
  canOpenDirectory: boolean;
  canResume: boolean;
  reason: string | null;
  resumeCommand?: string | null;
  resumeReason?: string | null;
}

function actionErrorKey(code: string): string {
  switch (code) {
    case 'SESSION_DIRECTORY_UNAVAILABLE': return 'usage.insights.directoryUnavailable';
    case 'SESSION_CLI_UNAVAILABLE': return 'usage.insights.cliUnavailable';
    case 'SESSION_ACTION_LOCAL_ONLY': return 'usage.insights.actionsLocalOnly';
    case 'SESSION_ACTION_UNSUPPORTED': return 'usage.insights.terminalUnavailable';
    case 'SESSION_ACTION_FORBIDDEN': return 'usage.insights.actionExpired';
    case 'SESSION_RESUME_UNSUPPORTED': return 'usage.insights.resumeUnsupported';
    case 'SESSION_RESUME_PROFILE_REQUIRED': return 'usage.insights.resumeProfileRequired';
    case 'SESSION_RESUME_FILE_UNAVAILABLE': return 'usage.insights.resumeFileUnavailable';
    default: return 'usage.insights.actionFailed';
  }
}

/** One dedicated dialog, shared by the browser and Desktop renderers. */
export function SessionDetailDialog({ row, range, showTokenShare = false, onClose }: { row: SessionActivity; range?: DetailRange; showTokenShare?: boolean; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  const toastQueue = useAppToastQueue();
  const [scope, setScope] = useState<DetailScope>('own');
  const [feedback, setFeedback] = useState('');
  const [directory, setDirectory] = useState<string | null>(null);
  const [directoryState, setDirectoryState] = useState<'loading' | 'ready' | 'error' | 'unsupported'>('loading');
  const [directoryAttempt, setDirectoryAttempt] = useState(0);
  const [actions, setActions] = useState<SessionActions | null>(null);
  const [pending, setPending] = useState<'resume' | 'open-directory' | null>(null);
  const busy = useRef(false);
  const sessionKey = JSON.stringify([row.source, row.sessionId]);
  const currentSession = useRef<string | null>(sessionKey);
  currentSession.current = sessionKey;
  const hintId = useId();
  const current = actions?.key === sessionKey ? actions : null;
  const detail = useMemo(() => buildSessionDetail(row, scope), [row, scope]);
  const insight = row.insights;
  const resumeCommand = current?.resumeCommand === undefined ? insight?.resumeCommand : current.resumeCommand;
  const resumeHint = current?.resumeReason ?? (!current?.canResume ? current?.reason : null);
  const directoryHint = !current?.canOpenDirectory ? current?.reason : null;

  useEffect(() => {
    let active = true;
    const key = JSON.stringify([row.source, row.sessionId]);
    currentSession.current = key;
    setFeedback('');
    setActions(null);
    setDirectory(null);
    setDirectoryState('loading');
    const query = new URLSearchParams({ source: row.source, sessionId: row.sessionId });
    void request<Omit<SessionActions, 'key'>>(`/functions/tud-session-actions?${query}`).then(result => {
      if (active) { setActions({ ...result, key }); setDirectory(result.directory); setDirectoryState('ready'); }
    }).catch(async error => {
      // Old/remote runtimes still permit copying known commands and directory metadata.
      let directory: string | null = null;
      let state: typeof directoryState = 'unsupported';
      if (['codex', 'claude', 'dsh', 'pi', 'zcode', 'antigravity'].includes(row.source)) {
        try { directory = (await request<{ directory: string | null }>(`/functions/tud-session-directory?${query}`)).directory; state = 'ready'; }
        catch { state = 'error'; }
      }
      if (active) {
        const reason = error instanceof Error ? error.message : 'SESSION_ACTION_UNAVAILABLE';
        setActions({ key, directory, token: null, canOpenDirectory: false, canResume: false, reason, resumeReason: reason });
        setDirectory(directory); setDirectoryState(state);
      }
    });
    return () => { active = false; currentSession.current = null; };
  }, [row.source, row.sessionId, directoryAttempt]);

  const copy = async (value: string, label: string) => {
    const key = sessionKey;
    try { await navigator.clipboard.writeText(value); if (currentSession.current === key) toastQueue.add({ title: `${label} · ${t('usage.insights.copied')}`, variant: 'success' }, { timeout: 2500 }); }
    catch { if (currentSession.current === key) toastQueue.add({ title: t('usage.insights.copyFailed'), variant: 'danger' }); }
  };
  const runAction = async (action: 'resume' | 'open-directory') => {
    if (busy.current || !current?.token || !(action === 'resume' ? current.canResume : current.canOpenDirectory)) return;
    const key = sessionKey;
    busy.current = true;
    setPending(action);
    setFeedback('');
    try {
      await request('/functions/tud-session-actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Quotern-Session-Action': current.token },
        body: JSON.stringify({ source: row.source, sessionId: row.sessionId, action }),
      });
      if (currentSession.current === key) setFeedback(t(action === 'resume' ? 'usage.insights.terminalOpened' : 'usage.insights.directoryOpened'));
    } catch (error) {
      if (currentSession.current === key) setFeedback(t(actionErrorKey(error instanceof Error ? error.message : '')));
    } finally {
      busy.current = false;
      if (currentSession.current === key) setPending(null);
    }
  };
  const format: DetailFormat = {
    tokens: formatSessionTokens,
    number: value => value == null ? t('usage.insights.unknown') : value.toLocaleString(locale, { maximumFractionDigits: 1 }),
    money: (value, known = 0) => value == null
      ? known > 0 ? formatSessionUsd(known, locale, { lowerBound: true }) : t('usage.activity.amountUnknown')
      : formatSessionUsd(value, locale),
  };
  const date = (stamp: string | null | undefined) => stamp && Number.isFinite(Date.parse(stamp))
    ? new Date(stamp).toLocaleString(locale, { timeZone: DEFAULT_STATS_TIMEZONE, hour12: false }) : t('usage.insights.unknown');
  const period = range ? range.fromTime && range.toTime ? `${date(range.fromTime)} – ${date(range.toTime)}` : range.fromDate === range.toDate ? range.fromDate : `${range.fromDate} – ${range.toDate}` : t('usage.explorer.range');
  const scopeLabel = t(detail.scope === 'thread' ? 'usage.detail.thread' : 'usage.detail.own');
  const taskDuration = formatSessionDuration(row.taskSeconds ?? null);
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
  const columnClass = 'grid grid-cols-2 items-baseline gap-x-3 gap-y-1 [&>:first-child]:col-span-2 sm:grid-cols-[minmax(0,1fr)_minmax(5rem,auto)_minmax(6rem,auto)] sm:[&>:first-child]:col-span-1';

  return <Modal isOpen onOpenChange={open => { if (!open) onClose(); }}>
    <Modal.Backdrop><Modal.Container scroll="inside" size="lg"><Modal.Dialog className="max-w-5xl text-foreground" style={{ fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif' }}>
      <Modal.CloseTrigger aria-label={t('usage.detail.close')} />
      <Modal.Header className="border-b border-separator pb-3">
        <div className="flex min-w-0 items-start gap-3 pr-9"><span className="mt-1 shrink-0"><ProviderIcon provider={row.source} size={22} /></span><div className="min-w-0">
          <Modal.Heading className="break-words text-lg leading-7">{row.sessionTitle ?? t('usage.insights.detailTitle')}</Modal.Heading>
          <p className="mt-1 break-words text-xs text-muted">{sourceLabel(row.source)} · {row.projectLabel}</p>
        </div></div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" isDisabled={!current?.canResume || pending !== null} aria-busy={pending === 'resume'} aria-describedby={resumeHint ? `${hintId}-resume` : undefined} onPress={() => void runAction('resume')}>{t(pending === 'resume' ? 'usage.insights.opening' : 'usage.insights.resume')}</Button>
          <Button size="sm" variant="secondary" isDisabled={!current?.canOpenDirectory || pending !== null} aria-busy={pending === 'open-directory'} aria-describedby={directoryHint ? `${hintId}-directory` : undefined} onPress={() => void runAction('open-directory')}>{t(pending === 'open-directory' ? 'usage.insights.opening' : 'usage.detail.openFolder')}</Button>
          <Button size="sm" variant="tertiary" isDisabled={!resumeCommand} onPress={() => resumeCommand && void copy(resumeCommand, t('usage.insights.copyResume'))}><Copy className="size-3.5" aria-hidden />{t('usage.insights.copyResume')}</Button>
          <Button size="sm" variant="tertiary" isDisabled={!directory} onPress={() => directory && void copy(directory, t('usage.detail.copyPath'))}><Copy className="size-3.5" aria-hidden />{t('usage.detail.copyPath')}</Button>
        </div>
        {feedback && <p role="status" className="mt-1 text-xs">{feedback}</p>}
      </Modal.Header>
      <Modal.Body className="space-y-6 overscroll-contain pt-4 text-sm leading-6 text-foreground">
        {(resumeHint || directoryHint) && <div className="space-y-1 text-xs text-muted">
          {resumeHint && <p id={`${hintId}-resume`}>{t(actionErrorKey(resumeHint))}</p>}
          {directoryHint && directoryHint !== resumeHint && <p id={`${hintId}-directory`}>{t(actionErrorKey(directoryHint))}</p>}
          {directoryHint && directoryHint === resumeHint && <span id={`${hintId}-directory`} className="sr-only">{t(actionErrorKey(directoryHint))}</span>}
          {directoryState === 'error' && <Button size="sm" variant="tertiary" onPress={() => setDirectoryAttempt(value => value + 1)}>{t('usage.detail.retry')}</Button>}
        </div>}
        <section aria-label={t('usage.detail.summary')} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1"><p className="min-w-0 text-xs text-muted">{t(range?.kind === 'collected' ? 'usage.detail.collectedRange' : 'usage.detail.selectedRange')}: <span className="text-foreground">{period}</span></p>
              <HelpPopover title={t('usage.detail.selectedRange')}><p>{getStatsTimezoneLabel()}</p><p>{t('usage.detail.rangeNote')}</p><p>{t('usage.insights.evidenceNote')}</p><p>{t('usage.detail.privacy')}</p></HelpPopover>
            </div>
            <div className="flex items-center gap-1">{detail.hasDescendants && detail.threadAvailable ? <ToggleButtonGroup size="sm" selectionMode="single" disallowEmptySelection selectedKeys={[detail.scope]} aria-label={t('usage.detail.usageScope')} onSelectionChange={keys => { setScope(keys.has('thread') ? 'thread' : 'own'); setFeedback(''); }}>
              <ToggleButton id="own">{t('usage.detail.scopeOwn')}</ToggleButton><ToggleButton id="thread"><ToggleButtonGroup.Separator />{t('usage.detail.thread')}</ToggleButton>
            </ToggleButtonGroup> : <span className="text-xs text-muted">{scopeLabel}</span>}
              <HelpPopover title={t('usage.detail.usageScope')}><p>{t('usage.detail.ownNote')}</p><p>{t('usage.detail.threadNote')}</p></HelpPopover>
            </div>
          </div>
          <dl className="grid grid-cols-2 divide-x divide-separator rounded-xl border border-separator">
            <div className="min-w-0 p-3 sm:p-4"><dt className="text-xs text-muted">{t('usage.common.totalTokens')}</dt><dd className="mt-2 break-words text-xl font-semibold leading-tight tabular-nums [overflow-wrap:anywhere] sm:text-2xl">{format.tokens(detail.usage.tokens)}</dd></div>
            <div className="min-w-0 p-3 sm:p-4"><dt className="flex items-center gap-1 text-xs text-muted"><span>{t('usage.common.cost')} · {costLabel(detail.usage.costKind, locale)}</span><HelpPopover title={t('usage.common.cost')}><SessionPricingDetails usage={detail.usage} format={format} />{row.billing.mode === 'unknown' && <p>{t('usage.activity.insufficientBillingEvidence')}</p>}</HelpPopover></dt><dd className="mt-2 break-words text-xl font-semibold leading-tight tabular-nums [overflow-wrap:anywhere] sm:text-2xl">{format.money(detail.usage.costUsd, detail.usage.knownCostUsd)}</dd></div>
          </dl>
          {detail.hasDescendants && detail.threadAvailable && detail.scope === 'thread' && <div aria-label={t('usage.detail.attribution')}>
            <div className={`${columnClass} pb-1 text-xs text-muted`} aria-hidden><span>{t('usage.detail.attribution')}</span><span className="text-right">Token</span><span className="text-right">{t('usage.common.cost')}</span></div>
            {detail.groups.map(group => group.kind === 'own' ? <div key={group.kind} className={`${columnClass} py-2`}><span>{t(groupLabels[group.kind])}</span><span className="break-all text-right tabular-nums">{format.tokens(group.tokens)}</span><span className="break-all text-right tabular-nums">{format.money(group.costUsd, group.knownCostUsd)}</span></div> : <details key={group.kind} className="group/related">
              <summary className={`${columnClass} cursor-pointer list-none rounded-md py-2 outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent`}><span className="flex min-w-0 items-center gap-1"><ChevronRight className="size-3.5 shrink-0 group-open/related:rotate-90" aria-hidden />{t(groupLabels[group.kind])} ({group.members.length})</span><span className="break-all text-right tabular-nums">{format.tokens(group.tokens)}</span><span className="break-all text-right tabular-nums">{format.money(group.costUsd, group.knownCostUsd)}</span></summary>
              <ul className="rounded-lg bg-surface-secondary px-3 py-1">{group.members.map(member => {
                const name = member.sessionTitle ?? member.agentNickname ?? member.sessionId;
                return <li key={`${member.source}:${member.sessionId}`} className={`${columnClass} py-1 text-xs`}>
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 [overflow-wrap:anywhere]">
                    {['codex', 'claude', 'dsh'].includes(member.source) ? <Link to="/sessions" search={previous => ({ ...parseSessionPageSearch(previous), group: undefined, sessionSource: member.source, sessionId: member.sessionId, sessionFocus: String(Date.now()) })} onClick={onClose} className="min-w-0 rounded py-0.5 text-accent underline underline-offset-2 outline-offset-2 focus-visible:outline-2">{name}</Link> : <span className="min-w-0">{name}</span>}
                    {member.agentRole && <span className="text-muted">{member.agentRole}</span>}
                  </span>
                  <span className="break-all text-right tabular-nums">{format.tokens(member.tokens)}</span><span className="break-all text-right tabular-nums">{format.money(member.costUsd, member.knownCostUsd)}</span>
                </li>;
              })}</ul>
            </details>)}
          </div>}
          {detail.legacyCombined && <div className="space-y-2 rounded-lg bg-surface-secondary p-3 text-xs"><p>{t('usage.detail.legacyThread')}</p><dl className="space-y-2"><DetailValue label={t('usage.detail.thread')} value={`${format.tokens(detail.legacyCombined.tokens)} Token · ${format.money(detail.legacyCombined.costUsd, detail.legacyCombined.knownCostUsd)}`} /><DetailValue label={t('usage.insights.subagent')} value={`${format.tokens(detail.legacyCombined.subagentTokens)} Token · ${format.money(detail.legacyCombined.subagentCostUsd)}`} /></dl></div>}
          {row.insights?.relationConflict && <p className="text-xs text-warning">{t('usage.detail.relationConflict')}</p>}
        </section>

        <SessionModelBreakdown usage={detail.usage} format={format} pricingModels={detail.pricingModels} />

        <section aria-label={t('usage.detail.performance')}>
          <div className="mb-3 flex items-center gap-1"><h3 className="font-semibold">{t('usage.detail.performance')}{detail.scope === 'thread' && <span className="text-xs font-normal text-muted"> · {t('usage.detail.own')}</span>}</h3>
            <HelpPopover title={t('usage.detail.performance')}>
              <p>{t('usage.detail.performanceNote')}</p><p>{t('usage.detail.ownNote')}</p>
              {performance && <dl className="space-y-2"><DetailValue label={t('usage.insights.speed')} value={`${t('usage.insights.samples')}: ${format.number(performance.estimatedRequestCount)}`} />{performance.estimatedDurationMs != null && <DetailValue label={t('usage.detail.sampleDuration')} value={`${(performance.estimatedDurationMs / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} s`} />}<DetailValue label={t('usage.detail.averageWait')} value={`${t('usage.insights.samples')}: ${format.number(performance.ttftSampleCount)}`} /></dl>}
            </HelpPopover>
          </div>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div><dt className="text-xs text-muted">{t('usage.insights.speed')}</dt><dd className="mt-1 text-lg tabular-nums">{performance?.tokensPerSecond != null ? `≈ ${format.number(performance.tokensPerSecond)} tok/s` : <span className="text-sm text-muted">{t('usage.detail.noSamples')}</span>}</dd></div>
            <div><dt className="text-xs text-muted">{t('usage.detail.averageWait')}</dt><dd className="mt-1 text-lg tabular-nums">{performance?.ttftMs != null ? `${(performance.ttftMs / 1000).toLocaleString(locale, { maximumFractionDigits: 2 })} s` : <span className="text-sm text-muted">{t('usage.detail.noSamples')}</span>}</dd></div>
          </dl>
        </section>

        <div>
          <section aria-label={t('usage.detail.activity')} className="space-y-3 pb-5">
            <div className="flex items-center gap-1"><h3 className="font-semibold">{t('usage.detail.activity')}{detail.scope === 'thread' && <span className="text-xs font-normal text-muted"> · {t('usage.detail.own')}</span>}</h3>
              <HelpPopover title={t('usage.detail.activity')}><p>{t('usage.detail.ownNote')}</p><p>{t(insight?.signals.coverage === 'unsupported' ? 'usage.detail.unsupported' : insight?.signals.coverage === 'complete' ? 'usage.detail.covered' : 'usage.detail.partialCoverage')}</p>{missing.length > 0 && <p>{t('usage.detail.notRecordedMetrics')}: {missing.map(metric => t(metric.label)).join('、')}</p>}</HelpPopover>
              {insight && insight.signals.coverage !== 'complete' && <span className="text-xs text-muted">{t('usage.detail.partialActivity')}</span>}
            </div>
            {available.length > 0 && <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">{available.map(metric => <DetailValue key={metric.label} label={t(metric.label)} value={typeof metric.value === 'boolean' ? t(metric.value ? 'usage.detail.signalPresent' : 'usage.detail.signalAbsent') : metric.label === 'usage.insights.costPerEdit' ? format.money(metric.value) : metric.label === 'usage.insights.tokensPerEdit' ? format.tokens(metric.value) : format.number(metric.value)} />)}</dl>}
            {!insight && <p className="text-muted">{t('usage.detail.noActivity')}</p>}
          </section>
          <section aria-label={t('usage.detail.sessionInfo')} className="space-y-3 border-t border-separator pt-4">
            <h3 className="font-semibold">{t('usage.detail.sessionInfo')}</h3>
            <dl className="space-y-2">
              <DetailValue label={t('usage.activity.recent')} value={date(row.lastActivityAt)} />
              <DetailValue label={t('usage.insights.firstActivity')} value={date(insight?.firstActivityAt)} />
              {row.taskSeconds != null && <DetailValue label={<span className="inline-flex items-center gap-1">{t('usage.explorer.taskTime')}<HelpPopover title={t('usage.explorer.taskTime')}><p>{t(row.taskTimingKind === 'recorded' ? 'usage.session.recordedTime' : row.taskTimingKind === 'mixed' ? 'usage.session.includesEstimate' : 'usage.session.estimate')}</p><p>{t('usage.session.taskHelp')}</p></HelpPopover></span>} value={`${taskDuration}${row.taskTimingKind === 'recorded' ? '' : ` · ${t(row.taskTimingKind === 'mixed' ? 'usage.session.includesEstimate' : 'usage.session.estimate')}`}`} />}
              <DetailValue label={t('usage.detail.billing')} value={`${serviceLabel(row.billing.service, locale)} · ${modeLabel(row.billing.mode, locale)}`} />
              <DetailValue label={t('usage.detail.account')} value={accountLabel(row.billing, locale, 'usage.activity.sessionAccountUnknown')} />
              {!row.models?.length && row.model !== 'unknown' && <DetailValue label={t('usage.common.model')} value={row.model} />}
              {showTokenShare && row.sharePercent != null && <DetailValue label={t('usage.detail.ownShare')} value={<Tooltip><Tooltip.Trigger className="cursor-help underline decoration-dotted underline-offset-4">{row.sharePercent.toLocaleString(locale, { maximumFractionDigits: 1 })}%</Tooltip.Trigger><Tooltip.Content className="max-w-xs">{t('usage.activity.contributionFilterNote')} {t('usage.activity.contributionNote')}</Tooltip.Content></Tooltip>} />}
              {insight?.parentId && <DetailValue label={t('usage.detail.parent')} value={t(insight.relationKind === 'fork' ? 'usage.insights.relationFork' : insight.relationKind === 'subagent' ? 'usage.insights.relationSubagent' : 'usage.insights.relationUnknown')} />}
              {(insight?.agentNickname || insight?.agentRole) && <DetailValue label={t('usage.detail.agentIdentity')} value={[insight.agentNickname, insight.agentRole].filter(Boolean).join(' · ')} />}
            </dl>
            {insight?.orphan && <p className="text-xs text-muted">{t('usage.detail.orphan')}</p>}
          </section>
        </div>
      </Modal.Body>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>
  </Modal>;
}
