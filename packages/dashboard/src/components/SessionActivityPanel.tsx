import { useMemo, useState } from 'react';
import { Button, Card, Tabs } from '@heroui/react';
import type { SessionActivity, SessionActivitySnapshot } from 'quotern-core';
import { useSessionActivity } from '@/hooks/useSessionActivity';
import { sourceLabel } from '@/lib/tokens';
import { isCliBackend } from '@/lib/api';
import type { DashboardDateRange } from '@/lib/dashboard-date-range';
import { ProviderIcon } from './ProviderIcon';

const number = (value: number) => new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const serviceLabel = (value: string) => ({ unknown: '归属未知', mixed: '多个计费渠道', openai: 'OpenAI', anthropic: 'Anthropic', xai: 'xAI', opencode: 'OpenCode' }[value] ?? value);
const modeLabel = (value: string) => ({ api: 'API', subscription: '订阅', unknown: '计费方式未记录' }[value] ?? value);
const costLabel = (value: string) => ({ recorded: '来源记录', estimated: '价格估算', mixed: '部分估算或缺失', unknown: '金额未知' }[value] ?? value);
function age(stamp: string) {
  const seconds = Math.max(0, (Date.now() - Date.parse(stamp)) / 1000);
  return seconds < 60 ? '刚刚' : seconds < 3600 ? `${Math.floor(seconds / 60)} 分钟前` : seconds < 86400 ? `${Math.floor(seconds / 3600)} 小时前` : new Date(stamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
function money(row: Pick<SessionActivity, 'costUsd' | 'costKind'>) {
  return row.costUsd === null ? '金额未知' : `$${row.costUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} · ${costLabel(row.costKind)}`;
}

export function SessionActivityPanel(props: { days: number; selectedDate: string | null; dateRange: DashboardDateRange | null; sources: readonly string[]; enabled: boolean }) {
  const { data, error } = useSessionActivity(props.days, props.selectedDate, props.dateRange, props.sources, props.enabled);
  if (!isCliBackend()) return null;
  return <Card className="mt-4 min-w-0 overflow-hidden" aria-label="会话活动与计费归属">
    <Card.Header className="pb-0"><Card.Title>会话</Card.Title></Card.Header>
    <Card.Content>
      {error && <p role="status" className="mb-3 text-xs text-warning">{error}{data ? '，以下保留上次读数。' : ''}</p>}
      {!data ? <p role="status" className="py-4 text-sm text-muted">{error ? '暂时无法读取会话' : '正在读取会话…'}</p> : <SessionActivityViews snapshot={data} />}
    </Card.Content>
  </Card>;
}

export function SessionActivityViews({ snapshot }: { snapshot: SessionActivitySnapshot }) {
  const recent = useMemo(() => [...snapshot.sessions].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)), [snapshot.sessions]);
  return <Tabs defaultSelectedKey="recent" variant="secondary" className="min-w-0">
    <Tabs.ListContainer><Tabs.List aria-label="会话视图">
      <Tabs.Tab id="recent">最近活动<Tabs.Indicator /></Tabs.Tab>
      <Tabs.Tab id="contribution">消耗贡献<Tabs.Indicator /></Tabs.Tab>
      <Tabs.Tab id="billing">计费渠道<Tabs.Indicator /></Tabs.Tab>
    </Tabs.List></Tabs.ListContainer>
    <Tabs.Panel id="recent" className="pt-3"><SessionList rows={recent} contribution={false} /></Tabs.Panel>
    <Tabs.Panel id="contribution" className="pt-3">
      <p className="mb-3 text-xs text-muted">本机 Token 消耗占比 · 当前筛选范围 · {number(snapshot.totalTokens)} Token</p>
      <SessionList rows={snapshot.sessions} contribution />
      {snapshot.otherTokens > 0 && <div className="mt-2 flex justify-between gap-3 rounded-xl bg-surface-secondary px-3 py-2 text-xs text-muted"><span>未归属到会话</span><span className="tabular-nums">{number(snapshot.otherTokens)} · {(snapshot.otherTokens / snapshot.totalTokens * 100).toFixed(1)}%</span></div>}
      <p className="mt-3 text-[11px] text-muted">仅反映本机记录的 Token；不同模型权重、其他设备及订阅额度消耗未包含在占比中。</p>
    </Tabs.Panel>
    <Tabs.Panel id="billing" className="pt-3">
      <div className="flex flex-col divide-y divide-separator">
        {snapshot.billing.map(row => <div key={`${row.service}|${row.mode}|${row.accountRef ?? ''}`} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
          <div className="min-w-0"><p className="text-sm font-medium">{serviceLabel(row.service)}</p><p className="text-xs text-muted">{modeLabel(row.mode)}{row.accountLabel ? ` · ${row.accountLabel}` : row.accountRef ? ` · 账号 ${row.accountRef.slice(0, 6)}` : ''}</p></div>
          <div className="text-right text-xs tabular-nums"><p>{number(row.tokens)} Token</p><p className="text-muted">{money(row)}</p></div>
        </div>)}
        {!snapshot.billing.length && <p className="py-4 text-sm text-muted">当前范围没有计费归属记录</p>}
      </div>
      <p className="mt-3 text-[11px] text-muted">渠道与认证类型以来源记录为准；来源记录金额和价格估算均不等同实际账单。</p>
    </Tabs.Panel>
    {(snapshot.missingSources.length > 0 || snapshot.tokenTotalMismatch) && <p className="mt-3 text-[11px] text-muted">{snapshot.missingSources.length ? `会话用量覆盖不完整：${snapshot.missingSources.map(sourceLabel).join('、')}。` : ''}{snapshot.tokenTotalMismatch ? '会话记录与汇总记录口径存在差异，占比使用两者中较大的 Token 总量。' : ''}</p>}
  </Tabs>;
}

function SessionList({ rows, contribution }: { rows: SessionActivity[]; contribution: boolean }) {
  const [limit, setLimit] = useState(6);
  if (!rows.length) return <p className="py-4 text-sm text-muted">当前范围没有可读取的会话</p>;
  return <>
    <div className="divide-y divide-separator">
      {rows.slice(0, limit).map(row => <details key={`${row.source}:${row.sessionId}`} className="group py-1">
        <summary className="grid min-w-0 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-2 outline-offset-2 hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent sm:grid-cols-[minmax(0,1fr)_minmax(9rem,0.6fr)_auto]">
          <div className="flex min-w-0 items-center gap-2.5"><ProviderIcon provider={row.source} size={20} /><div className="min-w-0"><p className="truncate text-sm font-medium" title={row.projectLabel}>{row.projectLabel}</p><p className="truncate text-[11px] text-muted">{sourceLabel(row.source)} · {row.model === 'unknown' ? '模型未记录' : row.model} · {age(row.lastActivityAt)}</p></div></div>
          <div className="hidden min-w-0 sm:block"><ContextReading row={row} /></div>
          <div className="shrink-0 text-right text-xs tabular-nums"><p>{row.tokens === null ? '用量未记录' : `${number(row.tokens)} Token`}</p><p className="text-[11px] text-muted">{contribution && row.sharePercent !== null ? `${row.sharePercent.toFixed(1)}%` : serviceLabel(row.billing.service)}</p></div>
        </summary>
        <div className="ml-2 flex flex-col gap-2 border-l-2 border-separator py-2 pl-3 text-xs text-muted sm:ml-9">
          <div className="sm:hidden"><ContextReading row={row} /></div>
          <p>{serviceLabel(row.billing.service)} · {modeLabel(row.billing.mode)}{row.billing.accountLabel ? ` · ${row.billing.accountLabel}` : row.billing.accountRef ? ` · 账号 ${row.billing.accountRef.slice(0, 6)}` : ''}</p>
          <p>{money(row)}</p>
          <p>最近活动：{new Date(row.lastActivityAt).toLocaleString('zh-CN')}；会话 {row.sessionId}</p>
          {row.context && <p>{row.context.kind === 'post-compaction' ? '压缩后记录' : row.context.kind === 'request-input' ? '最近请求输入估计' : '来源记录的上下文快照'} · {new Date(row.context.observedAt).toLocaleString('zh-CN')}{Date.now() - Date.parse(row.context.observedAt) > 900000 ? ' · 读数较早' : ''}</p>}
        </div>
      </details>)}
    </div>
    {rows.length > 6 && <Button className="mt-2 h-7 text-xs" size="sm" variant="ghost" onPress={() => setLimit(limit === 6 ? rows.length : 6)}>{limit === 6 ? `查看全部 ${rows.length} 个会话` : '收起'}</Button>}
  </>;
}

function ContextReading({ row }: { row: SessionActivity }) {
  const reading = row.context;
  if (!reading) return <span className="text-[11px] text-muted">上下文未记录</span>;
  const capacity = reading.limitTokens;
  const label = reading.kind === 'post-compaction' ? '压缩后' : reading.kind === 'request-input' ? '输入估计' : '上下文';
  if (reading.usedTokens === null) return <span className="text-[11px] text-muted">{label}用量未知</span>;
  return <div className="flex min-w-0 flex-col gap-1" title={`${label} · ${new Date(reading.observedAt).toLocaleString('zh-CN')}`}>
    <p className="truncate text-[11px] tabular-nums text-muted">{label} {number(reading.usedTokens)}{capacity ? ` / ${number(capacity)} · ${(reading.usedTokens / capacity * 100).toFixed(0)}%` : ' · 容量未知'}</p>
    {capacity && <progress aria-label={`${sourceLabel(row.source)} ${row.projectLabel} 上下文占用`} max={capacity} value={Math.min(capacity, reading.usedTokens)} className="h-1 w-full max-w-44 overflow-hidden rounded-full accent-accent" />}
  </div>;
}
