import type { UsageReport } from 'quotern-core';
import { formatTokens } from '@/lib/format';

const qualityLabels = {
  recorded: '日志记录',
  estimated: '文本估算',
  ledger: '账本补差',
  mixed: '混合记录或部分未标注',
  unknown: '旧记录未标注统计方式',
} as const;

/** Interactive provenance belongs in the clicked Token panel, never its hover tooltip. */
export function TokenSourceDetails({ report, loading, error }: {
  report: UsageReport | null;
  loading: boolean;
  error: boolean;
}) {
  const explanation = report?.summary.costExplanation;
  return (
    <details className="mt-3 max-w-72 border-t border-border/70 pt-2 text-xs">
      <summary className="w-fit cursor-pointer rounded font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">统计依据</summary>
      {!explanation ? (
        <p className="mt-2 text-muted" role="status">{loading ? '正在读取统计依据…' : error ? '统计依据暂不可用，将自动重试。' : '暂无统计依据。'}</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {Object.entries(qualityLabels).filter(([key]) => explanation.tokenQualityTokens[key as keyof typeof qualityLabels] > 0).map(([key, label]) => (
            <div key={key} className="flex justify-between gap-3"><span className="text-muted">{label}</span><span className="shrink-0 tabular-nums">{formatTokens(explanation.tokenQualityTokens[key as keyof typeof qualityLabels])}</span></div>
          ))}
          {explanation.totalTokens === 0 && <p className="text-muted">所选范围暂无已采集用量。</p>}
          <p className="pt-1 text-[10px] leading-4 text-muted">按当前日期和 Agent 筛选统计。文本估算按内容推算，账本补差来自累计用量。</p>
          {explanation.tokenQualityTokens.unknown > 0 && <p className="text-[10px] leading-4 text-muted">旧记录未标注统计方式，不代表用量缺失。</p>}
        </div>
      )}
    </details>
  );
}
