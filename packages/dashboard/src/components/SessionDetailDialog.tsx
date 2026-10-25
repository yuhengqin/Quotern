import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Button, Modal, ToggleButton, ToggleButtonGroup, Tooltip } from '@heroui/react';
import { ArrowLeft, ChevronRight, Copy, ExternalLink } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import type { SupportedLocale } from 'quotern-i18n';
import type { SessionActivity, SessionActivitySnapshot } from 'quotern-core';
import { request } from '@/lib/api';
import { formatSessionDuration, formatSessionTokens, formatSessionUsd } from '@/lib/session-metric-format';
import { sourceLabel } from '@/lib/tokens';
import { DEFAULT_STATS_TIMEZONE } from '../lib/stats-timezone';
import { accountLabel, costLabel, modeLabel, serviceLabel } from '../lib/session-labels';
import { createSessionDetailSearch } from '../lib/session-page';
import { SessionDetailCache, sessionDetailQuery } from '../lib/session-detail-cache';
import { buildSessionDetail, type DetailMember, type DetailRange, type DetailScope } from '../lib/session-detail';
import { ProviderIcon } from './ProviderIcon';
import { useAppToastQueue } from '@/components/AppToastContext';
import { DetailDisclosure, DetailValue, SessionModelBreakdown, SessionPricingDetails, type DetailFormat } from './SessionUsageBreakdown';
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

type DetailProps = { row: SessionActivity; range?: DetailRange; sessions?: readonly SessionActivity[]; showTokenShare?: boolean; onClose(): void };
type DetailFrame = { key: number; source: string; sessionId: string; title: string; row: SessionActivity | null; error?: 'missing' | 'failed' };
const emptySessions: readonly SessionActivity[] = [];

/** One Modal and one period-scoped cache; retained frames preserve native disclosures and local state. */
export function SessionDetailDialog(props: DetailProps) {
  return <SessionDetailNavigator key={JSON.stringify([props.row.source, props.row.sessionId])} {...props} />;
}

function SessionDetailNavigator({ row, range, sessions = emptySessions, showTokenShare = false, onClose }: DetailProps) {
  const { t } = useTranslation();
  const [period] = useState(range);
  const abort = useRef(new AbortController());
  const [cache] = useState(() => new SessionDetailCache(async source => {
    const snapshot = await request<SessionActivitySnapshot>(sessionDetailQuery(source, period), { signal: AbortSignal.any([abort.current.signal, AbortSignal.timeout(30_000)]) });
    return snapshot.sessions;
  }, [...sessions, row]));
  const [frames, setFrames] = useState<DetailFrame[]>(() => [{ key: 0, source: row.source, sessionId: row.sessionId, title: row.sessionTitle ?? t('usage.insights.detailTitle'), row }]);
  const sequence = useRef(0);
  const dialog = useRef<HTMLDivElement>(null);
  const views = useRef(new Map<number, { top: number; trigger?: HTMLElement }>());
  const active = frames[frames.length - 1]!;

  useEffect(() => {
    if (abort.current.signal.aborted) abort.current = new AbortController();
    return () => { abort.current.abort(); };
  }, []);
  useEffect(() => {
    if (JSON.stringify(range) !== JSON.stringify(period)) return;
    cache.seed([...sessions, row]);
    setFrames(previous => previous.map(frame => frame.key === 0 ? { ...frame, row, title: row.sessionTitle ?? frame.title } : frame));
  }, [cache, row, sessions, range, period]);

  useLayoutEffect(() => {
    const frame = dialog.current?.querySelector<HTMLElement>('[data-session-frame]:not([hidden])');
    const body = frame?.querySelector<HTMLElement>('.modal__body');
    const saved = views.current.get(active.key);
    if (body) body.scrollTop = saved?.top ?? 0;
    if (saved?.trigger?.isConnected) saved.trigger.focus({ preventScroll: true });
    else if (active.key > 0) frame?.querySelector<HTMLElement>('[data-session-heading]')?.focus({ preventScroll: true });
  }, [active.key, Boolean(active.row)]);

  const saveView = (trigger?: HTMLElement) => {
    const body = dialog.current?.querySelector<HTMLElement>('[data-session-frame]:not([hidden]) .modal__body');
    views.current.set(active.key, { top: body?.scrollTop ?? 0, trigger });
  };
  const loadFrame = (frame: DetailFrame, retry = false) => {
    void cache.load(frame, retry).then(result => {
      if (!abort.current.signal.aborted) setFrames(previous => previous.map(item => item.key === frame.key ? { ...item, row: result, error: result ? undefined : 'missing' } : item));
    }).catch(() => {
      if (!abort.current.signal.aborted) setFrames(previous => previous.map(item => item.key === frame.key ? { ...item, error: 'failed' } : item));
    });
  };
  const navigate = (member: DetailMember, trigger: HTMLElement) => {
    saveView(trigger);
    const cached = cache.get(member) ?? null;
    const next: DetailFrame = { key: ++sequence.current, source: member.source, sessionId: member.sessionId, title: member.sessionTitle ?? member.agentNickname ?? member.sessionId, row: cached };
    setFrames(previous => [...previous, next]);
    if (!cached) loadFrame(next);
  };
  const back = () => {
    views.current.delete(active.key);
    setFrames(previous => previous.slice(0, -1));
  };
  const prefetch = (member: DetailMember) => { void cache.load(member).catch(() => {}); };

  return <Modal isOpen onOpenChange={open => { if (!open) onClose(); }}>
    <Modal.Backdrop><Modal.Container scroll="inside" size="lg"><Modal.Dialog aria-label={active.title} className="max-w-5xl text-foreground" style={{ fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif' }}><div ref={dialog} className="contents">
      <Modal.CloseTrigger aria-label={t('usage.detail.close')} />
      {frames.map((frame, index) => <div key={frame.key} data-session-frame hidden={frame.key !== active.key} inert={frame.key !== active.key} className={frame.key === active.key ? 'contents' : 'hidden'}>
        {frame.row ? <SessionDetailContent row={frame.row} range={period} showTokenShare={index === 0 && showTokenShare} onNavigate={navigate} onPrefetch={prefetch} navigation={index > 0 && <Button size="sm" variant="tertiary" className="mb-2 max-w-full" onPress={back}><ArrowLeft className="size-3.5 shrink-0" aria-hidden />{t('usage.detail.backSession')}</Button>} /> : <>
          <Modal.Header className="border-b border-separator pb-3 pr-9"><Button size="sm" variant="tertiary" className="mb-2" onPress={back}><ArrowLeft className="size-3.5" aria-hidden />{t('usage.detail.backSession')}</Button><h2 data-session-heading tabIndex={-1} className="break-words text-lg leading-7 outline-none">{frame.title}</h2></Modal.Header>
          <Modal.Body className="space-y-3 py-8 text-sm"><p role={frame.error ? 'status' : undefined}>{t(frame.error === 'failed' ? 'usage.detail.relatedError' : frame.error === 'missing' ? 'usage.detail.relatedMissing' : 'usage.activity.loading')}</p>{frame.error && <Button size="sm" variant="secondary" onPress={() => { setFrames(previous => previous.map(item => item.key === frame.key ? { ...item, error: undefined } : item)); loadFrame(frame, true); }}>{t('usage.detail.retry')}</Button>}</Modal.Body>
        </>}
      </div>)}
    </div></Modal.Dialog></Modal.Container></Modal.Backdrop>
  </Modal>;
}

function SessionDetailContent({ row, range, showTokenShare, navigation, onNavigate, onPrefetch }: { row: SessionActivity; range?: DetailRange; showTokenShare: boolean; navigation: ReactNode; onNavigate(member: DetailMember, trigger: HTMLElement): void; onPrefetch(member: DetailMember): void }) {
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
  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelPrefetch = () => { clearTimeout(prefetchTimer.current); };
  useEffect(() => () => { clearTimeout(prefetchTimer.current); }, []);
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
  const columnClass = 'grid grid-cols-[minmax(0,1fr)_minmax(4.5rem,auto)_minmax(5rem,auto)] items-baseline gap-x-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(5rem,0.55fr)_minmax(6rem,0.55fr)]';
  const renderRelatedMember = (member: DetailMember, relation?: keyof typeof groupLabels) => {
    const name = member.sessionTitle ?? member.agentNickname ?? member.sessionId;
    return <li key={`${member.source}:${member.sessionId}`} className={`${columnClass} py-2 text-xs`}>
      <div className="min-w-0 sm:contents">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 [overflow-wrap:anywhere]">
        {relation && <span className="text-muted">{t(groupLabels[relation])} ·</span>}
        {['codex', 'claude', 'dsh'].includes(member.source) ? <span className="inline-flex min-w-0 max-w-full items-baseline gap-1"><button type="button" onClick={event => onNavigate(member, event.currentTarget)} onPointerEnter={() => { cancelPrefetch(); prefetchTimer.current = setTimeout(() => onPrefetch(member), 120); }} onPointerLeave={cancelPrefetch} onFocus={() => { cancelPrefetch(); onPrefetch(member); }} onBlur={cancelPrefetch} className="min-h-6 min-w-0 cursor-pointer rounded py-0.5 text-left text-accent underline underline-offset-2 outline-offset-2 focus-visible:outline-2">{name}</button><Link to="/sessions" search={createSessionDetailSearch(member, range)} target="_blank" rel="noopener noreferrer" aria-label={t('usage.detail.openSeparate', { name })} className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted outline-offset-2 hover:text-accent focus-visible:outline-2"><ExternalLink className="size-3" aria-hidden /></Link></span> : <span className="min-w-0">{name}</span>}
      </span>
      {member.agentRole && <span className="mt-0.5 block break-words text-muted [overflow-wrap:anywhere] sm:col-start-2 sm:mt-0">{member.agentRole}</span>}
      </div>
      <span className="break-words text-right tabular-nums sm:col-start-3">{format.tokens(member.tokens)}</span><span className="break-words text-right tabular-nums sm:col-start-4">{format.money(member.costUsd, member.knownCostUsd)}</span>
    </li>;
  };

  return <>
      <Modal.Header className="border-b border-separator pb-3">
        {navigation}
        <div className="flex min-w-0 items-start gap-3 pr-9"><span className="mt-1 shrink-0"><ProviderIcon provider={row.source} size={22} /></span><div className="min-w-0">
          <h2 data-session-heading tabIndex={-1} className="break-words text-lg leading-7 outline-none">{row.sessionTitle ?? t('usage.insights.detailTitle')}</h2>
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
        <div className="flex min-w-0 items-center gap-1"><p className="min-w-0 text-xs text-muted">{t(range?.kind === 'collected' ? 'usage.detail.collectedRange' : 'usage.detail.selectedRange')}: <span className="text-foreground">{period}</span></p>
          <HelpPopover title={t(range?.kind === 'collected' ? 'usage.detail.collectedRange' : 'usage.detail.selectedRange')}><p>{t(range?.kind === 'collected' ? 'usage.detail.collectedRangeNote' : 'usage.detail.rangeNote')}</p><p>{t('usage.detail.timezoneNote')}</p></HelpPopover>
        </div>
        <section aria-label={t('usage.detail.summary')} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1"><h2 className="font-semibold">{t('usage.detail.usageCosts')}</h2>{detail.hasDescendants && <HelpPopover title={t('usage.detail.usageScope')}><p>{t('usage.detail.threadNote')}</p></HelpPopover>}</div>
            {detail.hasDescendants && <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto">{detail.threadAvailable ? <ToggleButtonGroup size="sm" className="min-w-0 flex-1 items-stretch sm:flex-none" selectionMode="single" disallowEmptySelection selectedKeys={[detail.scope]} aria-label={t('usage.detail.usageScope')} onSelectionChange={keys => { setScope(keys.has('thread') ? 'thread' : 'own'); setFeedback(''); }}>
              <ToggleButton id="own" className="h-auto min-h-9 min-w-0 flex-1 whitespace-normal py-1 sm:min-h-8 sm:flex-none">{t('usage.detail.scopeOwn')}</ToggleButton><ToggleButton id="thread" className="h-auto min-h-9 min-w-0 flex-1 whitespace-normal py-1 sm:min-h-8 sm:flex-none"><ToggleButtonGroup.Separator />{t('usage.detail.thread')}</ToggleButton>
            </ToggleButtonGroup> : <span className="text-xs text-muted">{scopeLabel}</span>}
            </div>}
          </div>
          <dl className="grid grid-cols-2 divide-x divide-separator rounded-xl border border-separator">
            <div className="min-w-0 p-3 sm:p-4"><dt className="text-xs text-muted">{t('usage.common.totalTokens')}</dt><dd className="mt-2 break-words text-xl font-semibold leading-tight tabular-nums [overflow-wrap:anywhere] sm:text-2xl">{format.tokens(detail.usage.tokens)}</dd></div>
            <div className="min-w-0 p-3 sm:p-4"><dt className="flex items-center gap-1 text-xs text-muted"><span>{t('usage.common.cost')}{detail.usage.costKind !== 'unknown' && <> · {costLabel(detail.usage.costKind, locale)}</>}</span><HelpPopover title={t('usage.common.cost')}><SessionPricingDetails usage={detail.usage} format={format} />{row.billing.mode === 'unknown' && <p>{t('usage.activity.insufficientBillingEvidence')}</p>}</HelpPopover></dt><dd className="mt-2 break-words text-xl font-semibold leading-tight tabular-nums [overflow-wrap:anywhere] sm:text-2xl">{format.money(detail.usage.costUsd, detail.usage.knownCostUsd)}</dd></div>
          </dl>
          {detail.hasDescendants && detail.threadAvailable && detail.scope === 'thread' && <div aria-label={t('usage.detail.attribution')}>
            <div className={`${columnClass} pb-1 text-xs text-muted`} aria-hidden><span>{t('usage.detail.attribution')}</span><span className="hidden sm:block">{t('usage.detail.agentRole')}</span><span className="text-right">Token</span><span className="text-right">{t('usage.common.cost')}</span></div>
            {detail.groups.map(group => {
              if (group.kind === 'own') return <div key={group.kind} className={`${columnClass} py-2`}><span className="sm:col-span-2">{t(groupLabels[group.kind])}</span><span className="break-words text-right tabular-nums">{format.tokens(group.tokens)}</span><span className="break-words text-right tabular-nums">{format.money(group.costUsd, group.knownCostUsd)}</span></div>;
              if (group.members.length === 1) return <ul key={group.kind} className="divide-y divide-separator/50">{renderRelatedMember(group.members[0]!, group.kind)}</ul>;
              return <details key={group.kind} className="group/related">
                <summary className={`${columnClass} cursor-pointer list-none rounded-md py-2 outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent`}><span className="flex min-w-0 items-center gap-1 sm:col-span-2"><ChevronRight className="size-3.5 shrink-0 group-open/related:rotate-90" aria-hidden />{t(groupLabels[group.kind])} ({group.members.length})</span><span className="break-words text-right tabular-nums">{format.tokens(group.tokens)}</span><span className="break-words text-right tabular-nums">{format.money(group.costUsd, group.knownCostUsd)}</span></summary>
                <ul className="divide-y divide-separator/50 border-y border-separator/70">{group.members.map(member => renderRelatedMember(member))}</ul>
              </details>;
            })}
          </div>}
          {detail.legacyCombined && <div className="space-y-2 rounded-lg bg-surface-secondary p-3 text-xs"><p>{t('usage.detail.legacyThread')}</p><dl className="space-y-2"><DetailValue label={t('usage.detail.thread')} value={`${format.tokens(detail.legacyCombined.tokens)} Token · ${format.money(detail.legacyCombined.costUsd, detail.legacyCombined.knownCostUsd)}`} /><DetailValue label={t('usage.insights.subagent')} value={`${format.tokens(detail.legacyCombined.subagentTokens)} Token · ${format.money(detail.legacyCombined.subagentCostUsd)}`} /></dl></div>}
          {row.insights?.relationConflict && <p className="text-xs text-warning">{t('usage.detail.relationConflict')}</p>}
          <SessionModelBreakdown usage={detail.usage} format={format} pricingModels={detail.pricingModels} />
        </section>

        <section aria-label={t('usage.detail.ownActivity')} className="space-y-4 border-t border-separator pt-4">
          <h2 className="font-semibold">{t('usage.detail.ownActivity')}</h2>
        <section aria-label={t('usage.detail.performance')}>
          <div className="mb-3 flex items-center gap-1"><h3 className="text-xs font-medium">{t('usage.detail.performance')}</h3>
            <HelpPopover title={t('usage.detail.performance')}>
              <p>{t('usage.detail.performanceNote')}</p>
              {performance && <dl className="space-y-2"><DetailValue label={t('usage.insights.speed')} value={`${t('usage.insights.samples')}: ${format.number(performance.estimatedRequestCount)}`} />{performance.estimatedDurationMs != null && <DetailValue label={t('usage.detail.sampleDuration')} value={`${(performance.estimatedDurationMs / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} s`} />}<DetailValue label={t('usage.detail.averageWait')} value={`${t('usage.insights.samples')}: ${format.number(performance.ttftSampleCount)}`} /></dl>}
            </HelpPopover>
          </div>
          {performance?.tokensPerSecond == null && performance?.ttftMs == null ? <p className="text-muted">{t('usage.detail.noSamples')}</p> : <dl className="grid gap-4 sm:grid-cols-2">
            <div><dt className="text-xs text-muted">{t('usage.insights.speed')}</dt><dd className="mt-1 text-lg tabular-nums">{performance?.tokensPerSecond != null ? `≈ ${format.number(performance.tokensPerSecond)} tok/s` : <span className="text-sm text-muted">{t('usage.detail.noSamples')}</span>}</dd></div>
            <div><dt className="text-xs text-muted">{t('usage.detail.averageWait')}</dt><dd className="mt-1 text-lg tabular-nums">{performance?.ttftMs != null ? `${(performance.ttftMs / 1000).toLocaleString(locale, { maximumFractionDigits: 2 })} s` : <span className="text-sm text-muted">{t('usage.detail.noSamples')}</span>}</dd></div>
          </dl>}
        </section>

          <section aria-label={t('usage.detail.activity')} className="space-y-3">
            <div className="flex items-center gap-1"><h3 className="text-xs font-medium">{t('usage.detail.activity')}</h3>
              <HelpPopover title={t('usage.detail.activity')}><p>{t(insight?.signals.coverage === 'unsupported' ? 'usage.detail.unsupported' : insight?.signals.coverage === 'complete' ? 'usage.detail.covered' : 'usage.detail.partialCoverage')}</p><p>{t('usage.insights.evidenceNote')}</p>{missing.length > 0 && <p>{t('usage.detail.notRecordedMetrics')}: {missing.map(metric => t(metric.label)).join('、')}</p>}</HelpPopover>
              {insight && insight.signals.coverage !== 'complete' && <span className="text-xs text-muted">{t('usage.detail.partialActivity')}</span>}
            </div>
            {available.length > 0 && <dl className={`grid grid-cols-2 gap-x-4 gap-y-2 ${available.length > 2 ? 'sm:grid-cols-3' : ''}`}>{available.map(metric => {
              const value = typeof metric.value === 'boolean' ? t(metric.value ? 'usage.detail.signalPresent' : 'usage.detail.signalAbsent') : metric.label === 'usage.insights.costPerEdit' ? format.money(metric.value) : metric.label === 'usage.insights.tokensPerEdit' ? format.tokens(metric.value) : format.number(metric.value);
              return <DetailValue key={metric.label} label={t(metric.label)} value={value} className={value.length > 8 ? 'col-span-2 lg:col-span-1' : undefined} />;
            })}</dl>}
            {!insight && <p className="text-muted">{t('usage.detail.noActivity')}</p>}
          </section>
        </section>
          <section aria-label={t('usage.detail.sessionInfo')} className="space-y-3 border-t border-separator pt-4">
            <h3 className="font-semibold">{t('usage.detail.sessionInfo')}</h3>
            <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
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
        <div className="text-xs"><DetailDisclosure title={t('usage.detail.dataNotes')}><h4 className="font-medium">{t('usage.detail.statisticsRules')}</h4><p>{t('usage.detail.bucketNote')}</p><p>{t('usage.detail.privacy')}</p></DetailDisclosure></div>
      </Modal.Body>
  </>;
}
