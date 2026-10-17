import { Button, Popover } from '@heroui/react';
import { CircleHelp } from 'lucide-react';
import type { UsageReport } from 'quotern-core';
import { formatTokens, formatUsd } from '@/lib/format';

const methodLabels: Record<string, string> = {
  exact: '精确匹配', 'exact-dot': '名称归一匹配', 'exact-contained': '名称包含匹配',
  alias: '别名匹配', 'suffix-strip': '后缀归一匹配', 'prefix-strip': '提供商前缀匹配',
  fuzzy: '模糊匹配', 'fuzzy-litellm': '模糊匹配', default: '默认价格', miss: '未匹配', empty: '模型未记录', reported: '来源报告',
};
const qualityLabels = { recorded: '日志记录', estimated: '文本估算', ledger: '账本补差', mixed: '混合或部分未记录', unknown: '来源未记录' } as const;

/** A click/focus-accessible explanation; no long, interactive content in a hover-only tooltip. */
export function CostExplanationLabel({ report, loading, error }: {
  report: UsageReport | null;
  loading: boolean;
  error: boolean;
}) {
  const explanation = report?.summary.costExplanation;
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <p className="truncate text-xs font-medium leading-5 text-muted">预估费用</p>
      <Popover>
        <Button aria-label="费用与 Token 来源说明" className="size-4 min-h-4 min-w-4 shrink-0 p-0 text-muted" isIconOnly size="sm" variant="ghost">
          <CircleHelp aria-hidden className="size-3.5" />
        </Button>
        <Popover.Content className="max-w-[calc(100vw-2rem)] rounded-xl border-0 bg-overlay p-0 text-overlay-foreground shadow-surface" placement="bottom">
          <Popover.Dialog className="w-96 max-w-full p-4 outline-none">
            <Popover.Heading className="text-sm font-semibold">费用与 Token 来源</Popover.Heading>
            {!explanation ? (
              <p className="mt-2 text-xs text-muted" role="status">{loading ? '正在读取费用依据…' : error ? '费用依据暂不可用，将自动重试。' : '暂无费用依据。'}</p>
            ) : (
              <div className="mt-2 space-y-3 text-xs">
                <p className="text-muted">{report!.fromDate} — {report!.toDate} · 与当前 Agent 筛选一致</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
                  <span className="text-muted">来源报告金额</span><span className="text-right">{formatUsd(explanation.reportedCostUsd)}</span>
                  <span className="text-muted">按价格估算</span><span className="text-right">{formatUsd(explanation.estimatedCostUsd)}</span>
                </div>
                {explanation.defaultPricedTokens > 0 && <p className="text-warning">{formatTokens(explanation.defaultPricedTokens)} Token 使用默认价格估算（{explanation.totalTokens ? (explanation.defaultPricedTokens / explanation.totalTokens * 100).toFixed(1) : '0'}%）。</p>}
                {explanation.unpricedTokens > 0 && <p className="text-warning">{formatTokens(explanation.unpricedTokens)} Token 缺少价格；已计价部分为 {formatUsd(explanation.knownCostUsd)}，未知部分不代表免费。</p>}
                <div>
                  <p className="mb-1 font-medium">Token 依据</p>
                  {Object.entries(qualityLabels).filter(([key]) => explanation.tokenQualityTokens[key as keyof typeof qualityLabels] > 0).map(([key, label]) => (
                    <div key={key} className="flex justify-between gap-3"><span className="text-muted">{label}</span><span className="tabular-nums">{formatTokens(explanation.tokenQualityTokens[key as keyof typeof qualityLabels])}</span></div>
                  ))}
                  {explanation.totalTokens === 0 && <p className="text-muted">所选范围暂无已采集用量。</p>}
                </div>
                <div className="max-h-56 space-y-2 overflow-y-auto overscroll-contain" aria-label="模型计价依据">
                  {explanation.entries.map((entry, index) => (
                    <div key={`${entry.source}:${entry.model}:${index}`} className="rounded-lg bg-default/40 p-2">
                      <p className="break-words font-medium">{entry.model} <span className="font-normal text-muted">· {entry.source}</span></p>
                      <p className="mt-0.5 text-muted">{entry.costKind === 'reported' ? '来源报告金额' : methodLabels[entry.matchMethod] ?? (entry.matchMethod.startsWith('sourceAlias:') ? '来源别名匹配' : '未匹配')}{entry.matchedModel ? ` → ${entry.matchedModel}` : ''}</p>
                      {entry.priceTable && <p className="text-muted">{entry.priceTable === 'builtin' ? '内置价格表' : '更新价格表'} · {entry.priceUpdatedAt ? `表生成于 ${entry.priceUpdatedAt.slice(0, 10)}` : '价格日期未提供'}</p>}
                      <p className="mt-0.5 tabular-nums">{formatTokens(entry.tokens)} Token · {entry.costUsd === null ? '费用未知' : formatUsd(entry.costUsd)}{entry.unpricedTokens > 0 && entry.costUsd !== null ? '（部分未计价）' : ''}</p>
                    </div>
                  ))}
                </div>
                {report!.coverage.limited && <p className="text-muted">可查询数据始于 {report!.coverage.collectSince.slice(0, 10)}；更早用量未包含。</p>}
                <p className="text-muted">来源报告金额也可能是供应商估算，不等同实际付款。旧记录缺少来源标记时显示为“来源未记录”。</p>
              </div>
            )}
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}
