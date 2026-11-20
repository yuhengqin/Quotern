import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Card, Chip, Label, ListBox, Modal, Popover, ProgressBar, Select } from '@heroui/react';
import { HelpPopup } from './HelpPopover';
import { Button as AriaButton } from 'react-aria-components';
import { translate, type SupportedLocale } from 'quotern-i18n';
import { localizeQuotaDetail, localizeQuotaPaceDescription, localizeQuotaPaceLabel, localizeQuotaValueText, localizeQuotaWindowLabel } from 'quotern-i18n/quota';
import { useTranslation } from 'quotern-i18n/react';
import { ChevronDown, Copy, RefreshCw } from 'lucide-react';
import type { QuotaAnalysis, QuotaPreferences, QuotaPreferencePatch, QuotaProviderState, QuotaSample, QuotaServiceStatus, QuotaWindow } from 'quotern-core/quota/shared/quota';
import type { SubscriptionChannelId } from 'quotern-core/quota/shared/subscription-channels';
import { SubscriptionBrandIcon } from './SubscriptionBrandIcon';
import { formatSubscriptionResetTime, formatSubscriptionCountdown } from '../lib/subscription-time';
import { commonQuotaResetAt, isQuotaStatusOnly, quotaDisplayDetails, quotaForecasts, quotaTrendWindows, sortQuotaWindows, primaryQuotaWindow } from '../lib/quota-presentation';
import { QuotaServiceDetails } from './QuotaServiceDetails';
import { FilterSelectPopover } from './FilterMenu';
import { QuotaRecoveryActions } from './QuotaRecoveryActions';
import '../i18n/usage-recovery-messages';

const SERVICE_STATUS: Record<QuotaServiceStatus['level'], { dotClassName: string }> = {
  operational: { dotClassName: 'bg-emerald-600 dark:bg-emerald-400' },
  minor: { dotClassName: 'bg-yellow-500 dark:bg-yellow-400' },
  major: { dotClassName: 'bg-orange-500 dark:bg-orange-400' },
  critical: { dotClassName: 'bg-red-600 dark:bg-red-400' },
  maintenance: { dotClassName: 'bg-blue-500 dark:bg-blue-400' },
  unknown: { dotClassName: 'bg-gray-500 dark:bg-gray-400' },
};
const DETAILS_HINT_DELAY_MS = 800;
const QUOTA_SEGMENTS = 12;

function clock(at: number, locale: SupportedLocale) { return new Date(at * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }); }
function queryDate(at: number, locale: SupportedLocale, now = new Date()) {
  const date = new Date(at * 1000);
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })
    : date.toLocaleDateString(locale);
}
function duration(until: number, locale: SupportedLocale) {
  const minutes = Math.max(1, Math.ceil((until - Date.now() / 1000) / 60));
  if (minutes < 60) return translate(locale, 'usage.common.minutes', { count: minutes });
  if (minutes < 1440) return minutes % 60
    ? translate(locale, 'usage.common.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
    : translate(locale, 'usage.common.hours', { count: Math.floor(minutes / 60) });
  return translate(locale, 'usage.common.days', { count: Math.ceil(minutes / 1440) });
}

function quotaSummary(provider: QuotaProviderState, showTrend: boolean, forecasts: Map<string, number>, trendWindows: Set<string>, locale: SupportedLocale) {
  if (provider.stale || provider.status !== 'ready') return null;
  const rows = provider.windows.filter(window => window.analysisEligible !== false)
    .map(window => ({ window, analysis: provider.analyses[window.id] })).filter(row => row.analysis);
  const eta = rows.filter(row => forecasts.has(row.window.id))
    .sort((a, b) => forecasts.get(a.window.id)! - forecasts.get(b.window.id)!)[0];
  const row = eta ?? rows.find(row => row.analysis.paceDifference !== null)
    ?? (showTrend ? rows.find(row => trendWindows.has(row.window.id) && row.analysis.trend.length >= 3) : undefined);
  if (!row) return null;
  const text = eta ? translate(locale, 'usage.quota.forecast', { duration: duration(row.analysis.etaAt!, locale) }) : localizeQuotaPaceLabel(locale, row.analysis) ?? translate(locale, 'usage.quota.trendSixHours');
  return {
    window: row.window, label: localizeQuotaWindowLabel(locale, provider.providerId ?? provider.id, row.window),
    text, warning: Boolean(eta), description: eta ? null : localizeQuotaPaceDescription(locale, row.window, row.analysis),
    trend: showTrend && trendWindows.has(row.window.id) && row.analysis.trend.length >= 3 ? row.analysis.trend : [],
  };
}

export interface QuotaUsageCardProps {
  provider: QuotaProviderState;
  preferences: QuotaPreferences;
  statusRow?: boolean;
  onRefresh: (id: string) => Promise<unknown>;
  onOpenExternal?: (url: string) => unknown;
  onSave?: (patch: QuotaPreferencePatch) => Promise<unknown>;
  summaryOnly?: boolean;
  navigation?: { requestId: string; windowId?: string; handled: boolean };
  onNavigationHandled?: (requestId: string) => void;
  layoutControls?: { handle: ReactNode; menu: ReactNode };
}

function openExternal(url: string) { window.open(url, '_blank', 'noopener,noreferrer'); }

export function QuotaUsageCard({ provider, preferences, statusRow = false, summaryOnly = false, navigation, onNavigationHandled, onRefresh, onSave, layoutControls, onOpenExternal = openExternal }: QuotaUsageCardProps) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  const providerType = provider.providerId ?? provider.id;
  const proof = provider.provenance;
  const [error, setError] = useState<'refreshFailed' | 'saveFailed' | 'serviceSaveFailed' | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => { if (!document.hidden) setNow(new Date()); };
    const timer = window.setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  const dateMode = preferences.resetTimeMode === 'date';
  const creditExpirations = providerType === 'codex' && !provider.stale && provider.status === 'ready'
    ? (provider.resetCreditExpirations ?? []).filter(at => at * 1000 > now.getTime()) : [];
  const apply = async (patch: QuotaPreferencePatch) => {
    if (!onSave || savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setError(null);
    try { await onSave(patch); } catch { setError(patch.serviceComponents ? 'serviceSaveFailed' : 'saveFailed'); } finally { savingRef.current = false; setSaving(false); }
  };
  const [refreshing, setRefreshing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeTarget, setActiveTarget] = useState<{ requestId: string; windowId?: string } | null>(null);
  const openedRequest = useRef<string | null>(null);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const openDatesOnEntry = useRef(false);
  const creditTrigger = useRef<HTMLButtonElement>(null);
  const detailsBody = useRef<HTMLDivElement>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const [hintSource, setHintSource] = useState<'pointer' | 'focus'>('pointer');
  const [hintPosition, setHintPosition] = useState({ left: 0, top: 0 });
  const hintTimer = useRef<number | null>(null);
  const hintRef = useRef<HTMLSpanElement>(null);
  const pointerPosition = useRef({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const hasService = Boolean(provider.service);
  useEffect(() => {
    if (!hasService) setServiceOpen(false);
  }, [hasService]);
  useEffect(() => {
    if (!navigation || navigation.handled || openedRequest.current === navigation.requestId) return;
    openedRequest.current = navigation.requestId;
    openDatesOnEntry.current = false;
    const openService = !navigation.windowId && hasService;
    setActiveTarget(navigation); setServiceOpen(openService); setCreditsOpen(false); setHintVisible(false); setDetailsOpen(!openService);
    onNavigationHandled?.(navigation.requestId);
  }, [navigation, onNavigationHandled, hasService]);
  useEffect(() => {
    if (activeTarget && !navigation) { setActiveTarget(null); setServiceOpen(false); setDetailsOpen(false); }
  }, [activeTarget, navigation]);
  const panelOpen = detailsOpen || (serviceOpen && hasService);
  useEffect(() => {
    if (!panelOpen) return;
    window.dispatchEvent(new CustomEvent('quotern:quota-dialog', { detail: { id: provider.id, open: true } }));
    return () => { window.dispatchEvent(new CustomEvent('quotern:quota-dialog', { detail: { id: provider.id, open: false } })); };
  }, [panelOpen, provider.id]);
  useEffect(() => {
    if (!detailsOpen || (!activeTarget?.windowId && !openDatesOnEntry.current)) return;
    let frame = 0, focused = false;
    const focusTarget = () => {
      const showDates = openDatesOnEntry.current;
      if (focused || (!showDates && !document.hasFocus())) return;
      const element = showDates ? creditTrigger.current : [...(detailsBody.current?.querySelectorAll<HTMLElement>('[data-quota-window]') ?? [])].find(row => row.dataset.quotaWindow === activeTarget?.windowId);
      if (!element) return;
      if (element.closest('[data-entering="true"]')) { frame = requestAnimationFrame(focusTarget); return; }
      element.scrollIntoView({ block: 'nearest' }); element.focus({ preventScroll: true });
      focused = document.activeElement === element;
      // A shortcut opens two layers. Establish the date trigger as the return
      // destination after the outer dialog has mounted its own focus scope.
      if (showDates && focused) { openDatesOnEntry.current = false; setCreditsOpen(true); }
    };
    const scheduleFocus = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { frame = requestAnimationFrame(focusTarget); }); };
    scheduleFocus();
    window.addEventListener('focus', scheduleFocus);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('focus', scheduleFocus); };
  }, [detailsOpen, activeTarget]);
  useEffect(() => () => { if (hintTimer.current !== null) window.clearTimeout(hintTimer.current); }, []);
  useLayoutEffect(() => {
    if (!hintVisible || panelOpen || !hintRef.current || !triggerRef.current?.parentElement) return;
    const card = triggerRef.current.parentElement.getBoundingClientRect();
    const { width, height } = hintRef.current.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const margin = 8, gap = 8;
    let left = card.left + (card.width - width) / 2;
    let top = card.top - height - gap;
    if (hintSource === 'pointer') {
      const { x, y } = pointerPosition.current;
      left = x + 12;
      top = y + 16;
      if (left + width > viewportWidth - margin) left = x - width - 12;
      if (top + height > viewportHeight - margin) top = y - height - 12;
    } else if (top < margin) {
      top = card.bottom + gap;
    }
    setHintPosition({
      left: Math.max(margin, Math.min(left, viewportWidth - width - margin)) - card.left,
      top: Math.max(margin, Math.min(top, viewportHeight - height - margin)) - card.top,
    });
    const dismiss = () => setHintVisible(false);
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('keydown', dismissOnEscape);
    return () => {
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('keydown', dismissOnEscape);
    };
  }, [hintVisible, panelOpen, hintSource]);
  const status = provider.service;
  const serviceLevel = status?.stale ? 'unknown' : status?.level;
  const openIncidents = serviceLevel === 'operational' ? status?.incidents?.length ?? 0 : 0;
  const service = serviceLevel ? {
    ...SERVICE_STATUS[openIncidents ? 'minor' : serviceLevel],
    label: status?.selectionEmpty ? t('usage.quota.noServices') : openIncidents ? t('usage.quota.activeIncidents', { count: openIncidents }) : t(`usage.quota.service.${serviceLevel}`),
  } : null;
  const serviceWarning = status && !status.stale && (openIncidents || !['operational', 'unknown'].includes(status.level)) ? service : null;
  const severeServiceWarning = serviceWarning && (status?.level === 'major' || status?.level === 'critical') ? serviceWarning : null;
  const hasReading = provider.windows.length > 0 || provider.details.length > 0;
  const compact = isQuotaStatusOnly(provider);
  const grouped = compact && statusRow;
  const headerService = grouped ? serviceWarning : service;
  const resetCredits = compact ? null : provider.resetCredits;
  const resetCreditLabel = resetCredits !== null ? t('usage.quota.resetCredits', { count: resetCredits }) : undefined;
  const planSummary = grouped ? '' : [provider.planLabel, providerType !== 'codex' ? resetCreditLabel : undefined].filter(Boolean).join(' · ');
  const preferredWindow = preferences.preferredWindows?.[provider.id];
  const primary = primaryQuotaWindow(provider, preferredWindow, now.getTime() / 1000);
  const risk = primaryQuotaWindow(provider, undefined, now.getTime() / 1000);
  const windows = [...new Set([primary, risk, ...sortQuotaWindows(provider.windows)].filter((window): window is QuotaWindow => window !== null))];
  const visibleWindows = windows.slice(0, summaryOnly ? 1 : 3);
  const details = quotaDisplayDetails(providerType, provider.details);
  const forecasts = quotaForecasts(providerType, provider.windows, provider.analyses, Date.now() / 1000);
  const trendWindows = quotaTrendWindows(providerType, provider.windows);
  const summary = quotaSummary(provider, preferences.showSparkline, forecasts, trendWindows, locale);
  const summaryInWindow = visibleWindows.some(window => window.id === summary?.window.id);
  const showSecondaryRisk = summaryOnly && risk && risk.id !== primary?.id && risk.usedPercent >= 70
    && !(summary?.warning && summary.window.id === risk.id);
  const summaryLine = summary && (!summaryOnly || summary.warning) && <div data-quota-summary className="flex min-w-0 items-center gap-2" title={t('usage.quota.summaryTitle', { window: summary.label, description: summary.description ?? summary.text })}>
    {!summary.warning && summary.trend.length >= 3 && <QuotaTrendPreview samples={summary.trend} />}
    <p className={`min-w-0 text-xs ${summary.warning ? 'text-amber-700 dark:text-amber-400' : 'text-muted'}`}>
      {!summaryInWindow && `${summary.label} · `}
      {!summaryInWindow && summary.warning && `${t('usage.quota.remaining', { percent: Math.round(100 - summary.window.usedPercent) })} · `}
      {summary.text}
    </p>
  </div>;
  const commonReset = commonQuotaResetAt(provider.windows);
  const message = provider.status === 'custom-provider' ? t('usage.quota.customProvider')
    : provider.status === 'expired' ? t('usage.quota.expired')
      : provider.stale ? t('usage.quota.stale')
        : provider.message ? locale === 'zh-CN' ? provider.message : t('usage.quota.noReading')
          : compact ? t('usage.quota.noReading') : null;
  const errorMessage = error ? t(error === 'refreshFailed' ? 'usage.quota.refreshFailed' : 'usage.quota.saveFailed') : null;
  const retryable = ['unavailable', 'temporarily-unavailable'].includes(provider.status) || (provider.stale && provider.status === 'ready');
  const busy = provider.refreshing || refreshing;
  const observedAt = proof?.observedAt ?? provider.fetchedAt;
  const refresh = async () => {
    try { setError(null); setRefreshing(true); await onRefresh(provider.id); }
    catch { setError('refreshFailed'); }
    finally { setRefreshing(false); }
  };
  const hasSelectedText = (card: HTMLElement) => {
    const selection = window.getSelection();
    return selection && !selection.isCollapsed
      && ((selection.anchorNode && card.contains(selection.anchorNode)) || (selection.focusNode && card.contains(selection.focusNode)));
  };
  const hideHint = () => {
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    hintTimer.current = null;
    setHintVisible(false);
  };
  const openDetails = (section: 'quota' | 'credits' | 'service' = 'quota', trigger = triggerRef.current) => {
    if (layoutControls) return;
    trigger?.focus({ preventScroll: true });
    hideHint();
    setServiceOpen(section === 'service');
    openDatesOnEntry.current = section === 'credits';
    setCreditsOpen(false);
    setActiveTarget(null);
    setDetailsOpen(section !== 'service');
  };
  const toggleResetTime = onSave ? () => {
    hideHint();
    void apply({ resetTimeMode: dateMode ? 'countdown' : 'date' });
  } : undefined;
  const sharedReset = commonReset === null ? null : <QuotaCommonResetTime at={commonReset} now={now} dateMode={dateMode} onToggle={toggleResetTime} saving={saving} />;
  const showCredits = providerType === 'codex' && (provider.resetCredits !== null || creditExpirations.length > 0);
  const hasCreditDates = (provider.resetCredits ?? 0) > 0 || creditExpirations.length > 0;
  const creditLabel = provider.resetCredits === null ? t('credits.expirations') : t('usage.quota.resetCredits', { count: provider.resetCredits });
  const creditCount = provider.resetCredits === null ? t('credits.expirations') : `x${provider.resetCredits}`;
  const creditBadge = showCredits && (hasCreditDates
    ? <Popover isOpen={creditsOpen} onOpenChange={setCreditsOpen}>
      <AriaButton ref={creditTrigger} type="button" data-quota-detail-credits aria-label={provider.resetCredits === null ? creditLabel : `${creditLabel} · ${t('credits.expirations')}`}
        className="inline-flex min-h-7 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-default px-2 text-xs font-medium text-foreground tabular-nums hover:bg-foreground/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <Copy aria-hidden="true" className="size-3.5" /><span title={creditLabel}>{creditCount}</span><ChevronDown aria-hidden="true" className={`size-3 ${creditsOpen ? 'rotate-180' : ''}`} />
      </AriaButton>
      <Popover.Content placement="bottom start" offset={6} maxHeight={280} className="w-max max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-xl border border-separator bg-overlay">
        <Popover.Dialog data-quota-credit-dates className="space-y-2 px-3.5 py-3 text-xs">
          <Popover.Heading className="text-xs font-medium text-muted">{t('credits.expirations')}</Popover.Heading>
          {creditExpirations.length > 0 && <ul className="space-y-1.5 tabular-nums text-foreground">{creditExpirations.map((at, index) => {
            const expiry = new Date(at * 1000);
            return <li key={`${at}:${index}`}><time dateTime={expiry.toISOString()}>{expiry.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</time></li>;
          })}</ul>}
          {(provider.resetCredits ?? 0) > creditExpirations.length && <p className="max-w-64 text-muted">{t(creditExpirations.length ? 'credits.someExpiryUnavailable' : 'credits.expiryUnavailable')}</p>}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
    : <span data-quota-detail-credits role="img" aria-label={creditLabel} title={creditLabel} className="inline-flex items-center gap-1 rounded-full bg-default px-2 py-1 text-xs tabular-nums"><Copy aria-hidden="true" className="size-3.5" />{creditCount}</span>);
  const serviceDetails = status && service && <QuotaServiceDetails providerLabel={provider.label} status={status} statusLabel={service.label} dotClassName={service.dotClassName}
    showSummary={detailsOpen} isOpen={serviceOpen && (!activeTarget || Boolean(navigation))} onOpenChange={setServiceOpen}
    selected={preferences.serviceComponents?.[providerType as SubscriptionChannelId]} saving={saving} saveError={error === 'serviceSaveFailed' ? errorMessage ?? undefined : undefined}
    onSelect={onSave ? ids => void apply({ serviceComponents: { [providerType]: ids } }) : undefined} onOpenExternal={onOpenExternal} />;
  return <>
    <Card data-quota-card={provider.id} data-quota-compact={compact} data-quota-status-row={grouped} className="group relative min-w-0 cursor-pointer overflow-visible p-0 transition-[background-color,box-shadow] data-[quota-compact=true]:self-start data-[quota-status-row=true]:rounded-xl data-[quota-status-row=true]:shadow-none hover:bg-accent/5 hover:ring-1 hover:ring-accent/25 active:bg-accent/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent motion-reduce:transition-none" variant={grouped ? 'transparent' : 'secondary'}
      onPointerEnter={event => {
        if (event.pointerType === 'touch' || panelOpen || layoutControls) return;
        hideHint();
        setHintSource('pointer');
        pointerPosition.current = { x: event.clientX, y: event.clientY };
        hintTimer.current = window.setTimeout(() => { hintTimer.current = null; setHintVisible(true); }, DETAILS_HINT_DELAY_MS);
      }}
      onPointerMove={event => { if (!hintVisible) pointerPosition.current = { x: event.clientX, y: event.clientY }; }}
      onPointerLeave={hideHint}
      onClick={event => {
        if (layoutControls) return;
        const target = event.target as Element;
        if (target.closest('button, a, input, select, textarea, [role="button"], [role="link"]') || hasSelectedText(event.currentTarget)) return;
        openDetails();
      }}>
    {!layoutControls && <AriaButton ref={triggerRef} type="button" aria-label={t('usage.quota.detailsAria', { provider: provider.label })} aria-haspopup="dialog" aria-expanded={detailsOpen} aria-describedby={hintId}
      className="peer absolute inset-0 cursor-pointer rounded-[inherit] outline-none"
      onFocus={event => { if (event.target.matches(':focus-visible')) { hideHint(); setHintSource('focus'); setHintVisible(true); } }} onBlur={hideHint}
      onPress={event => { if (event.pointerType === 'keyboard' || event.pointerType === 'virtual' || !hasSelectedText(triggerRef.current!.parentElement!)) openDetails(); }} />}
    <Card.Content className={`relative ${grouped ? 'flex-row flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2' : compact || preferences.compact || summaryOnly ? 'gap-1.5 px-3 py-2' : 'gap-3 p-4'}`}>
      <div className={`grid min-w-0 items-start gap-x-2 ${headerService || layoutControls ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1'} ${grouped ? 'shrink-0' : ''}`}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="flex min-w-0 max-w-full items-center gap-2">
            {layoutControls?.handle}
            <SubscriptionBrandIcon brand={providerType as Parameters<typeof SubscriptionBrandIcon>[0]['brand']} />
            <span className={`min-w-0 truncate text-sm font-medium ${grouped ? 'max-w-24' : ''}`}>{provider.label}</span>
          </div>
          {!summaryOnly && (planSummary || (providerType === 'codex' && resetCredits !== null)) && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-1">
            {planSummary && <Chip size="sm" variant="soft" className="min-w-0 max-w-full bg-foreground/8 text-foreground" title={planSummary}><Chip.Label className="truncate">{planSummary}</Chip.Label></Chip>}
            {providerType === 'codex' && resetCredits !== null && (hasCreditDates && !layoutControls
              ? <button type="button" data-quota-reset-credits data-quota-action aria-label={resetCreditLabel} title={resetCreditLabel} aria-haspopup="dialog" className="inline-flex min-h-6 shrink-0 cursor-pointer items-center rounded-full text-[11px] leading-4 tabular-nums focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={event => openDetails('credits', event.currentTarget)}>
                  <span className="inline-flex items-center gap-1 rounded-full bg-foreground/8 px-1.5 text-foreground/70"><Copy aria-hidden="true" className="size-3" />x{resetCredits}</span>
                </button>
              : <Chip data-quota-reset-credits role="img" aria-label={resetCreditLabel} title={resetCreditLabel} size="sm" variant="soft" className="h-4.5 shrink-0 gap-1 rounded-full bg-foreground/8 px-1.5 text-[11px] leading-4 text-foreground/70 tabular-nums">
              <Copy aria-hidden="true" className="size-3" />
              <Chip.Label>x{resetCredits}</Chip.Label>
            </Chip>)}
          </div>}
        </div>
        {(headerService || layoutControls) && <div className="flex items-center gap-1">{status && headerService && (layoutControls ? <span role="img" aria-label={headerService.label} className={`size-2 shrink-0 rounded-full ${headerService.dotClassName}`} /> : <QuotaServiceStatusLink label={provider.label} status={status} service={headerService} onOpen={trigger => openDetails('service', trigger)} iconOnly />)}{layoutControls?.menu}</div>}
      </div>
      {proof?.identityVerified && proof.accountRef && <p className="text-xs text-muted">{t('usage.profiles.accountId', { id: proof.accountRef.slice(0, 8) })}</p>}
      {provider.provenance?.source === 'omp' && <p className="text-[10px] text-muted">{t('usage.quota.ompRecord', { date: provider.provenance.observedAt ? queryDate(provider.provenance.observedAt, locale) : t('usage.quota.timeUnknown') })}{provider.provenance.identityVerified ? '' : ` · ${t('usage.quota.identityUnverified')}`}</p>}
      {hasReading && <div className={`flex flex-col ${preferences.compact ? 'gap-1.5' : 'gap-3'}`}>
        {visibleWindows.map((window, index) => <QuotaWindowRow key={window.id} providerId={providerType} window={window} analysis={provider.analyses[window.id]} stale={provider.stale || provider.status !== 'ready'} hideReset={commonReset !== null} sharedReset={index === 0 ? sharedReset : null} now={now} dateMode={dateMode} onToggleResetTime={toggleResetTime} saving={saving}>
          {window.id === summary?.window.id && summaryLine}
        </QuotaWindowRow>)}
        {(!summaryOnly || !windows.length) && details.map(detail => { const localized = localizeQuotaDetail(locale, detail); return <div key={detail.id} className="flex justify-between gap-2 text-xs"><span className="text-muted">{localized.label}</span><span>{localized.text}</span></div>; })}
      </div>}
      {showSecondaryRisk && <p className="text-xs text-warning">{localizeQuotaWindowLabel(locale, providerType, risk)} · {t('usage.quota.remaining', { percent: Math.round(100 - risk.usedPercent) })}</p>}
      {!summaryInWindow && summaryLine}
      {(message || error) && <div className={`flex items-center justify-between gap-2 ${grouped ? 'min-w-0 flex-1' : compact ? 'min-h-8' : ''}`}>
        <p role="status" className={`text-xs text-muted ${grouped ? 'truncate' : ''}`} title={grouped ? errorMessage ?? message ?? undefined : undefined}>{errorMessage ?? message}</p>
        {(retryable || error === 'refreshFailed') && <Button data-quota-action data-quota-retry aria-label={t('usage.quota.retryAria', { provider: provider.label })} className="h-auto min-h-7 shrink-0 px-2" size="sm" variant="tertiary" isDisabled={busy} onPress={() => void refresh()}>{busy ? t('usage.quota.retrying') : t('usage.quota.retry')}</Button>}
      </div>}
      {severeServiceWarning && <p role="status" className={`flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 ${grouped ? 'w-full' : ''}`}>
        {t('usage.quota.officialService', { status: severeServiceWarning.label })}
      </p>}
      {provider.windows.length > (summaryOnly ? 1 : 3) && <span className="text-[10px] text-muted">{t('usage.quota.moreWindows', { count: provider.windows.length - (summaryOnly ? 1 : 3) })}</span>}
    </Card.Content>
    <span ref={hintRef} id={hintId} role="tooltip" style={hintPosition} className={`pointer-events-none absolute z-20 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-sm transition-opacity duration-150 group-has-[[data-quota-action]:hover]:hidden group-has-[[data-quota-action]:focus-visible]:hidden motion-reduce:transition-none ${hintVisible && !panelOpen && !layoutControls ? 'visible opacity-100' : 'invisible opacity-0'}`}>{t('usage.quota.openDetails')}</span>
    </Card>
    <Modal.Backdrop isOpen={detailsOpen && (!activeTarget || Boolean(navigation))} onOpenChange={setDetailsOpen}>
      <Modal.Container placement="center" scroll="inside">
        <Modal.Dialog aria-label={t('usage.quota.details', { provider: provider.label })} className="w-full max-w-xl">
          <Modal.CloseTrigger aria-label={t('usage.quota.closeDetails')} />
          <Modal.Header className="gap-1.5">
            <Modal.Heading>{t('usage.quota.details', { provider: provider.label })}</Modal.Heading>
            {(provider.planLabel || proof?.identityVerified && proof.accountRef) && <p className="text-xs text-muted">
              {[provider.planLabel, proof?.identityVerified && proof.accountRef ? t('usage.profiles.accountId', { id: proof.accountRef.slice(0, 8) }) : null].filter(Boolean).join(' · ')}
            </p>}
          </Modal.Header>
          <Modal.Body ref={detailsBody} className="flex flex-col gap-4">
            {activeTarget?.windowId && !windows.some(window => window.id === activeTarget.windowId) && <p role="status" className="text-sm text-warning">{t('island.quota.windowUnavailable')}</p>}
            {windows.map((window, index) => <QuotaWindowRow key={window.id} providerId={providerType} window={window} analysis={provider.analyses[window.id]} etaAt={forecasts.get(window.id)} showSparkline={preferences.showSparkline && trendWindows.has(window.id)} stale={provider.stale || provider.status !== 'ready'} hideReset={commonReset !== null} sharedReset={index === 0 ? sharedReset : null} now={now} dateMode={dateMode} onToggleResetTime={toggleResetTime} saving={saving} detailed primary={index === 0} highlighted={activeTarget?.windowId === window.id} creditBadge={index === 0 ? creditBadge : null} />)}
            {!windows.length && showCredits && <div>{creditBadge}</div>}
            {providerType !== 'codex' && provider.resetCredits !== null && <p className="text-sm">{t('usage.quota.resetCredits', { count: provider.resetCredits })}</p>}
            {details.map(detail => { const localized = localizeQuotaDetail(locale, detail); return <div key={detail.id} className="flex justify-between gap-3 text-sm"><span className="text-muted">{localized.label}</span><span>{localized.text}</span></div>; })}
            {(message || error) && <p role="status" className="text-sm text-muted">{errorMessage ?? message}</p>}
            {compact && provider.status === 'expired' && <p className="text-xs text-muted">{t('usage.quota.signIn', { provider: provider.label })}</p>}
            {compact && provider.status === 'custom-provider' && <p className="text-xs text-muted">{t('usage.quota.customModelNote')}</p>}
            <QuotaRecoveryActions provider={provider} preferences={preferences} />
            {onSave && windows.length > 1 && <Select aria-label={t('island.quota.preferredWindow')} value={windows.some(window => window.id === preferredWindow) ? `window:${preferredWindow}` : 'automatic'} aria-busy={saving}
              onChange={key => { if (key !== null) void apply({ preferredWindows: { [provider.id]: String(key).startsWith('window:') ? String(key).slice(7) : '' } }); }}>
              <Label>{t('island.quota.preferredWindow')}</Label><Select.Trigger aria-disabled={saving}><Select.Value /><Select.Indicator /></Select.Trigger>
              <FilterSelectPopover><ListBox><ListBox.Item id="automatic" textValue={t('island.quota.automatic')}>{t('island.quota.automatic')}<ListBox.ItemIndicator /></ListBox.Item>
                {sortQuotaWindows(provider.windows).map(window => <ListBox.Item key={window.id} id={`window:${window.id}`} textValue={localizeQuotaWindowLabel(locale, providerType, window)}><span className="whitespace-normal break-words">{localizeQuotaWindowLabel(locale, providerType, window)}</span><ListBox.ItemIndicator /></ListBox.Item>)}
              </ListBox></FilterSelectPopover>
            </Select>}
            {providerType === 'claude' && <Button size="sm" variant="tertiary" className="w-fit" onPress={() => void onOpenExternal('https://claude.ai/settings/usage')}>{t('usage.quota.claudeUsage')} ↗</Button>}
            {detailsOpen && serviceDetails}
          </Modal.Body>
          <Modal.Footer className="flex-wrap items-center justify-between gap-2">
            {observedAt != null && <time dateTime={new Date(observedAt * 1000).toISOString()} title={new Date(observedAt * 1000).toLocaleString(locale)} className="text-xs text-muted tabular-nums">{t('usage.quota.updatedAt', { time: queryDate(observedAt, locale, now) })}</time>}
            <Button aria-label={t('usage.quota.refreshAria', { provider: provider.label })} className="ml-auto w-fit" size="sm" variant="secondary" isDisabled={busy} onPress={() => void refresh()}>
              <RefreshCw aria-hidden="true" className={`size-3.5 ${busy ? 'motion-safe:animate-spin' : ''}`} />{busy ? t('usage.quota.refreshing') : t('usage.quota.refresh')}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
    {!detailsOpen && serviceDetails}
  </>;
}

function QuotaServiceStatusLink({ label, status, service, onOpen, iconOnly = false }: { label: string; status: QuotaServiceStatus; service: typeof SERVICE_STATUS[QuotaServiceStatus['level']] & { label: string }; onOpen: (trigger: HTMLButtonElement) => void; iconOnly?: boolean }) {
  const { t } = useTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return <HelpPopup title={t('usage.quota.overallStatus', { status: service.label })} isOpen={open} onOpenChange={setOpen} trigger={<Button size="sm" variant="tertiary" isIconOnly={iconOnly}
      ref={trigger} data-quota-action data-quota-service-trigger aria-haspopup="dialog"
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm text-xs text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${iconOnly ? 'size-6 min-w-6 p-0' : 'h-auto min-h-6 w-fit px-0'}`}
      aria-label={t('usage.quota.statusAria', { provider: label, status: service.label })}
      onPress={() => { setOpen(false); if (trigger.current) onOpen(trigger.current); }}>
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${service.dotClassName}`} />
      {!iconOnly && <><span>{service.label}</span><span aria-hidden="true">↗</span></>}
    </Button>}>
      <div className="flex flex-col gap-1">
        <p className="text-muted">{t('usage.quota.statusNote')}</p>
        {status.stale && <p className="text-muted">{t('usage.quota.statusStale')}</p>}
      </div>
  </HelpPopup>;
}

function QuotaResetTime({ text, absolute, dateMode, onToggle, saving }: { text: string; absolute?: string; dateMode: boolean; onToggle?: () => void; saving?: boolean }) {
  const { t } = useTranslation();
  const action = t(dateMode ? 'usage.quota.timeToCountdown' : 'usage.quota.timeToDate');
  if (!onToggle) return <span className="text-xs tabular-nums text-muted" title={absolute}>{text}</span>;
  return <HelpPopup title={absolute ?? text} trigger={<AriaButton type="button" data-quota-action data-quota-reset-time aria-label={`${text} · ${action}`} aria-disabled={saving} aria-busy={saving}
      className="relative min-h-6 w-fit max-w-full cursor-pointer rounded-sm text-end text-xs tabular-nums text-muted underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground hover:decoration-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-wait motion-reduce:transition-none"
      onPress={() => { if (!saving) onToggle(); }}>{text}</AriaButton>}>
    <p>{action}</p>
  </HelpPopup>;
}

function QuotaCommonResetTime({ at, now, dateMode, onToggle, saving }: { at: number; now: Date; dateMode: boolean; onToggle?: () => void; saving?: boolean }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  const time = dateMode ? formatSubscriptionResetTime(at, now, false, locale) : formatSubscriptionCountdown(at, now, locale);
  const text = !dateMode && at <= now.getTime() / 1000 ? time : t(dateMode ? 'usage.quota.commonReset' : 'usage.quota.commonResetsIn', { time });
  return <span data-quota-common-reset><QuotaResetTime text={text!} absolute={formatSubscriptionResetTime(at, now, true, locale) ?? undefined} dateMode={dateMode} onToggle={onToggle} saving={saving} /></span>;
}

function QuotaWindowRow({ providerId, window, analysis, etaAt, showSparkline = false, stale, detailed = false, primary = false, highlighted = false, hideReset = false, sharedReset, creditBadge, now, dateMode, onToggleResetTime, saving, children }: { providerId: string; window: QuotaWindow; analysis?: QuotaAnalysis; etaAt?: number; showSparkline?: boolean; stale: boolean; detailed?: boolean; primary?: boolean; highlighted?: boolean; hideReset?: boolean; sharedReset?: ReactNode; creditBadge?: ReactNode; now: Date; dateMode: boolean; onToggleResetTime?: () => void; saving?: boolean; children?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  const label = localizeQuotaWindowLabel(locale, providerId, window);
  const reset = hideReset ? null : dateMode ? formatSubscriptionResetTime(window.resetsAt, now, false, locale) : formatSubscriptionCountdown(window.resetsAt, now, locale);
  const paceText = analysis ? localizeQuotaPaceLabel(locale, analysis) : null;
  const remaining = 100 - window.usedPercent;
  const amount = window.valueText ? localizeQuotaValueText(locale, window.valueText) : `${Math.round(remaining)}%`;
  const value = window.valueText ? amount : t('usage.quota.remaining', { percent: Math.round(remaining) });
  const [prefix, suffix] = value.split(amount);
  const color = window.usedPercent >= 90 ? 'light-dark(#c32232, #ff6974)'
    : window.usedPercent >= 70 ? 'light-dark(#a55200, #ffb347)'
      : 'var(--accent)';
  const expiry = window.timeKind === 'expiry';
  const resetText = !reset ? null : dateMode ? `${reset} ${t(expiry ? 'usage.quota.expiry' : detailed ? 'usage.quota.autoReset' : 'usage.quota.reset')}`
    : window.resetsAt! <= now.getTime() / 1000 ? (expiry ? t('usage.quota.expiredAt') : reset)
      : t(expiry ? 'usage.quota.expiresIn' : detailed ? 'usage.quota.autoResetsIn' : 'usage.quota.resetsIn', { time: reset });
  const resetControl = sharedReset ?? (resetText && <QuotaResetTime text={resetText}
    absolute={formatSubscriptionResetTime(window.resetsAt, now, true, locale) ?? undefined}
    dateMode={dateMode} onToggle={onToggleResetTime} saving={saving} />);
  return <div data-quota-window={detailed ? window.id : undefined} tabIndex={detailed ? -1 : undefined} className={`flex min-w-0 flex-col ${detailed ? 'gap-2' : 'gap-1'} rounded-md outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent ${highlighted ? 'bg-accent/5 ring-2 ring-accent/40' : ''}`}>
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <div className={`min-w-0 max-w-full break-words ${detailed ? 'flex flex-wrap items-baseline gap-x-2 text-sm text-foreground' : 'text-muted'}`}>
        {label}{!detailed && <span aria-hidden="true"> · </span>}<span data-quota-remaining className="whitespace-nowrap text-xs font-normal text-muted">{prefix}<span data-quota-window-value className={`font-semibold tabular-nums ${primary ? 'text-2xl' : detailed ? 'text-lg' : ''}`} style={{ color }}>{amount}</span>{suffix}</span>
      </div>
      {creditBadge}
      {resetControl && <div className="ml-auto min-w-0 max-w-full text-end">{resetControl}</div>}
    </div>
    <div className="flex min-w-0 items-center gap-3">
      <ProgressBar aria-label={`${label}: ${value}`} className="min-w-0 flex-1" value={remaining} size="sm"
        style={{ color, gap: 0, gridTemplateAreas: '"track"', gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'auto' }}>
        <ProgressBar.Track className="grid h-1.5 grid-cols-12 gap-0.5 rounded-none bg-transparent">
          {Array.from({ length: QUOTA_SEGMENTS }, (_, index) => {
            const fill = Math.max(0, Math.min(100, remaining * QUOTA_SEGMENTS - index * 100));
            return <span key={index} data-quota-segment aria-hidden="true" className="h-full overflow-hidden rounded-full bg-foreground/10">
              <span className="block h-full rounded-full bg-current motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${fill}%` }} />
            </span>;
          })}
        </ProgressBar.Track>
      </ProgressBar>
    </div>
    {detailed && window.used !== undefined && window.limit !== undefined && <p className="text-[10px] text-muted">{window.used.toLocaleString(locale)} / {window.limit.toLocaleString(locale)} {window.unit === 'requests' ? t('usage.quota.requestUnit') : window.unit === 'credits' ? t('usage.quota.creditUnit') : 'Token'}</p>}
    {detailed && !stale && paceText && <p className="text-xs text-muted" title={localizeQuotaPaceDescription(locale, window, analysis!) ?? undefined}>{paceText}</p>}
    {detailed && !stale && etaAt && <p data-quota-forecast className="text-xs text-amber-700 dark:text-amber-400">{t('usage.quota.forecast', { duration: duration(etaAt, locale) })}</p>}
    {detailed && showSparkline && analysis && analysis.trend.length >= 3 && <QuotaSparkline samples={analysis.trend} label={label} />}
    {children}
  </div>;
}

function QuotaTrendPreview({ samples }: { samples: QuotaSample[] }) {
  const first = samples[0].at, span = Math.max(1, samples.at(-1)!.at - first);
  return <svg aria-hidden="true" viewBox="0 0 64 16" className="h-4 w-16 shrink-0 text-accent">
    <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={samples.map(sample => `${2 + (sample.at - first) / span * 60},${2 + sample.usedPercent / 100 * 12}`).join(' ')} />
  </svg>;
}

function QuotaSparkline({ samples, label }: { samples: QuotaSample[]; label: string }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  const [selected, setSelected] = useState<number | null>(null);
  const first = samples[0].at, span = Math.max(1, samples.at(-1)!.at - first);
  const point = selected === null ? null : samples[Math.min(selected, samples.length - 1)];
  return <div className="flex min-h-9 items-center gap-2">
    <svg role="img" aria-label={t('usage.quota.sparklineAria', { label })} tabIndex={0} viewBox="0 0 160 36" className="h-9 w-40 shrink-0 rounded text-accent outline-offset-2 focus-visible:outline-2"
      onPointerMove={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const at = first + Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))) * span;
        const nearest = samples.reduce((best, sample, i) => Math.abs(sample.at - at) < Math.abs(samples[best].at - at) ? i : best, 0);
        setSelected(nearest);
      }} onPointerLeave={() => setSelected(null)} onFocus={() => setSelected(samples.length - 1)} onBlur={() => setSelected(null)}
      onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSelected(index => Math.max(0, Math.min(samples.length - 1, (index ?? samples.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1)))); } }}>
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={samples.map(sample => `${3 + (sample.at - first) / span * 154},${3 + sample.usedPercent / 100 * 30}`).join(' ')} />
      {point && <circle fill="currentColor" cx={3 + (point.at - first) / span * 154} cy={3 + point.usedPercent / 100 * 30} r="2.5" />}
    </svg>
    <span className="min-w-0 truncate text-[10px] tabular-nums text-muted">{point ? t('usage.quota.sparklinePoint', { time: clock(point.at, locale), percent: Math.round(100 - point.usedPercent) }) : t('usage.quota.sparklineRange')}</span>
  </div>;
}
