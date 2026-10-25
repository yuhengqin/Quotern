import type { ReactNode } from 'react';
import { Table } from '@heroui/react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import type { SupportedLocale } from 'quotern-i18n';
import type { buildSessionDetail, DetailModel } from '../lib/session-detail';
import { costLabel } from '../lib/session-labels';

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

export function DetailValue({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex min-w-0 items-baseline justify-between gap-4"><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words text-right tabular-nums text-foreground">{value}</dd></div>;
}

export function SessionTokenBreakdown({ usage, format }: { usage: ReturnType<typeof buildSessionDetail>['usage']; format: DetailFormat }) {
  const { t } = useTranslation();
  const parts = usage.parts;
  const output = parts.output_tokens === null || parts.reasoning_output_tokens === null ? null : parts.output_tokens + parts.reasoning_output_tokens;
  return <section aria-label={t('usage.detail.tokenBreakdown')}>
    <h3 className="mb-3 font-semibold">{t('usage.detail.tokenBreakdown')}</h3>
    <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
      <dl className="space-y-2">
        <DetailValue label={t('usage.detail.uncachedInput')} value={format.tokens(parts.input_tokens)} />
        <DetailValue label={t('usage.detail.cacheRead')} value={format.tokens(parts.cached_input_tokens)} />
        <DetailValue label={t('usage.distribution.cacheWrite')} value={format.tokens(parts.cache_creation_input_tokens)} />
      </dl>
      <dl className="space-y-2">
        <DetailValue label={t('usage.detail.outputTotal')} value={format.tokens(output)} />
        <div className="border-l-2 border-separator pl-3"><DetailValue label={t('usage.detail.includingReasoning')} value={format.tokens(parts.reasoning_output_tokens)} /></div>
        {usage.unclassifiedTokens !== null && usage.unclassifiedTokens > 0 && <DetailValue label={t('usage.detail.unclassified')} value={format.tokens(usage.unclassifiedTokens)} />}
      </dl>
    </div>
    {!usage.detailsComplete && <p className="mt-3 text-xs text-muted">{t('usage.detail.partialTokens')}</p>}
  </section>;
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

export function SessionModelBreakdown({ usage, format }: { usage: ReturnType<typeof buildSessionDetail>['usage']; format: DetailFormat }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  return <section aria-label={t('usage.detail.modelCosts')}>
    <h3 className="mb-3 font-semibold">{t('usage.detail.modelCosts')}</h3>
    {usage.models.length > 0 ? <>
      <Table variant="secondary" className="max-w-full text-xs">
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
            <Table.Body>{usage.models.map(model => <Table.Row key={model.model} id={model.model}>
              <Table.Cell className="max-w-52 break-words font-medium [overflow-wrap:anywhere]">{model.model}<span className="mt-1 block text-xs font-normal text-muted">{model.serviceTiers.filter(tier => tier !== 'unknown').join(' / ')}</span></Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(model.tokens)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(model.input_tokens)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(model.cached_input_tokens)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(model.cache_creation_input_tokens)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(model.output_tokens === null || model.reasoning_output_tokens === null ? null : model.output_tokens + model.reasoning_output_tokens)}<span className="block text-xs text-muted">{t('usage.detail.includingReasoning')}: {format.tokens(model.reasoning_output_tokens)}</span></Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.number(model.requests)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.money(model.costUsd, model.knownCostUsd)}<span className="block text-xs text-muted">{costLabel(model.costKind, locale)}</span></Table.Cell>
            </Table.Row>)}</Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <DetailDisclosure title={t('usage.detail.priceBasis')}>{usage.models.map(model => <ModelPricing key={model.model} model={model} format={format} />)}</DetailDisclosure>
    </> : <p className="text-muted">{t('usage.activity.modelNotRecorded')}</p>}
    {usage.missingModelTokens !== null && usage.missingModelTokens > 0 && <p className="mt-2 text-xs text-muted">{t('usage.detail.unassignedModel', { tokens: format.tokens(usage.missingModelTokens) })}</p>}
    {usage.unallocatedCostUsd !== null && <p className="mt-2 rounded-lg bg-surface-secondary p-3 text-xs">{t('usage.explorer.unallocatedCost')}: {format.money(usage.unallocatedCostUsd)}. {t('usage.detail.modelCostCaution')}</p>}
  </section>;
}
