import { Button, Popover } from '@heroui/react';
import { Link } from '@tanstack/react-router';
import { CircleHelp } from 'lucide-react';
import type { UsageReport } from 'quotern-core';
import { formatTokens, formatUsd } from '@/lib/format';

/** Keep the explanation brief; disclose only pricing exceptions on request. */
export function CostExplanationLabel({ report, loading, error }: {
  report: UsageReport | null;
  loading: boolean;
  error: boolean;
}) {
  const explanation = report?.summary.costExplanation;
  const affectedEntries = explanation?.entries.filter(entry =>
    entry.tokens > 0 && (entry.costKind === 'default_estimate' || entry.costKind === 'unpriced' || entry.unpricedTokens > 0),
  ) ?? [];
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <p className="truncate text-xs font-medium leading-5 text-muted">预估费用</p>
      <Popover>
        <Button aria-label="预估费用说明" className="size-4 min-h-4 min-w-4 shrink-0 p-0 text-muted" isIconOnly size="sm" variant="ghost">
          <CircleHelp aria-hidden className="size-3.5" />
        </Button>
        <Popover.Content className="max-w-[calc(100vw-2rem)] rounded-xl border-0 bg-overlay p-0 text-overlay-foreground shadow-surface" placement="bottom">
          <Popover.Dialog className="max-h-[calc(100dvh-3rem)] w-80 max-w-full overflow-y-auto p-4 outline-none">
            <Popover.Heading className="text-sm font-semibold">预估金额并非实际账单</Popover.Heading>
            <p className="mt-2 text-xs leading-5 text-muted">{explanation && explanation.reportedCostUsd > 0 ? '金额包含来源报告值与按模型参考价估算的费用，可用于了解用量的参考价值。' : '按当前筛选范围的 Token 与模型参考价折算，供你了解同等用量按 API 计费时的大致费用。'}</p>
            <p className="mt-2 text-xs leading-5 text-muted">使用订阅套餐时，套餐内用量通常已包含在订阅费中。可将此金额与订阅费对照，了解套餐价值；实际支付以服务商账单为准。</p>
            {!explanation ? (
              <p className="mt-2 text-xs text-muted" role="status">{loading ? '正在读取费用依据…' : error ? '费用依据暂不可用，将自动重试。' : '暂无费用依据。'}</p>
            ) : (
              <div className="mt-3 space-y-3 text-xs leading-5">
                {explanation.reportedCostUsd > 0 && <div className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
                  <span className="text-muted">来源报告金额</span><span className="text-right">{formatUsd(explanation.reportedCostUsd)}</span>
                  {explanation.estimatedCostUsd > 0 && <><span className="text-muted">按价格估算</span><span className="text-right">{formatUsd(explanation.estimatedCostUsd)}</span></>}
                  <p className="col-span-2 text-muted">来源报告金额也可能是供应商估算。</p>
                </div>}
                {explanation.defaultPricedTokens > 0 && <p className="text-warning">{formatTokens(explanation.defaultPricedTokens)} Token（占总 Token {explanation.totalTokens ? (explanation.defaultPricedTokens / explanation.totalTokens * 100).toFixed(1) : '0'}%）使用默认价格估算。</p>}
                {explanation.unpricedTokens > 0 && <p className="text-warning">{formatTokens(explanation.unpricedTokens)} Token 缺少价格；已计价部分为 {formatUsd(explanation.knownCostUsd)}，未知部分不代表免费。</p>}
                {affectedEntries.length > 0 && <details>
                  <summary className="w-fit cursor-pointer rounded text-muted outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">查看受影响模型（{affectedEntries.length} 项）</summary>
                  <ul aria-label="受影响模型" className="mt-2 space-y-2">
                    {affectedEntries.map((entry, index) => <li key={`${entry.source}:${entry.model}:${index}`} className="rounded-lg bg-default/40 px-2 py-1.5">
                      <p className="break-words font-medium">{entry.model} <span className="font-normal text-muted">· {entry.source}</span></p>
                      <p className="text-muted">{entry.unpricedTokens > 0 || entry.costKind === 'unpriced' ? entry.costUsd === null ? '费用未知' : '部分用量缺少价格' : '使用默认价格'} · {formatTokens(entry.tokens)} Token</p>
                    </li>)}
                  </ul>
                </details>}
                {explanation.totalTokens === 0 && <p className="text-muted">所选范围暂无已采集用量。</p>}
                {report!.coverage.limited && <p className="text-muted">可查询数据始于 {report!.coverage.collectSince.slice(0, 10)}；更早用量未包含。</p>}
              </div>
            )}
            <Link to="/pricing" search={{ q: '' }} className="mt-3 inline-block rounded text-xs text-muted underline underline-offset-4 outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">查看模型参考价 →</Link>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}
