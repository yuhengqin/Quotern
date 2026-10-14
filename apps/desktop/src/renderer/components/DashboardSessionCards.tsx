import { CircleHelp } from 'lucide-react';
import { Card, Popover } from '@heroui/react';
import type { SessionMetrics } from 'quotern-core';
import { formatSessionDuration, sessionMetricValue } from '@/lib/session-metric-format';
import { sourceLabel } from '@/lib/tokens';

const cards = [
  { key: 'taskSeconds', label: '任务执行时长', duration: true, help: 'Codex 使用已结束任务的耗时记录，缺少耗时字段时使用匹配的任务起止时间。其他 Agent 按用户消息到该轮最后一条工作日志的跨度估算。包含首 Token 等待、思考和工具执行，不包含两轮之间的空闲，也不是纯生成时长。Codex 进行中的任务暂不累计；跨日期任务只累计当前范围内的部分。' },
  { key: 'durationSeconds', label: '总时长', duration: true, help: '各会话在当前日期范围内，首条消息到末条消息的时间跨度之和。包含会话内思考、看代码等空闲，不包含会话之间的间隔。多个同时进行的会话分别累计。' },
  { key: 'sessionCount', label: '会话数', duration: false, help: '当前日期范围内有用户或 AI 消息的去重会话数。同一会话跨天只计一次，复制文件和 fork 继承的历史不会重复计入。' },
  { key: 'messageCount', label: '总消息数', duration: false, help: '当前日期范围内用户消息与 AI 逻辑消息的总数，排除工具消息、系统及状态事件；同一消息的流式片段和重复记录合并计数。' },
] as const;

export function DashboardSessionCards({ metrics }: { metrics: SessionMetrics | null }) {
  const partial = metrics && !metrics.complete;
  const missing = metrics?.missingSources.map(sourceLabel).join('、');
  const estimatedSources = metrics?.estimatedTaskSources?.map(sourceLabel).join('、');
  const missingTaskSources = metrics?.missingTaskSources?.map(sourceLabel).join('、');
  return (
    <section aria-label="会话概览" className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const value = sessionMetricValue(metrics, card.key);
        const formatted = card.duration ? formatSessionDuration(value) : value === null ? '—' : value.toLocaleString('zh-CN');
        const task = card.key === 'taskSeconds';
        const estimated = task && value !== null && ['mixed', 'estimated'].includes(metrics?.taskTimingKind ?? '');
        const taskNote = value === null ? '暂无可用记录' : metrics?.taskTimingKind === 'recorded' ? '已记录计时' : metrics?.taskTimingKind === 'mixed' ? '含估算' : estimated ? '估算' : '暂无任务记录';
        const note = task ? `${taskNote}${value !== null && missingTaskSources ? ' · 部分记录' : ''}` : partial ? '部分来源 · 已解析记录' : '\u00a0';
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
                      {task && estimatedSources ? <p className="mt-2 text-xs text-muted">估算来源：{estimatedSources}。</p> : null}
                      {task && missingTaskSources ? <p className="mt-2 text-xs text-muted">任务计时尚未完整覆盖：{missingTaskSources}。</p> : null}
                      {!task && partial ? <p className="mt-2 text-xs text-muted">仅统计已解析的记录。尚未完整覆盖：{missing}。</p> : null}
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
