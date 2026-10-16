import { useState } from 'react';
import { Button, Card, Chip, Drawer, ProgressBar, Tooltip } from '@heroui/react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import type { QuotaAnalysis, QuotaPreferences, QuotaProviderState, QuotaSample, QuotaServiceStatus, QuotaWindow } from '../../shared/quota';
import { SubscriptionBrandIcon } from './SubscriptionBrandIcon';
import { formatSubscriptionResetTime } from './SubscriptionUsageCard';

const SERVICE_STATUS: Record<QuotaServiceStatus['level'], { label: string; dotClassName: string }> = {
  operational: { label: '服务正常', dotClassName: 'bg-emerald-600 dark:bg-emerald-400' },
  minor: { label: '轻微异常', dotClassName: 'bg-yellow-500 dark:bg-yellow-400' },
  major: { label: '严重异常', dotClassName: 'bg-orange-500 dark:bg-orange-400' },
  critical: { label: '重大故障', dotClassName: 'bg-red-600 dark:bg-red-400' },
  maintenance: { label: '维护中', dotClassName: 'bg-blue-500 dark:bg-blue-400' },
  unknown: { label: '状态未确认', dotClassName: 'bg-gray-500 dark:bg-gray-400' },
};

function clock(at: number) { return new Date(at * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }
function duration(until: number) {
  const minutes = Math.max(1, Math.ceil((until - Date.now() / 1000) / 60));
  return minutes < 60 ? `${minutes} 分钟` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}` : `${Math.ceil(minutes / 1440)} 天`;
}

export function QuotaUsageCard({ provider, preferences }: { provider: QuotaProviderState; preferences: QuotaPreferences }) {
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const status = provider.service;
  const service = status ? SERVICE_STATUS[status.stale ? 'unknown' : status.level] : null;
  const serviceWarning = status && !status.stale && !['operational', 'unknown'].includes(status.level) ? service : null;
  const hasReading = provider.windows.length > 0 || provider.details.length > 0;
  const message = provider.status === 'custom-provider' ? '自定义模型无法获取配额'
    : provider.status === 'expired' ? '登录已过期，请重新登录'
      : provider.stale ? '读数可能已过期'
        : provider.message ?? (provider.windows.some(window => window.analysisEligible !== false && window.usedPercent >= 100) ? '额度已用尽'
          : provider.windows.some(window => window.analysisEligible !== false && window.usedPercent >= 90) ? '额度接近上限' : null);
  const retryable = ['unavailable', 'temporarily-unavailable'].includes(provider.status) || (provider.stale && provider.status === 'ready');
  const busy = provider.refreshing || refreshing;
  const refresh = async () => {
    try { setError(null); setRefreshing(true); await window.tud.quota.refresh(provider.id); }
    catch { setError('刷新失败，请稍后重试'); }
    finally { setRefreshing(false); }
  };
  return <Card className="min-w-0" variant="secondary">
    <Card.Content className="gap-3 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <SubscriptionBrandIcon brand={provider.id as Parameters<typeof SubscriptionBrandIcon>[0]['brand']} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{provider.label}</span>
      </div>
      {provider.planLabel && <span className="text-xs text-muted">{provider.planLabel}</span>}
      {hasReading && <div className="flex flex-col gap-3">
        {provider.windows.slice(0, 3).map(window => <QuotaWindowRow key={window.id} window={window} stale={provider.stale} />)}
        {provider.details.map(detail => <div key={detail.id} className="flex justify-between gap-2 text-xs"><span className="text-muted">{detail.label}</span><span>{detail.text}</span></div>)}
      </div>}
      {(message || error) && <div className="flex items-center justify-between gap-2">
        <p role="status" className="text-xs text-muted">{error ?? message}</p>
        {(retryable || error) && <Button aria-label={`重试读取 ${provider.label} 额度`} className="h-auto min-h-7 shrink-0 px-2" size="sm" variant="tertiary" isDisabled={busy} onPress={() => void refresh()}>{busy ? '重试中' : '重试'}</Button>}
      </div>}
      {serviceWarning && !message && <p className="flex items-center gap-1.5 text-xs text-muted">
        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${serviceWarning.dotClassName}`} />
        官方服务{serviceWarning.label}
      </p>}
      <div className="flex items-center justify-end gap-2">
        {provider.windows.length > 3 && <span className="mr-auto text-[10px] text-muted">另有 {provider.windows.length - 3} 个窗口</span>}
        <Drawer>
          <Button aria-label={`查看 ${provider.label} 额度详情`} className="h-auto min-h-7 gap-0.5 px-1 text-xs" size="sm" variant="ghost">
            额度详情<ChevronRight aria-hidden="true" className="size-3.5" />
          </Button>
          <Drawer.Backdrop>
            <Drawer.Content placement="right">
              <Drawer.Dialog aria-label={`${provider.label} 额度详情`} className="w-full max-w-md">
                <Drawer.CloseTrigger aria-label="关闭额度详情" />
                <Drawer.Header>
                  <Drawer.Heading>{provider.label} 额度详情</Drawer.Heading>
                </Drawer.Header>
                <Drawer.Body className="flex flex-col gap-5">
                  {(provider.planLabel || provider.resetCredits !== null) && <div className="flex flex-wrap items-center gap-2 text-sm">
                    {provider.planLabel && <span>{provider.planLabel}</span>}
                    {provider.resetCredits !== null && <Chip size="sm" variant="secondary"><Chip.Label>重置 {provider.resetCredits} 次</Chip.Label></Chip>}
                  </div>}
                  {status && service && <QuotaServiceStatusLink label={provider.label} status={status} service={service} />}
                  <div className="flex flex-col gap-5">
                    {provider.windows.map(window => <QuotaWindowRow key={window.id} window={window} analysis={provider.analyses[window.id]} showSparkline={preferences.showSparkline} stale={provider.stale} detailed />)}
                    {provider.details.map(detail => <div key={detail.id} className="flex justify-between gap-3 text-sm"><span className="text-muted">{detail.label}</span><span>{detail.text}</span></div>)}
                  </div>
                  {(provider.message || error) && <p role="status" className="text-sm text-muted">{error ?? provider.message}</p>}
                  <dl className="flex flex-col gap-2 border-t border-separator pt-4 text-xs text-muted">
                    <div className="flex flex-wrap justify-between gap-2"><dt>有效读数</dt><dd>{provider.fetchedAt ? `${provider.stale ? '旧读数 · ' : ''}${new Date(provider.fetchedAt * 1000).toLocaleString('zh-CN')}` : busy ? '正在读取额度' : '尚无有效读数'}</dd></div>
                    {provider.nextRefreshAt && <div className="flex flex-wrap justify-between gap-2"><dt>下次尝试</dt><dd>{new Date(provider.nextRefreshAt * 1000).toLocaleString('zh-CN')}</dd></div>}
                  </dl>
                </Drawer.Body>
                <Drawer.Footer>
                  <Button aria-label={`刷新 ${provider.label} 额度`} className="w-fit" size="sm" variant="secondary" isDisabled={busy} onPress={() => void refresh()}>
                    <RefreshCw aria-hidden="true" className={`size-3.5 ${busy ? 'motion-safe:animate-spin' : ''}`} />{busy ? '正在刷新' : '刷新额度'}
                  </Button>
                </Drawer.Footer>
              </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>
      </div>
    </Card.Content>
  </Card>;
}

function QuotaServiceStatusLink({ label, status, service }: { label: string; status: QuotaServiceStatus; service: typeof SERVICE_STATUS[QuotaServiceStatus['level']] }) {
  return <Tooltip delay={200}>
    <Tooltip.Trigger<'button'> render={props => <button {...props} />} type="button"
      className="inline-flex w-fit items-center gap-1.5 rounded-sm text-xs text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      aria-label={`${label} 官方服务状态：${service.label}，查看官方状态页`}
      onClick={() => void window.tud.openExternal(status.url)}>
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${service.dotClassName}`} />
      <span>{service.label}</span><span aria-hidden="true">↗</span>
    </Tooltip.Trigger>
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

function QuotaWindowRow({ window, analysis, showSparkline = false, stale, detailed = false }: { window: QuotaWindow; analysis?: QuotaAnalysis; showSparkline?: boolean; stale: boolean; detailed?: boolean }) {
  const label = [window.groupLabel, window.label].filter(Boolean).join(' ');
  const reset = formatSubscriptionResetTime(window.resetsAt);
  const pace = analysis?.paceDifference;
  const paceText = pace === undefined || pace === null ? null : pace === 0 ? '节奏均衡' : pace > 0 ? `比参考节奏多余 ${pace} 个百分点` : `消耗超前 ${Math.abs(pace)} 个百分点`;
  const color = window.usedPercent >= 90 ? 'var(--color-danger)' : window.usedPercent >= 70 ? 'var(--color-warning)' : 'var(--color-accent)';
  return <div className="flex min-w-0 flex-col gap-1">
    <div className="flex min-w-0 items-baseline justify-between gap-3 text-xs">
      <span className="min-w-0 truncate text-muted" title={label}>{label}</span>
      <span className="shrink-0 tabular-nums">{window.valueText ?? `剩余 ${Math.round(100 - window.usedPercent)}%`}</span>
    </div>
    <ProgressBar aria-label={`${label}，${window.valueText ?? `剩余 ${Math.round(100 - window.usedPercent)}%`}`} value={100 - window.usedPercent} size="sm" style={{ gap: 0 }}>
      <ProgressBar.Track className="h-1.5 rounded-full bg-surface-secondary"><ProgressBar.Fill className="rounded-full" style={{ backgroundColor: color }} /></ProgressBar.Track>
    </ProgressBar>
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] text-muted">
      {reset && <span title={formatSubscriptionResetTime(window.resetsAt, new Date(), true) ?? undefined}>{reset} {window.timeKind === 'expiry' ? '到期' : '重置'}</span>}
      {detailed && window.used !== undefined && window.limit !== undefined && <span>{window.used.toLocaleString()} / {window.limit.toLocaleString()} {window.unit === 'requests' ? '次' : window.unit === 'credits' ? '额度' : 'Token'}</span>}
    </div>
    {detailed && !stale && paceText && <p className="text-[10px] text-muted" title={`根据${analysis?.paceBasis === 'workdays' ? '工作日' : analysis?.paceBasis === 'automatic' ? '历史习惯' : '均匀'}参考曲线计算；差值按完整额度的百分点计`}>{paceText}</p>}
    {detailed && !stale && analysis?.etaAt && <p className="text-xs text-warning">按近期速度，预计约 {duration(analysis.etaAt)}后耗尽</p>}
    {detailed && showSparkline && analysis && analysis.trend.length >= 3 && <QuotaSparkline samples={analysis.trend} label={label} />}
  </div>;
}

function QuotaSparkline({ samples, label }: { samples: QuotaSample[]; label: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const first = samples[0].at, span = Math.max(1, samples.at(-1)!.at - first);
  const point = selected === null ? null : samples[Math.min(selected, samples.length - 1)];
  return <div className="flex min-h-5 items-center gap-2">
    <svg role="img" aria-label={`${label} 最近六小时剩余额度趋势，左右方向键查看读数`} tabIndex={0} viewBox="0 0 128 20" className="h-5 w-32 shrink-0 rounded text-accent outline-offset-2 focus-visible:outline-2"
      onPointerMove={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const at = first + Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))) * span;
        const nearest = samples.reduce((best, sample, i) => Math.abs(sample.at - at) < Math.abs(samples[best].at - at) ? i : best, 0);
        setSelected(nearest);
      }} onPointerLeave={() => setSelected(null)} onFocus={() => setSelected(samples.length - 1)} onBlur={() => setSelected(null)}
      onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSelected(index => Math.max(0, Math.min(samples.length - 1, (index ?? samples.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1)))); } }}>
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={samples.map(sample => `${2 + (sample.at - first) / span * 124},${2 + sample.usedPercent / 100 * 16}`).join(' ')} />
      {point && <circle fill="currentColor" cx={2 + (point.at - first) / span * 124} cy={2 + point.usedPercent / 100 * 16} r="2.5" />}
    </svg>
    <span className="min-w-0 truncate text-[10px] tabular-nums text-muted">{point ? `${clock(point.at)} · 剩余 ${Math.round(100 - point.usedPercent)}%` : '近 6h'}</span>
  </div>;
}
