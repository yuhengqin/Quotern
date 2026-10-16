import { useId, useState } from 'react';
import { Button, Card, Chip, ProgressBar, Tooltip } from '@heroui/react';
import { RefreshCw } from 'lucide-react';
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
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();
  const status = provider.service;
  const service = status ? SERVICE_STATUS[status.stale ? 'unknown' : status.level] : null;
  const refresh = async () => {
    try { setError(null); await window.tud.quota.refresh(provider.id); }
    catch { setError('刷新失败，请稍后重试'); }
  };
  return <Card className="min-w-0" variant="secondary">
    <Card.Content className="gap-3 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <SubscriptionBrandIcon brand={provider.id as Parameters<typeof SubscriptionBrandIcon>[0]['brand']} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{provider.label}</span>
        <Button aria-label={`刷新 ${provider.label} 额度`} size="sm" variant="tertiary" isIconOnly isDisabled={provider.refreshing} onPress={() => void refresh()}>
          <RefreshCw aria-hidden="true" className={`size-3.5 ${provider.refreshing ? 'motion-safe:animate-spin' : ''}`} />
        </Button>
      </div>
      {(provider.planLabel || provider.resetCredits !== null) && <div className="flex flex-wrap items-center gap-2">
        {provider.planLabel && <span className="text-xs text-muted">{provider.planLabel}</span>}
        {provider.resetCredits !== null && <Chip size="sm" variant="secondary"><Chip.Label>重置 {provider.resetCredits} 次</Chip.Label></Chip>}
      </div>}
      {status && service && <Tooltip delay={200}>
        <Tooltip.Trigger<'button'> render={props => <button {...props} />} type="button"
          className="inline-flex w-fit items-center gap-1.5 rounded-sm text-xs text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          aria-label={`${provider.label} 官方服务状态：${service.label}，查看官方状态页`}
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
      </Tooltip>}
      <div id={panelId} className="flex flex-col gap-3">
        {(expanded ? provider.windows : provider.windows.slice(0, 3)).map(window => <QuotaWindowRow key={window.id} window={window} analysis={provider.analyses[window.id]} showSparkline={preferences.showSparkline} stale={provider.stale} />)}
        {provider.details.map(detail => <div key={detail.id} className="flex justify-between gap-2 text-xs"><span className="text-muted">{detail.label}</span><span>{detail.text}</span></div>)}
      </div>
      {provider.windows.length > 3 && <Button className="w-fit self-start" size="sm" variant="tertiary" aria-expanded={expanded} aria-controls={panelId} onPress={() => setExpanded(value => !value)}>
        {expanded ? '收起窗口' : `查看其余 ${provider.windows.length - 3} 个窗口`}
      </Button>}
      {(provider.message || error) && <p role="status" className="text-xs text-muted">{error ?? provider.message}</p>}
      <p className="flex flex-wrap gap-x-2 text-[10px] tabular-nums text-muted" title={provider.fetchedAt ? `上次成功读取：${new Date(provider.fetchedAt * 1000).toLocaleString('zh-CN')}` : undefined}>
        <span>{provider.fetchedAt ? `${provider.stale ? '旧读数 · ' : ''}${clock(provider.fetchedAt)} 更新` : provider.refreshing ? '正在读取额度' : '尚无有效读数'}</span>
        {provider.nextRefreshAt && <span>下次尝试 {clock(provider.nextRefreshAt)}</span>}
      </p>
    </Card.Content>
  </Card>;
}

function QuotaWindowRow({ window, analysis, showSparkline, stale }: { window: QuotaWindow; analysis?: QuotaAnalysis; showSparkline: boolean; stale: boolean }) {
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
      {window.used !== undefined && window.limit !== undefined && <span>{window.used.toLocaleString()} / {window.limit.toLocaleString()} {window.unit === 'requests' ? '次' : window.unit === 'credits' ? '额度' : 'Token'}</span>}
    </div>
    {!stale && paceText && <p className="text-[10px] text-muted" title={`根据${analysis?.paceBasis === 'workdays' ? '工作日' : analysis?.paceBasis === 'automatic' ? '历史习惯' : '均匀'}参考曲线计算；差值按完整额度的百分点计`}>{paceText}</p>}
    {!stale && analysis?.etaAt && <p className="text-xs text-warning">按近期速度，预计约 {duration(analysis.etaAt)}后耗尽</p>}
    {showSparkline && analysis && analysis.trend.length >= 3 && <QuotaSparkline samples={analysis.trend} label={label} />}
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
