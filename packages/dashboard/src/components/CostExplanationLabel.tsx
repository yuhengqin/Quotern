import { Button, Popover } from '@heroui/react';
import { Link } from '@tanstack/react-router';
import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import type { UsageReport } from 'quotern-core';
import { formatTokens, formatUsd } from '@/lib/format';

/** Keep the explanation brief; disclose only pricing exceptions on request. */
export function CostExplanationLabel({ report, loading, error }: {
  report: UsageReport | null;
  loading: boolean;
  error: boolean;
}) {
  const { t } = useTranslation();
  const explanation = report?.summary.costExplanation;
  const affectedEntries = explanation?.entries.filter(entry =>
    entry.tokens > 0 && (entry.costKind === 'default_estimate' || entry.costKind === 'unpriced' || entry.unpricedTokens > 0),
  ) ?? [];
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <p className="truncate text-xs font-medium leading-5 text-muted">{t('usage.common.estimatedCost')}</p>
      <Popover>
        <Button aria-label={t('usage.cost.helpAria')} className="size-4 min-h-4 min-w-4 shrink-0 p-0 text-muted" isIconOnly size="sm" variant="ghost">
          <CircleHelp aria-hidden className="size-3.5" />
        </Button>
        <Popover.Content className="max-w-[calc(100vw-2rem)] rounded-xl border-0 bg-overlay p-0 text-overlay-foreground shadow-surface" placement="bottom">
          <Popover.Dialog className="max-h-[calc(100dvh-3rem)] w-80 max-w-full overflow-y-auto p-4 outline-none">
            <Popover.Heading className="text-sm font-semibold">{t('usage.cost.notBill')}</Popover.Heading>
            <p className="mt-2 text-xs leading-5 text-muted">{t(explanation && explanation.reportedCostUsd > 0 ? 'usage.cost.reportedAndEstimated' : 'usage.cost.estimatedOnly')}</p>
            <p className="mt-2 text-xs leading-5 text-muted">{t('usage.cost.subscriptionNote')}</p>
            {!explanation ? (
              <p className="mt-2 text-xs text-muted" role="status">{t(loading ? 'usage.cost.loadingEvidence' : error ? 'usage.cost.evidenceError' : 'usage.cost.noEvidence')}</p>
            ) : (
              <div className="mt-3 space-y-3 text-xs leading-5">
                {explanation.reportedCostUsd > 0 && <div className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
                  <span className="text-muted">{t('usage.cost.reportedAmount')}</span><span className="text-right">{formatUsd(explanation.reportedCostUsd)}</span>
                  {explanation.estimatedCostUsd > 0 && <><span className="text-muted">{t('usage.cost.priceEstimate')}</span><span className="text-right">{formatUsd(explanation.estimatedCostUsd)}</span></>}
                  <p className="col-span-2 text-muted">{t('usage.cost.reportedMayBeEstimate')}</p>
                </div>}
                {explanation.defaultPricedTokens > 0 && <p className="text-warning">{t('usage.cost.defaultPriceTokens', { tokens: formatTokens(explanation.defaultPricedTokens), percent: explanation.totalTokens ? (explanation.defaultPricedTokens / explanation.totalTokens * 100).toFixed(1) : '0' })}</p>}
                {explanation.unpricedTokens > 0 && <p className="text-warning">{t('usage.cost.unpricedTokens', { tokens: formatTokens(explanation.unpricedTokens), amount: formatUsd(explanation.knownCostUsd) })}</p>}
                {affectedEntries.length > 0 && <details>
                  <summary className="w-fit cursor-pointer rounded text-muted outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{t('usage.cost.affectedModels', { count: affectedEntries.length })}</summary>
                  <ul aria-label={t('usage.cost.affectedModelsAria')} className="mt-2 space-y-2">
                    {affectedEntries.map((entry, index) => <li key={`${entry.source}:${entry.model}:${index}`} className="rounded-lg bg-default/40 px-2 py-1.5">
                      <p className="break-words font-medium">{entry.model} <span className="font-normal text-muted">· {entry.source}</span></p>
                      <p className="text-muted">{t(entry.unpricedTokens > 0 || entry.costKind === 'unpriced' ? entry.costUsd === null ? 'usage.cost.amountUnknown' : 'usage.cost.partlyUnpriced' : 'usage.cost.defaultPrice')} · {formatTokens(entry.tokens)} Token</p>
                    </li>)}
                  </ul>
                </details>}
                {explanation.totalTokens === 0 && <p className="text-muted">{t('usage.cost.noCollectedUsage')}</p>}
                {report!.coverage.limited && <p className="text-muted">{t('usage.cost.coverageSince', { date: report!.coverage.collectSince.slice(0, 10) })}</p>}
              </div>
            )}
            <Link to="/pricing" search={{ q: '' }} className="mt-3 inline-block rounded text-xs text-muted underline underline-offset-4 outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{t('usage.cost.viewPrices')}</Link>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}
