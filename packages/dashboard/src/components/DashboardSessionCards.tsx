import { CircleHelp } from 'lucide-react';
import { Card, Popover } from '@heroui/react';
import type { SessionMetrics } from 'quotern-core';
import { formatSessionDuration, sessionMetricValue } from '@/lib/session-metric-format';
import { sourceLabel } from '@/lib/tokens';

const cards = [
  { key: 'activeSeconds', label: '活跃时长', duration: true, help: '估算值：每轮从首条 AI 消息到末条 AI 消息的时间跨度累计，以用户消息划分回合，只统计当前日期范围内的记录。不计用户提问到首条 AI 消息的等待和回合间空闲；可能包含工具执行等等待，也可能低估只有一条 AI 记录的回合，并非精确生成时长。' },
  { key: 'durationSeconds', label: '总时长', duration: true, help: '各会话在当前日期范围内，首条消息到末条消息的时间跨度之和。包含会话内思考、看代码等空闲，不包含会话之间的间隔。多个同时进行的会话分别累计。' },
  { key: 'sessionCount', label: '会话数', duration: false, help: '当前日期范围内有用户或 AI 消息的去重会话数。同一会话跨天只计一次，复制文件和 fork 继承的历史不会重复计入。' },
  { key: 'messageCount', label: '总消息数', duration: false, help: '当前日期范围内用户消息与 AI 逻辑消息的总数，排除工具消息、系统及状态事件；同一消息的流式片段和重复记录合并计数。' },
] as const;

export function DashboardSessionCards({ metrics }: { metrics: SessionMetrics | null }) {
  const partial = metrics && !metrics.complete;
  const missing = metrics?.missingSources.map(sourceLabel).join('、');
  return (
    <section aria-label="会话概览" className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const value = sessionMetricValue(metrics, card.key);
        const formatted = card.duration ? formatSessionDuration(value) : value === null ? '—' : value.toLocaleString('zh-CN');
        const estimated = card.key === 'activeSeconds' && value !== null;
        const note = estimated ? partial ? '估算 · 部分来源' : '估算' : card.key === 'activeSeconds' ? '暂无可用记录' : partial ? '部分来源 · 已解析记录' : '\u00a0';
        return (
          <Card key={card.key} className="h-[6.25rem] min-h-[6.25rem] min-w-0 overflow-hidden rounded-2xl p-3">
            <Card.Content className="flex h-full flex-col justify-between p-0">
              <div className="flex items-center gap-0.5">
                <p className="text-xs font-medium leading-5 text-muted">{card.label}</p>
                <Popover>
                  <Popover.Trigger aria-label={`${card.label}说明`} className="flex size-4 min-w-4 items-center justify-center rounded-full text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2">
                    <CircleHelp aria-hidden className="size-3.5" />
                  </Popover.Trigger>
                  <Popover.Content placement="bottom" className="max-w-80 rounded-xl border-0 bg-overlay p-0 text-overlay-foreground shadow-surface">
                    <Popover.Dialog className="p-3 outline-none">
                      <Popover.Heading className="mb-1 text-xs font-semibold">{card.label}</Popover.Heading>
                      <p className="text-xs leading-relaxed">{card.help}</p>
                      {partial ? <p className="mt-2 text-xs text-muted">仅统计已解析的记录。尚未完整覆盖：{missing}。</p> : null}
                    </Popover.Dialog>
                  </Popover.Content>
                </Popover>
              </div>
              <div>
                <p aria-label={`${card.label}${estimated ? '（估算）' : ''} ${formatted}`} className="truncate text-xl font-semibold leading-7 tracking-tight text-foreground tabular-nums" title={formatted}>{formatted}</p>
                <p className="mt-0.5 h-4 truncate text-[10px] leading-4 text-muted">{note}</p>
              </div>
            </Card.Content>
          </Card>
        );
      })}
    </section>
  );
}
