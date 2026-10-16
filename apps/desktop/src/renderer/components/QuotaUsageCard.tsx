import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button, Card, Chip, Modal, ProgressBar, Tooltip } from '@heroui/react';
import { Button as AriaButton } from 'react-aria-components';
import { RefreshCw } from 'lucide-react';
import type { QuotaAnalysis, QuotaPreferences, QuotaProviderState, QuotaSample, QuotaServiceStatus, QuotaWindow } from '../../shared/quota';
import { SubscriptionBrandIcon } from './SubscriptionBrandIcon';
import { formatSubscriptionResetTime } from './SubscriptionUsageCard';
import { commonQuotaResetAt, isQuotaStatusOnly, quotaDisplayDetails, quotaForecasts, quotaPaceDescription, quotaPaceLabel, quotaTrendWindows, quotaWindowLabel, sortQuotaWindows } from '../lib/quota-presentation';

const SERVICE_STATUS: Record<QuotaServiceStatus['level'], { label: string; dotClassName: string }> = {
  operational: { label: '服务正常', dotClassName: 'bg-emerald-600 dark:bg-emerald-400' },
  minor: { label: '轻微异常', dotClassName: 'bg-yellow-500 dark:bg-yellow-400' },
  major: { label: '严重异常', dotClassName: 'bg-orange-500 dark:bg-orange-400' },
  critical: { label: '重大故障', dotClassName: 'bg-red-600 dark:bg-red-400' },
  maintenance: { label: '维护中', dotClassName: 'bg-blue-500 dark:bg-blue-400' },
  unknown: { label: '状态未确认', dotClassName: 'bg-gray-500 dark:bg-gray-400' },
};
const DETAILS_HINT_DELAY_MS = 800;

function clock(at: number) { return new Date(at * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }
function queryDate(at: number, now = new Date()) {
  const date = new Date(at * 1000);
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : date.toLocaleDateString('zh-CN');
}
function duration(until: number) {
  const minutes = Math.max(1, Math.ceil((until - Date.now() / 1000) / 60));
  return minutes < 60 ? `${minutes} 分钟` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}` : `${Math.ceil(minutes / 1440)} 天`;
}

function quotaSummary(provider: QuotaProviderState, showTrend: boolean, forecasts: Map<string, number>, trendWindows: Set<string>) {
  if (provider.stale || provider.status !== 'ready') return null;
  const rows = provider.windows.filter(window => window.analysisEligible !== false)
    .map(window => ({ window, analysis: provider.analyses[window.id] })).filter(row => row.analysis);
  const eta = rows.filter(row => forecasts.has(row.window.id))
    .sort((a, b) => forecasts.get(a.window.id)! - forecasts.get(b.window.id)!)[0];
  const row = eta ?? rows.find(row => row.analysis.paceDifference !== null)
    ?? (showTrend ? rows.find(row => trendWindows.has(row.window.id) && row.analysis.trend.length >= 3) : undefined);
  if (!row) return null;
  const text = eta ? `预计约 ${duration(row.analysis.etaAt!)}后耗尽` : quotaPaceLabel(row.analysis) ?? '最近 6 小时额度趋势';
  return { text, label: quotaWindowLabel(provider.id, row.window), description: eta ? null : quotaPaceDescription(row.window, row.analysis), warning: Boolean(eta), trend: showTrend && trendWindows.has(row.window.id) && row.analysis.trend.length >= 3 ? row.analysis.trend : [] };
}

export function QuotaUsageCard({ provider, preferences, statusRow = false }: { provider: QuotaProviderState; preferences: QuotaPreferences; statusRow?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const [hintSource, setHintSource] = useState<'pointer' | 'focus'>('pointer');
  const [hintPosition, setHintPosition] = useState({ left: 0, top: 0 });
  const hintTimer = useRef<number | null>(null);
  const hintRef = useRef<HTMLSpanElement>(null);
  const pointerPosition = useRef({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  useEffect(() => () => { if (hintTimer.current !== null) window.clearTimeout(hintTimer.current); }, []);
  useLayoutEffect(() => {
    if (!hintVisible || detailsOpen || !hintRef.current || !triggerRef.current?.parentElement) return;
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
  }, [hintVisible, detailsOpen, hintSource]);
  const status = provider.service;
  const service = status ? SERVICE_STATUS[status.stale ? 'unknown' : status.level] : null;
  const serviceWarning = status && !status.stale && !['operational', 'unknown'].includes(status.level) ? service : null;
  const severeServiceWarning = serviceWarning && (status?.level === 'major' || status?.level === 'critical') ? serviceWarning : null;
  const hasReading = provider.windows.length > 0 || provider.details.length > 0;
  const compact = isQuotaStatusOnly(provider);
  const grouped = compact && statusRow;
  const headerService = grouped ? serviceWarning : service;
  const planSummary = grouped ? '' : [provider.planLabel, !compact && provider.resetCredits !== null ? `可重置 ${provider.resetCredits} 次` : null].filter(Boolean).join(' · ');
  const windows = sortQuotaWindows(provider.windows);
  const details = quotaDisplayDetails(provider.id, provider.details);
  const forecasts = quotaForecasts(provider.id, provider.windows, provider.analyses, Date.now() / 1000);
  const trendWindows = quotaTrendWindows(provider.id, provider.windows);
  const summary = quotaSummary(provider, preferences.showSparkline, forecasts, trendWindows);
  const commonReset = commonQuotaResetAt(provider.windows);
  const message = provider.status === 'custom-provider' ? '自定义模型无法获取配额'
    : provider.status === 'expired' ? '登录已过期，请重新登录'
      : provider.stale ? '读数可能已过期'
        : provider.message ?? (compact ? '暂未提供可展示的额度读数' : null);
  const retryable = ['unavailable', 'temporarily-unavailable'].includes(provider.status) || (provider.stale && provider.status === 'ready');
  const busy = provider.refreshing || refreshing;
  const lastQuery = provider.queriedAt ?? provider.fetchedAt;
  const refresh = async () => {
    try { setError(null); setRefreshing(true); await window.tud.quota.refresh(provider.id); }
    catch { setError('刷新失败，请稍后重试'); }
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
  const openDetails = () => {
    triggerRef.current?.focus({ preventScroll: true });
    hideHint();
    setDetailsOpen(true);
  };
  return <>
    <Card data-quota-card={provider.id} data-quota-compact={compact} data-quota-status-row={grouped} className="group relative min-w-0 cursor-pointer overflow-visible p-0 transition-[background-color,box-shadow] data-[quota-compact=true]:self-start data-[quota-status-row=true]:rounded-xl data-[quota-status-row=true]:shadow-none hover:bg-accent/5 hover:ring-1 hover:ring-accent/25 active:bg-accent/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent motion-reduce:transition-none" variant={grouped ? 'transparent' : 'secondary'}
      onPointerEnter={event => {
        if (event.pointerType === 'touch' || detailsOpen) return;
        hideHint();
        setHintSource('pointer');
        pointerPosition.current = { x: event.clientX, y: event.clientY };
        hintTimer.current = window.setTimeout(() => { hintTimer.current = null; setHintVisible(true); }, DETAILS_HINT_DELAY_MS);
      }}
      onPointerMove={event => { if (!hintVisible) pointerPosition.current = { x: event.clientX, y: event.clientY }; }}
      onPointerLeave={hideHint}
      onClick={event => {
        const target = event.target as Element;
        if (target.closest('button, a, input, select, textarea, [role="button"], [role="link"]') || hasSelectedText(event.currentTarget)) return;
        openDetails();
      }}>
    <AriaButton ref={triggerRef} type="button" aria-label={`查看 ${provider.label} 额度详情`} aria-haspopup="dialog" aria-expanded={detailsOpen} aria-describedby={hintId}
      className="peer absolute inset-0 cursor-pointer rounded-[inherit] outline-none"
      onFocus={event => { if (event.target.matches(':focus-visible')) { hideHint(); setHintSource('focus'); setHintVisible(true); } }} onBlur={hideHint}
      onPress={event => { if (event.pointerType === 'keyboard' || event.pointerType === 'virtual' || !hasSelectedText(triggerRef.current!.parentElement!)) openDetails(); }} />
    <Card.Content className={`relative ${grouped ? 'flex-row flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2' : compact ? 'gap-1.5 px-4 py-3' : 'gap-3 p-4'}`}>
      <div className={`grid min-w-0 items-start gap-x-2 ${headerService ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1'} ${grouped ? 'shrink-0' : ''}`}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="flex min-w-0 max-w-full items-center gap-2">
            <SubscriptionBrandIcon brand={provider.id as Parameters<typeof SubscriptionBrandIcon>[0]['brand']} />
            <span className={`min-w-0 truncate text-sm font-medium ${grouped ? 'max-w-24' : ''}`}>{provider.label}</span>
          </div>
          {planSummary && <Chip size="sm" variant="soft" className="min-w-0 max-w-full bg-foreground/8 text-foreground" title={planSummary}><Chip.Label className="truncate">{planSummary}</Chip.Label></Chip>}
        </div>
        {status && headerService && <QuotaServiceStatusLink label={provider.label} status={status} service={headerService} iconOnly />}
      </div>
      {commonReset !== null && <QuotaCommonResetTime at={commonReset} />}
      {hasReading && <div className="flex flex-col gap-3">
        {windows.slice(0, 3).map(window => <QuotaWindowRow key={window.id} providerId={provider.id} window={window} stale={provider.stale} hideReset={commonReset !== null} />)}
        {details.map(detail => <div key={detail.id} className="flex justify-between gap-2 text-xs"><span className="text-muted">{detail.label}</span><span>{detail.text}</span></div>)}
      </div>}
      {summary && <div data-quota-summary className="flex min-w-0 items-center gap-2" title={`${summary.label}：${summary.description ?? summary.text}；点击卡片查看完整分析`}>
        {!summary.warning && summary.trend.length >= 3 && <QuotaTrendPreview samples={summary.trend} />}
        <p className={`min-w-0 truncate text-[11px] ${summary.warning ? 'text-amber-700 dark:text-amber-400' : 'text-muted'}`}>{summary.text}</p>
      </div>}
      {(message || error) && <div className={`flex items-center justify-between gap-2 ${grouped ? 'min-w-0 flex-1' : compact ? 'min-h-8' : ''}`}>
        <p role="status" className={`text-xs text-muted ${grouped ? 'truncate' : ''}`} title={grouped ? error ?? message ?? undefined : undefined}>{error ?? message}</p>
        {(retryable || error) && <Button data-quota-action data-quota-retry aria-label={`重试读取 ${provider.label} 额度`} className="h-auto min-h-7 shrink-0 px-2" size="sm" variant="tertiary" isDisabled={busy} onPress={() => void refresh()}>{busy ? '重试中' : '重试'}</Button>}
      </div>}
      {severeServiceWarning && <p role="status" className={`flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 ${grouped ? 'w-full' : ''}`}>
        官方服务{severeServiceWarning.label}
      </p>}
      {provider.windows.length > 3 && <span className="text-[10px] text-muted">另有 {provider.windows.length - 3} 个窗口</span>}
    </Card.Content>
    <span ref={hintRef} id={hintId} role="tooltip" style={hintPosition} className={`pointer-events-none absolute z-20 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-sm transition-opacity duration-150 group-has-[[data-quota-action]:hover]:hidden group-has-[[data-quota-action]:focus-visible]:hidden motion-reduce:transition-none ${hintVisible && !detailsOpen ? 'visible opacity-100' : 'invisible opacity-0'}`}>点击查看详情</span>
    </Card>
          <Modal.Backdrop isOpen={detailsOpen} onOpenChange={setDetailsOpen}>
            <Modal.Container placement="center" scroll="inside">
              <Modal.Dialog aria-label={`${provider.label} 额度详情`} className="w-full max-w-md">
                <Modal.CloseTrigger aria-label="关闭额度详情" />
                <Modal.Header>
                  <Modal.Heading>{provider.label} 额度详情</Modal.Heading>
                </Modal.Header>
                <Modal.Body className="flex flex-col gap-5">
                  {(provider.planLabel || provider.resetCredits !== null) && <p className="text-sm">{[provider.planLabel, provider.resetCredits !== null ? `可重置 ${provider.resetCredits} 次` : null].filter(Boolean).join(' · ')}</p>}
                  {commonReset !== null && <QuotaCommonResetTime at={commonReset} />}
                  {status && service && <QuotaServiceStatusLink label={provider.label} status={status} service={service} />}
                  <div className="flex flex-col gap-5">
                    {windows.map(window => <QuotaWindowRow key={window.id} providerId={provider.id} window={window} analysis={provider.analyses[window.id]} etaAt={forecasts.get(window.id)} showSparkline={preferences.showSparkline && trendWindows.has(window.id)} stale={provider.stale} hideReset={commonReset !== null} detailed />)}
                    {details.map(detail => <div key={detail.id} className="flex justify-between gap-3 text-sm"><span className="text-muted">{detail.label}</span><span>{detail.text}</span></div>)}
                  </div>
                  {(message || error) && <p role="status" className="text-sm text-muted">{error ?? message}</p>}
                  {compact && provider.status === 'expired' && <p className="text-xs text-muted">请在 {provider.label} 客户端重新登录，再刷新这里的额度。</p>}
                  {compact && provider.status === 'custom-provider' && <p className="text-xs text-muted">当前使用自定义模型服务，无法读取官方订阅额度。</p>}
                  <dl className="flex flex-col gap-2 border-t border-separator pt-4 text-xs text-muted">
                    <div className="flex flex-wrap justify-between gap-2"><dt>最近查询</dt><dd>{lastQuery !== null ? queryDate(lastQuery) : busy ? '正在查询' : '暂无记录'}</dd></div>
                  </dl>
                </Modal.Body>
                <Modal.Footer>
                  <Button aria-label={`刷新 ${provider.label} 额度`} className="w-fit" size="sm" variant="secondary" isDisabled={busy} onPress={() => void refresh()}>
                    <RefreshCw aria-hidden="true" className={`size-3.5 ${busy ? 'motion-safe:animate-spin' : ''}`} />{busy ? '正在刷新' : '刷新额度'}
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
  </>;
}

function QuotaServiceStatusLink({ label, status, service, iconOnly = false }: { label: string; status: QuotaServiceStatus; service: typeof SERVICE_STATUS[QuotaServiceStatus['level']]; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  return <Tooltip isOpen={open} onOpenChange={setOpen}>
    <Button size="sm" variant="tertiary" isIconOnly={iconOnly}
      data-quota-action
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm text-xs text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${iconOnly ? 'size-6 min-w-6 p-0' : 'h-auto min-h-6 w-fit px-0'}`}
      aria-label={`${label} 官方服务状态：${service.label}，查看官方状态页`}
      onHoverStart={() => setOpen(true)} onHoverEnd={() => setOpen(false)}
      onFocus={event => { if (event.target.matches(':focus-visible')) setOpen(true); }} onBlur={() => setOpen(false)}
      onPress={() => { setOpen(false); void window.tud.openExternal(status.url); }}>
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${service.dotClassName}`} />
      {!iconOnly && <><span>{service.label}</span><span aria-hidden="true">↗</span></>}
    </Button>
    <Tooltip.Content className="max-w-64 text-xs">
      <div className="flex flex-col gap-1">
        <p>官方整体状态：{service.label}</p>
        <p className="text-muted">具体产品与地区的影响以官方状态页为准。</p>
        {status.stale && <p className="text-muted">最近一次查询未成功，上次结果已过期。</p>}
        <p className="text-muted">{status.checkedAt ? `上次检查 ${new Date(status.checkedAt * 1000).toLocaleString('zh-CN')}` : '尚未取得有效状态'}</p>
      </div>
    </Tooltip.Content>
  </Tooltip>;
}

function QuotaCommonResetTime({ at }: { at: number }) {
  return <p data-quota-common-reset className="text-xs tabular-nums text-muted" title={formatSubscriptionResetTime(at, new Date(), true) ?? undefined}>统一重置：{formatSubscriptionResetTime(at)}</p>;
}

function QuotaWindowRow({ providerId, window, analysis, etaAt, showSparkline = false, stale, detailed = false, hideReset = false }: { providerId: string; window: QuotaWindow; analysis?: QuotaAnalysis; etaAt?: number; showSparkline?: boolean; stale: boolean; detailed?: boolean; hideReset?: boolean }) {
  const label = quotaWindowLabel(providerId, window);
  const reset = hideReset ? null : formatSubscriptionResetTime(window.resetsAt);
  const paceText = analysis ? quotaPaceLabel(analysis) : null;
  const color = window.usedPercent >= 90 ? 'var(--color-danger)' : window.usedPercent >= 70 ? 'var(--color-warning)' : 'var(--color-accent)';
  return <div className="flex min-w-0 flex-col gap-1">
    <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
      <span className="min-w-0 truncate text-muted" title={label}>{label}</span>
      {reset && <span className="shrink-0 text-[10px] tabular-nums text-muted" title={formatSubscriptionResetTime(window.resetsAt, new Date(), true) ?? undefined}>{reset}{window.timeKind === 'expiry' ? '到期' : '重置'}</span>}
    </div>
    <div className="flex min-w-0 items-center gap-3">
      <ProgressBar aria-label={`${label}，${window.valueText ?? `剩余 ${Math.round(100 - window.usedPercent)}%`}`} className="min-w-0 flex-1" value={100 - window.usedPercent} size="sm"
        style={{ gap: 0, gridTemplateAreas: '"track"', gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'auto' }}>
        <ProgressBar.Track className="h-1.5 rounded-full bg-surface-secondary"><ProgressBar.Fill className="rounded-full" style={{ backgroundColor: color }} /></ProgressBar.Track>
      </ProgressBar>
      <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-foreground" aria-label={window.valueText ?? `剩余 ${Math.round(100 - window.usedPercent)}%`}>{window.valueText ?? `${Math.round(100 - window.usedPercent)}%`}</span>
    </div>
    {detailed && window.used !== undefined && window.limit !== undefined && <p className="text-[10px] text-muted">{window.used.toLocaleString()} / {window.limit.toLocaleString()} {window.unit === 'requests' ? '次' : window.unit === 'credits' ? '额度' : 'Token'}</p>}
    {detailed && !stale && paceText && <p className="text-[11px] text-muted" title={quotaPaceDescription(window, analysis!) ?? undefined}>{paceText}</p>}
    {detailed && !stale && etaAt && <p data-quota-forecast className="text-xs text-amber-700 dark:text-amber-400">按近期速度，预计约 {duration(etaAt)}后耗尽</p>}
    {detailed && showSparkline && analysis && analysis.trend.length >= 3 && <QuotaSparkline samples={analysis.trend} label={label} />}
  </div>;
}

function QuotaTrendPreview({ samples }: { samples: QuotaSample[] }) {
  const first = samples[0].at, span = Math.max(1, samples.at(-1)!.at - first);
  return <svg aria-hidden="true" viewBox="0 0 64 16" className="h-4 w-16 shrink-0 text-accent">
    <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={samples.map(sample => `${2 + (sample.at - first) / span * 60},${2 + sample.usedPercent / 100 * 12}`).join(' ')} />
  </svg>;
}

function QuotaSparkline({ samples, label }: { samples: QuotaSample[]; label: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const first = samples[0].at, span = Math.max(1, samples.at(-1)!.at - first);
  const point = selected === null ? null : samples[Math.min(selected, samples.length - 1)];
  return <div className="flex min-h-9 items-center gap-2">
    <svg role="img" aria-label={`${label} 最近六小时剩余额度趋势，左右方向键查看读数`} tabIndex={0} viewBox="0 0 160 36" className="h-9 w-40 shrink-0 rounded text-accent outline-offset-2 focus-visible:outline-2"
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
    <span className="min-w-0 truncate text-[10px] tabular-nums text-muted">{point ? `${clock(point.at)} · 剩余 ${Math.round(100 - point.usedPercent)}%` : '近 6h'}</span>
  </div>;
}
