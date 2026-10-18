import type { UsageReport } from 'quotern-core';
import { formatTokens } from '@/lib/format';
import { useTranslation } from 'quotern-i18n/react';

const qualityLabels = {
  recorded: 'usage.tokens.recorded',
  estimated: 'usage.tokens.estimated',
  ledger: 'usage.tokens.ledger',
  mixed: 'usage.tokens.mixed',
  unknown: 'usage.tokens.unknown',
} as const;

/** Interactive provenance belongs in the clicked Token panel, never its hover tooltip. */
export function TokenSourceDetails({ report, loading, error }: {
  report: UsageReport | null;
  loading: boolean;
  error: boolean;
}) {
  const { t } = useTranslation();
  const explanation = report?.summary.costExplanation;
  return (
    <details className="mt-3 max-w-72 border-t border-border/70 pt-2 text-xs">
      <summary className="w-fit cursor-pointer rounded font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{t('usage.tokens.evidence')}</summary>
      {!explanation ? (
        <p className="mt-2 text-muted" role="status">{t(loading ? 'usage.tokens.loadingEvidence' : error ? 'usage.tokens.evidenceError' : 'usage.tokens.noEvidence')}</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {Object.entries(qualityLabels).filter(([key]) => explanation.tokenQualityTokens[key as keyof typeof qualityLabels] > 0).map(([key, label]) => (
            <div key={key} className="flex justify-between gap-3"><span className="text-muted">{t(label)}</span><span className="shrink-0 tabular-nums">{formatTokens(explanation.tokenQualityTokens[key as keyof typeof qualityLabels])}</span></div>
          ))}
          {explanation.totalTokens === 0 && <p className="text-muted">{t('usage.cost.noCollectedUsage')}</p>}
          <p className="pt-1 text-[10px] leading-4 text-muted">{t('usage.tokens.methodNote')}</p>
          {explanation.tokenQualityTokens.unknown > 0 && <p className="text-[10px] leading-4 text-muted">{t('usage.tokens.unknownNote')}</p>}
        </div>
      )}
    </details>
  );
}
