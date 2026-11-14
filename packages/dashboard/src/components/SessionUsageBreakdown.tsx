import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, Popover, Table } from '@heroui/react';
import { useInteractOutside } from 'react-aria';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import type { SupportedLocale } from 'quotern-i18n';
import type { buildSessionDetail, DetailModel, DetailPricingGroup } from '../lib/session-detail';
import { costLabel } from '../lib/session-labels';
import { shouldShowUsageTotal, visibleServiceTiers } from '../lib/session-detail-presentation';
import type { PricingModelSelection } from '../lib/pricing-selection';
import { formatPricingDisplayRate } from '../lib/pricing-display';
import { HelpPopover } from './HelpPopover';
import { isTopmostPopover } from '../lib/overlay-dismiss';

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

const pricingItemKeys = { input: 'usage.detail.uncachedInput', output: 'usage.detail.outputTotal', cache_read: 'usage.detail.cacheRead', cache_write: 'usage.distribution.cacheWrite' } as const;

function PricingRate({ group, format }: { group: DetailPricingGroup; format: DetailFormat }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), content = useRef<HTMLDivElement>(null);
  useInteractOutside({ ref: content, isDisabled: !open, onInteractOutside: event => {
    if (!trigger.current || !event.composedPath().includes(trigger.current)) setOpen(false);
  } });
  useEffect(() => {
    if (!open) return;
    const document = trigger.current?.ownerDocument;
    const onScroll = (event: Event) => {
      if (trigger.current && event.target instanceof Node && event.target.contains(trigger.current)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTopmostPopover(content.current)) return;
      // The outer Modal also owns Escape/focus restoration. Close only this
      // non-modal layer and restore its exact trigger after that layer unmounts.
      event.preventDefault(); event.stopImmediatePropagation();
      setOpen(false);
      requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
    };
    document?.addEventListener('scroll', onScroll, true);
    document?.addEventListener('keydown', onKeyDown, true);
    return () => {
      document?.removeEventListener('scroll', onScroll, true);
      document?.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);
  const items = [...group.items].sort((a, b) => (a.rateUsdPerMillion ?? Infinity) - (b.rateUsdPerMillion ?? Infinity));
  const rates = [...new Set(items.map(item => item.rateUsdPerMillion))];
  const price = (value: number | null) => formatPricingDisplayRate(value, 'USD', null, i18n.resolvedLanguage).text;
  const title = t('usage.detail.rateDetails', { item: t(pricingItemKeys[group.category]) });
  const conditions = (item: DetailPricingGroup['items'][number]) => {
    const condition = item.conditions, parts: string[] = [];
    if (condition?.serviceTier) parts.push(condition.serviceTier === 'fast' ? 'Fast' : 'Flex');
    if (condition?.minInputTokens !== undefined) parts.push(t('usage.detail.longContext'), t(condition.maxInputTokens === undefined ? 'usage.detail.inputOver' : 'usage.detail.inputBetween', {
      min: format.tokens(condition.minInputTokens), max: format.tokens(condition.maxInputTokens),
    }));
    else if (condition?.maxInputTokens !== undefined) parts.push(t('usage.detail.normalContext'), t('usage.detail.inputUpTo', { max: format.tokens(condition.maxInputTokens) }));
    if (!parts.length) parts.push(t(condition ? 'usage.detail.baseRate' : 'usage.detail.conditionsUnavailable'));
    if (item.category === 'cache_write_5m' || item.category === 'cache_write_1h') parts.push(t(item.category === 'cache_write_5m' ? 'usage.detail.cacheWrite5m' : 'usage.detail.cacheWrite1h'));
    return parts.join(' · ');
  };
  if (rates.every(rate => rate === null) && items.every(item => !item.conditions)) return <span>—</span>;
  return <Popover isOpen={open} onOpenChange={setOpen}>
    <Button ref={trigger} variant="ghost" size="sm" aria-label={title} className="h-auto min-h-7 max-w-full gap-1 rounded px-1 py-1 text-xs text-accent tabular-nums" data-pricing-rate={group.category}>
      <span>{rates.length > 2 ? t('usage.detail.rateCount', { count: items.length }) : rates.map(price).join(' / ')}</span><ChevronDown aria-hidden className="size-3 shrink-0" />
    </Button>
    <Popover.Content ref={content} isNonModal shouldSkipAnimation maxHeight={448} placement="bottom end" className="flex w-[36rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border-0 bg-overlay p-0 text-overlay-foreground shadow-surface">
      <Popover.Dialog className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-3 text-xs outline-none sm:p-4" data-pricing-tiers={group.category}>
        <Popover.Heading className="font-semibold">{title}</Popover.Heading>
        <table className="w-full table-fixed text-xs">
          <thead><tr className="border-b border-separator text-left text-muted">
            <th scope="col" className="w-[40%] pb-2 pr-2 font-normal">{t('usage.detail.rateConditions')}</th>
            <th scope="col" className="w-[20%] pb-2 text-right font-normal">{t('usage.detail.quantity')}</th>
            <th scope="col" className="w-[20%] pb-2 pl-2 text-right font-normal">{t('usage.detail.unitPrice')}</th>
            <th scope="col" className="w-[20%] pb-2 pl-2 text-right font-normal">{t('usage.detail.itemCost')}</th>
          </tr></thead>
          <tbody>{items.map((item, index) => <tr key={index} className="border-b border-separator/50 last:border-0">
            <th scope="row" className="break-words py-2 pr-2 text-left font-normal">{conditions(item)}</th>
            <td className="py-2 text-right tabular-nums">{format.tokens(item.tokens)}</td>
            <td className="break-words py-2 pl-2 text-right tabular-nums">{price(item.rateUsdPerMillion)}</td>
            <td className="py-2 pl-2 text-right tabular-nums">{item.costUsd === null && item.knownCostUsd === 0 ? '—' : format.money(item.costUsd, item.knownCostUsd)}</td>
          </tr>)}</tbody>
        </table>
        {items.some(item => item.conditions?.minInputTokens !== undefined || item.conditions?.maxInputTokens !== undefined) && <p className="text-muted">{t('usage.detail.contextRateNote')}</p>}
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}

function ModelPricing({ model, format }: { model: DetailModel; format: DetailFormat }) {
  const { t, i18n } = useTranslation();
  const items = model.costBreakdown;
  const hasLongContext = items.some(item => (item.tokens ?? 0) > 0 && item.conditions?.minInputTokens !== undefined);
  const incomplete = items.some(item => item.costUsd === null);
  const unpricedTokens = model.pricingEvidence.reduce((sum, price) => sum + price.unpricedTokens, 0);
  return <div className="space-y-2 px-3 py-3 sm:px-5" data-model-pricing>
    <div className="flex flex-wrap items-baseline justify-between gap-3"><span className="font-medium">{t('usage.detail.usagePricing')}</span><span className="flex flex-wrap items-center gap-2 text-muted">{hasLongContext && <span className="inline-flex items-center gap-1">{t('usage.detail.includesLongContext')}<HelpPopover title={t('usage.detail.longContext')}><p>{t('usage.detail.contextRateNote')}</p></HelpPopover></span>}{costLabel(model.costKind, (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale)}</span></div>
    <table className="w-full text-xs">
      <caption className="sr-only">{t('usage.detail.modelPricing', { model: model.model })}</caption>
      <thead><tr className="border-b border-separator text-muted">
        <th scope="col" className="py-2 text-left font-normal">{t('usage.detail.pricingItem')}</th>
        <th scope="col" className="px-3 py-2 text-right font-normal">{t('usage.detail.quantity')}</th>
        <th scope="col" className="px-3 py-2 text-right font-normal">{t('usage.detail.unitPrice')}</th>
        <th scope="col" className="py-2 text-right font-normal">{t('usage.detail.itemCost')}</th>
      </tr></thead>
      <tbody>{model.pricingGroups.map(group => <tr key={group.category} className="border-b border-separator/50 last:border-0" data-pricing-item={group.category}>
        <th scope="row" className="py-2 text-left font-normal">{t(pricingItemKeys[group.category])}</th>
        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{format.tokens(group.tokens)}</td>
        <td className="px-3 py-1 text-right tabular-nums"><PricingRate group={group} format={format} /></td>
        <td className="whitespace-nowrap py-2 text-right tabular-nums">{group.costUsd === null && group.knownCostUsd === 0 ? '—' : format.money(group.costUsd, group.knownCostUsd)}</td>
      </tr>)}</tbody>
    </table>
    {incomplete && <p className="text-muted">{t(items.some(item => item.knownCostUsd > 0) ? 'usage.detail.itemCostsPartial' : 'usage.detail.itemCostsUnavailable')}</p>}
    {model.pricingEvidence.some(price => price.assumptions.includes('grok-80-20')) && <p className="text-muted">{t('usage.insights.grokCostAssumption')}</p>}
    {unpricedTokens > 0 && <p className="text-warning">{t('usage.overview.unpriced')}: {format.tokens(unpricedTokens)} Token</p>}
  </div>;
}

export function SessionPricingDetails({ usage, format }: { usage: ReturnType<typeof buildSessionDetail>['usage']; format: DetailFormat }) {
  const { t } = useTranslation();
  const note = usage.costKind === 'recorded' ? 'usage.detail.recordedCostNote' : usage.costKind === 'estimated' ? 'usage.detail.estimatedCostNote' : 'usage.detail.costBasisNote';
  return <>
    <p>{t(note)}</p>
    {usage.costUsd === null && usage.knownCostUsd > 0 && <p>{t('usage.explorer.partial')}</p>}
    {usage.unallocatedCostUsd !== null && <p>{t('usage.explorer.unallocatedCost')}: {format.money(usage.unallocatedCostUsd)}. {t('usage.detail.modelCostCaution')}</p>}
  </>;
}

export function SessionModelBreakdown({ usage, format, pricingModels }: { usage: ReturnType<typeof buildSessionDetail>['usage']; format: DetailFormat; pricingModels: PricingModelSelection[] }) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const id = useId();
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
            {usage.models.flatMap((model, index) => {
              const open = expanded.has(model.model), detailId = `${id}-model-${index}`;
              return [<Table.Row key={model.model} id={`model:${model.model}`} textValue={model.model}>
              <Table.Cell className="max-w-52 break-words font-medium [overflow-wrap:anywhere]" textValue={model.model}><Button size="sm" variant="ghost" className="h-auto min-h-8 max-w-full justify-start gap-1 px-0 text-left text-xs font-medium" aria-label={t('usage.detail.modelPricing', { model: model.model })} aria-expanded={open} aria-controls={open ? detailId : undefined} onPress={() => setExpanded(previous => { const next = new Set(previous); if (next.has(model.model)) next.delete(model.model); else next.add(model.model); return next; })}><ChevronRight className={`size-3.5 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} aria-hidden /><span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{model.model}</span></Button>{visibleServiceTiers(model.serviceTiers).length > 0 && <span className="mt-1 block pl-4 text-xs font-normal text-muted">{visibleServiceTiers(model.serviceTiers).join(' / ')}</span>}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(model.tokens)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(model.input_tokens)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(model.cached_input_tokens)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(model.cache_creation_input_tokens)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.tokens(model.output_tokens === null || model.reasoning_output_tokens === null ? null : model.output_tokens + model.reasoning_output_tokens)}<span className="block text-xs text-muted">{t('usage.detail.includingReasoning')}: {format.tokens(model.reasoning_output_tokens)}</span></Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.number(model.requests)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right tabular-nums">{format.money(model.costUsd, model.knownCostUsd)}{model.costKind !== usage.costKind && <span className="block text-xs text-muted">{costLabel(model.costKind, locale)}</span>}</Table.Cell>
            </Table.Row>, ...(open ? [<Table.Row key={`${model.model}:pricing`} id={`pricing:${model.model}`} textValue={t('usage.detail.modelPricing', { model: model.model })} className="bg-surface-secondary/50"><Table.Cell colSpan={8} className="p-0"><div id={detailId}><ModelPricing model={model} format={format} /></div></Table.Cell></Table.Row>] : [])];
            })}
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
