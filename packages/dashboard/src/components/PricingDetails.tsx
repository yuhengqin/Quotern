import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, Popover, Tooltip } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { pricingRegionMessageKeys } from '../i18n/pricing-messages';
import type { PricingCurrency } from '../lib/pricing-currency';
import type { PricingModelGroup, PricingVariant } from '../lib/pricing-groups';
import { formatPricingContext } from '../lib/pricing-groups';
import { formatPricingDisplayRate, getPricingVariantAliases, splitPricingHighlight } from '../lib/pricing-display';
import { estimatePricingCost, PRICING_TOKEN_FIELDS, type PricingScenario } from '../lib/pricing-workbench';
import type { PricingCatalogRow } from '../lib/pricing-data';

const RATE_FIELD_KEYS = {
  input: 'pricing.metric.input', output: 'pricing.metric.output',
  cacheRead: 'pricing.metric.cacheRead', cacheWrite: 'pricing.metric.cacheWrite',
} as const;

export type PriceDisplay = { currency: PricingCurrency; exchangeRate: number | null };

export function PricingHighlight({ text, query = '' }: { text: string; query?: string }) {
  return <>{splitPricingHighlight(text, query).map((part, index) => part.match
    ? <mark key={index} className="rounded-sm bg-warning/20 text-inherit">{part.text}</mark>
    : part.text)}</>;
}

export function CopyPricingId({ model, label, query = '' }: { model: string; label?: string; query?: string }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<{ model: string; status: 'copied' | 'error' } | null>(null);
  const status = result?.model === model ? result.status : 'idle';
  return <span className="inline-flex min-w-0 max-w-full items-center gap-1" title={t(status === 'copied' ? 'pricing.details.copiedTitle' : 'pricing.details.copyTitle', { model })}>
    <Button isIconOnly={!label} size="sm" variant={label ? 'tertiary' : 'ghost'}
      className={label ? '!h-6 !min-h-6 min-w-0 max-w-40 !gap-1 !rounded-md !px-1.5 font-mono !text-[11px]' : '!size-6 !min-h-6 !min-w-6 !rounded-md !p-0 text-muted'}
      aria-label={t('pricing.details.copyAria', { model })} onPress={async () => {
        try { await navigator.clipboard.writeText(model); setResult({ model, status: 'copied' }); }
        catch { setResult({ model, status: 'error' }); }
      }}>
      {label && <span className="min-w-0 truncate"><PricingHighlight text={label} query={query} /></span>}
      {status === 'copied' ? <Check className="size-3 shrink-0 text-success" aria-hidden /> : <Copy className="size-3 shrink-0" aria-hidden />}
    </Button>
    <span role="status" className={status === 'error' ? 'text-[10px] text-danger' : 'sr-only'}>{status === 'copied' ? t('pricing.details.copiedStatus', { model }) : status === 'error' ? t('pricing.details.copyFailed') : ''}</span>
  </span>;
}

function CallingIds({ models, query }: { models: string[]; query: string }) {
  return <div className="space-y-2">{models.map(model => <div key={model} className="flex min-w-0 items-start gap-2">
    <code className="min-w-0 flex-1 select-text break-all text-[11px] leading-5"><PricingHighlight text={model} query={query} /></code>
    <CopyPricingId model={model} />
  </div>)}</div>;
}

export function PricingAliases({ group, variant, query }: { group: PricingModelGroup; variant: PricingVariant; query: string }) {
  const { t } = useTranslation();
  if (variant.row.billingMode === 'subscription') return null;
  const aliases = getPricingVariantAliases(group.canonicalModelId ?? group.model, variant.entries.map(entry => entry.model));
  const visible = aliases.slice(0, 2);
  const remaining = aliases.slice(2);
  return <>{visible.map(alias => alias.models.length === 1
    ? <CopyPricingId key={alias.label} model={alias.models[0]!} label={alias.label} query={query} />
    : <Popover key={alias.label}>
      <Button size="sm" variant="tertiary" className="!h-6 !min-h-6 min-w-0 max-w-40 !rounded-md !px-1.5 font-mono !text-[11px]" aria-label={t('pricing.details.aliasAria', { alias: alias.label })}><span className="truncate"><PricingHighlight text={alias.label} query={query} /></span></Button>
      <Popover.Content className="w-88 max-w-[calc(100vw-2rem)]"><Popover.Dialog className="space-y-2 p-3"><Popover.Heading className="text-xs">{t('pricing.details.chooseId')}</Popover.Heading><CallingIds models={alias.models} query={query} /></Popover.Dialog></Popover.Content>
    </Popover>)}
    {remaining.length > 0 && <Popover>
      <Button size="sm" variant="tertiary" className="!h-6 !min-h-6 !min-w-6 !rounded-md !px-1.5 !text-[11px]" aria-label={t('pricing.details.otherAliases', { count: remaining.length })}>+{remaining.length}</Button>
      <Popover.Content className="w-88 max-w-[calc(100vw-2rem)]"><Popover.Dialog className="space-y-2 p-3"><Popover.Heading className="text-xs">{t('pricing.details.moreIds')}</Popover.Heading><CallingIds models={remaining.flatMap(alias => alias.models)} query={query} /></Popover.Dialog></Popover.Content>
    </Popover>}
  </>;
}

export function PricingRate({ value, currency, exchangeRate, unit }: { value: number | null; unit?: string } & PriceDisplay) {
  const { t, i18n } = useTranslation();
  const shownUnit = unit ?? t('pricing.metric.perMillion');
  const price = formatPricingDisplayRate(value, currency, exchangeRate, i18n.language);
  if (!price.approximate) return <span className="whitespace-nowrap font-mono tabular-nums">{price.text}</span>;
  return <Tooltip delay={200}>
    <Tooltip.Trigger className="inline-flex cursor-help whitespace-nowrap rounded font-mono tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-accent" aria-label={t('pricing.details.exactAria', { price: price.text, exact: price.exact, unit: shownUnit })}>
      {price.text}
    </Tooltip.Trigger>
    <Tooltip.Content><span className="font-mono">{price.exact}</span><span className="ml-1 text-muted">{shownUnit}</span></Tooltip.Content>
  </Tooltip>;
}

export function PricingEstimatedCost({ row, scenario, currency, exchangeRate }: { row: PricingCatalogRow; scenario: PricingScenario } & PriceDisplay) {
  const { t, i18n } = useTranslation();
  const estimate = estimatePricingCost(row, scenario);
  if (estimate.status === 'ready') {
    const price = formatPricingDisplayRate(estimate.totalUsd, currency, exchangeRate, i18n.language);
    return <span className="whitespace-nowrap font-mono tabular-nums" title={price.exact === '—' ? t('pricing.exchange.unavailableValue') : t('pricing.details.referenceCost', { price: price.exact })}>{price.text}</span>;
  }
  const fields = new Intl.ListFormat(i18n.language).format(estimate.missing.map(key => t(RATE_FIELD_KEYS[key])));
  const description = estimate.status === 'missing' ? t('pricing.details.missingRates', { fields })
    : estimate.status === 'subscription' ? t('pricing.details.subscriptionEstimate') : t('pricing.details.invalidEstimate');
  return <span className="text-[11px] text-muted" title={description}>{estimate.status === 'subscription' ? t('pricing.details.subscriptionNotApplicable') : estimate.status === 'missing' ? description : t('pricing.details.cannotEstimate')}</span>;
}

export function PricingChannelDetails({ name, variant, currency, exchangeRate, query = '' }: { name: string; variant: PricingVariant; query?: string } & PriceDisplay) {
  const { t, i18n } = useTranslation();
  const subscription = variant.row.billingMode === 'subscription';
  const regions = variant.regions.map(region => t(pricingRegionMessageKeys[region] ?? region)).join(' / ');
  const channelLabel = `${regions} ${subscription ? t('pricing.list.subscription') : 'API'}`.trim();
  const context = formatPricingContext(variant.row.contextWindow, i18n.language);
  return <Popover>
    <Button size="sm" variant="ghost" className="!h-6 !min-h-6 !min-w-0 shrink-0 !rounded-md !px-1 !text-[11px] text-muted" aria-label={t('pricing.details.channelAria', { name, channel: channelLabel, context, model: variant.row.model })}>
      {t('pricing.details.channelDetails')}
    </Button>
    <Popover.Content placement="bottom start" className="w-96 max-w-[calc(100vw-2rem)]">
      <Popover.Dialog className="space-y-3 p-3">
        <div><Popover.Heading className="text-sm">{name}</Popover.Heading><p className="mt-1 text-xs text-muted">{channelLabel} · {t('pricing.details.contextValue', { value: context })}</p></div>
        {subscription ? <p className="text-xs text-muted">{t('pricing.details.subscriptionNote')}</p> : <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {PRICING_TOKEN_FIELDS.map(([key]) => <div key={key} className="flex items-baseline justify-between gap-2"><dt className="text-muted">{t(RATE_FIELD_KEYS[key])}</dt><dd className="font-mono tabular-nums">{formatPricingDisplayRate(variant.row[key], currency, exchangeRate, i18n.language).exact}</dd></div>)}
          <div className="col-span-2 text-[11px] text-muted">{currency} {t('pricing.metric.perMillion')}{currency === 'CNY' ? ` · ${t('pricing.details.cnyConversion')}` : ''}</div>
        </dl>}
        <div className="space-y-2 border-t border-border/60 pt-2">
          <p className="text-[11px] text-muted">{t('pricing.metric.callingId')}</p>
          <CallingIds models={variant.entries.map(entry => entry.model)} query={query} />
        </div>
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}
