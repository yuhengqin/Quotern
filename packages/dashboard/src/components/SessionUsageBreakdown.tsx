import type { ReactNode } from 'react';
import { Table } from '@heroui/react';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import type { SupportedLocale } from 'quotern-i18n';
import type { buildSessionDetail, DetailModel } from '../lib/session-detail';
import { costLabel } from '../lib/session-labels';
import { shouldShowUsageTotal, visibleServiceTiers } from '../lib/session-detail-presentation';
import type { PricingModelSelection } from '../lib/pricing-selection';
import { HelpPopover } from './HelpPopover';

export type DetailFormat = {
  tokens(value: number | null | undefined): string;
  money(value: number | null | undefined, known?: number): string;
  number(value: number | null | undefined): string;
};

export function DetailDisclosure({ title, summary, children, id }: { title: string; summary?: ReactNode; children: ReactNode; id?: string }) {
  return <details id={id} className="group/disclosure border-t border-separator">
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-md py-3 outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent">
      <span className="flex items-center gap-2 font-medium"><ChevronRight className="size-4 shrink-0 transition-transform group-open/disclosure:rotate-90 motion-reduce:transition-none" aria-hidden />{title}</span>
      {summary && <span className="min-w-0 text-xs text-muted">{summary}</span>}
    </summary>
    <div className="space-y-3 pb-4 pt-1">{children}</div>
  </details>;
}

export function DetailValue({ label, value, className = '' }: { label: ReactNode; value: ReactNode; className?: string }) {
  return <div className={`flex min-w-0 items-baseline justify-between gap-4 ${className}`}><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words text-right tabular-nums text-foreground">{value}</dd></div>;
}

function ModelPricing({ model, format }: { model: DetailModel; format: DetailFormat }) {
  const { t, i18n } = useTranslation();
  const rateKeys: Record<string, string> = { input: 'usage.detail.uncachedInput', output: 'usage.detail.outputTotal', cache_read: 'usage.detail.cacheRead', cache_write: 'usage.distribution.cacheWrite' };
  return <div className="space-y-2">
    <h4 className="break-all font-medium">{model.model} · {costLabel(model.costKind, (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale)}</h4>
    {!model.pricingEvidence.length ? <p className="text-muted">{t('usage.cost.noEvidence')}</p> : model.pricingEvidence.map((price, index) => <div key={index} className="space-y-2 rounded-lg bg-surface-secondary p-3">
      <dl className="space-y-2">
        <DetailValue label={t('usage.detail.priceTable')} value={price.table ?? t('usage.insights.unknown')} />
        <DetailValue label={t('usage.detail.matchedModel')} value={<span className="break-all font-mono text-xs">{price.matchedModel ?? t('usage.insights.unknown')}</span>} />
      </dl>
      {price.rates && <><p className="text-xs text-muted">{t('usage.detail.perMillion')}</p><dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">{Object.entries(price.rates).map(([key, value]) => <DetailValue key={key} label={rateKeys[key] ? t(rateKeys[key]) : key} value={format.money(value)} />)}</dl></>}
      <p className="break-words text-xs text-muted">{t('usage.detail.matchMethod')}: {price.matchMethod}{price.ruleReferences.length > 0 && <> · {price.ruleReferences.join(' · ')}</>}</p>
      {price.assumptions.includes('grok-80-20') && <p className="text-xs text-muted">{t('usage.insights.grokCostAssumption')}</p>}
      {price.unpricedTokens > 0 && <p className="text-xs text-warning">{t('usage.overview.unpriced')}: {format.tokens(price.unpricedTokens)} Token</p>}
    </div>)}
  </div>;
}

export function SessionPricingDetails({ usage, format }: { usage: ReturnType<typeof buildSessionDetail>['usage']; format: DetailFormat }) {
  const { t } = useTranslation();
  const singleBasis = usage.models.length === 1 && usage.models[0]!.pricingEvidence.length <= 1;
  return <>
    <p>{t('usage.detail.costBasisNote')}</p>
    {usage.costUsd === null && usage.knownCostUsd > 0 && <p>{t('usage.explorer.partial')}</p>}
    {usage.unallocatedCostUsd !== null && <p>{t('usage.explorer.unallocatedCost')}: {format.money(usage.unallocatedCostUsd)}. {t('usage.detail.modelCostCaution')}</p>}
    {usage.models.length > 0 && (singleBasis ? <ModelPricing model={usage.models[0]!} format={format} /> : <DetailDisclosure title={t('usage.detail.priceBasis')}>{usage.models.map(model => <ModelPricing key={model.model} model={model} format={format} />)}</DetailDisclosure>)}
  </>;
}

export function SessionModelBreakdown({ usage, format, pricingModels }: { usage: ReturnType<typeof buildSessionDetail>['usage']; format: DetailFormat; pricingModels: PricingModelSelection[] }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  const parts = usage.parts;
  const output = parts.output_tokens === null || parts.reasoning_output_tokens === null ? null : parts.output_tokens + parts.reasoning_output_tokens;
  const requests = usage.models.length > 0 && usage.missingModelTokens === 0 && usage.models.every(model => model.requests != null)
    ? usage.models.reduce((total, model) => total + model.requests!, 0) : null;
  const showTotal = shouldShowUsageTotal(usage);
  return <section aria-label={t('usage.detail.modelCosts')}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1"><h3 className="font-semibold">{t('usage.detail.modelCosts')}</h3>
        <HelpPopover title={t('usage.detail.modelCosts')}>
          <p>{t('usage.detail.tokenPartsNote')}</p><p>{t('usage.detail.roundingNote')}</p>
          {usage.unclassifiedTokens !== null && usage.unclassifiedTokens > 0 && <p>{t('usage.detail.unclassified')}: {format.tokens(usage.unclassifiedTokens)}</p>}
          {usage.missingModelTokens !== null && usage.missingModelTokens > 0 && <p>{t('usage.detail.unassignedModel', { tokens: format.tokens(usage.missingModelTokens) })}</p>}
          {usage.unallocatedCostUsd !== null && <p>{t('usage.explorer.unallocatedCost')}: {format.money(usage.unallocatedCostUsd)}. {t('usage.detail.modelCostCaution')}</p>}
        </HelpPopover>
        {!usage.detailsComplete && usage.models.length > 0 && <span className="text-xs text-muted">{t('usage.detail.incompleteDetails')}</span>}
      </div>
      {pricingModels.length > 0 && <Link to="/pricing" search={{ q: '', models: pricingModels }} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded text-xs text-accent outline-offset-2 focus-visible:outline-2">{t('usage.cost.viewPrices')}</Link>}
    </div>
      {!usage.models.length ? <p className="text-xs text-muted">{t('usage.detail.noModelUsage')}</p> : <Table variant="secondary" className="max-w-full text-xs">
        <Table.ScrollContainer tabIndex={0} role="region" aria-label={t('usage.detail.modelCosts')} className="max-w-full overflow-x-auto overscroll-x-contain">
          <Table.Content aria-label={t('usage.detail.modelCosts')} className="min-w-[50rem]">
            <Table.Header>
              <Table.Column isRowHeader className="min-w-40">{t('usage.common.model')}</Table.Column>
              <Table.Column className="text-right">{t('usage.common.totalTokens')}</Table.Column>
              <Table.Column className="text-right">{t('usage.detail.uncachedInput')}</Table.Column>
              <Table.Column className="text-right">{t('usage.detail.cacheRead')}</Table.Column>
              <Table.Column className="text-right">{t('usage.distribution.cacheWrite')}</Table.Column>
              <Table.Column className="text-right">{t('usage.detail.outputTotal')}</Table.Column>
              <Table.Column className="text-right">{t('usage.explorer.requests')}</Table.Column>
              <Table.Column className="text-right">{t('usage.common.cost')}</Table.Column>
            </Table.Header>
            <Table.Body>
            {usage.models.map(model => <Table.Row key={model.model} id={`model:${model.model}`}>
              <Table.Cell className="max-w-52 break-words font-medium [overflow-wrap:anywhere]">{model.model}{visibleServiceTiers(model.serviceTiers).length > 0 && <span className="mt-1 block text-xs font-normal text-muted">{visibleServiceTiers(model.serviceTiers).join(' / ')}</span>}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(model.tokens)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(model.input_tokens)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(model.cached_input_tokens)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(model.cache_creation_input_tokens)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(model.output_tokens === null || model.reasoning_output_tokens === null ? null : model.output_tokens + model.reasoning_output_tokens)}<span className="block text-xs text-muted">{t('usage.detail.includingReasoning')}: {format.tokens(model.reasoning_output_tokens)}</span></Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.number(model.requests)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.money(model.costUsd, model.knownCostUsd)}{model.costKind !== usage.costKind && <span className="block text-xs text-muted">{costLabel(model.costKind, locale)}</span>}</Table.Cell>
            </Table.Row>)}
            {showTotal && <Table.Row id="usage:total" className="[&>td]:border-t [&>td]:border-separator [&>td]:font-medium">
              <Table.Cell>{t('usage.common.total')}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(usage.tokens)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(parts.input_tokens)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(parts.cached_input_tokens)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(parts.cache_creation_input_tokens)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(output)}<span className="block text-xs font-normal text-muted">{t('usage.detail.includingReasoning')}: {format.tokens(parts.reasoning_output_tokens)}</span></Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.number(requests)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.money(usage.costUsd, usage.knownCostUsd)}</Table.Cell>
            </Table.Row>}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>}
  </section>;
}
