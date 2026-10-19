import { useState, type ReactNode } from 'react';
import { Label, ListBox, Modal, Select } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { pricingRegionMessageKeys } from '../i18n/pricing-messages';
import { ModelProviderIcon } from './ModelProviderIcon';
import { CopyPricingId, PricingEstimatedCost, PricingRate, type PriceDisplay } from './PricingDetails';
import { PricingCalculator, PricingScenarioSummary } from './PricingTools';
import { getPricingModelName, getPricingProvider } from '../lib/pricing-catalog';
import { formatPricingContext, getPrimaryPricingVariant, type PricingModelGroup, type PricingVariant } from '../lib/pricing-groups';
import { comparePricingCosts, estimatePricingCost, getCacheReadSavings, type PricingScenario } from '../lib/pricing-workbench';
import { formatPricingDisplayRate, formatPricingReleaseDate, formatPricingTokens } from '../lib/pricing-display';
import { FilterSelectPopover } from './FilterMenu';

export function PricingComparison({ groups, initialChannels, onClose, scenario, onScenarioChange, currency, exchangeRate, usageStatus }: {
  groups: PricingModelGroup[]; onClose: () => void; scenario: PricingScenario;
  initialChannels: Record<string, string>;
  onScenarioChange: (value: PricingScenario) => void; usageStatus: 'loading' | 'ready' | 'error';
} & PriceDisplay) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const channelLabel = (variant: PricingVariant): string => {
    const regions = variant.regions.map(region => t(pricingRegionMessageKeys[region] ?? region)).join(' / ');
    return `${variant.row.billingMode === 'subscription' ? t('pricing.list.subscription') : 'API'}${regions ? ` · ${regions}` : ''} · ${formatPricingContext(variant.row.contextWindow, locale)} · ${variant.row.model}`;
  };
  const [channels, setChannels] = useState(initialChannels);
  const selections = groups.map(group => ({
    group,
    variant: [...group.apiVariants, ...group.subscriptionVariants].find(variant => variant.id === channels[group.id]) ?? getPrimaryPricingVariant(group),
  }));
  const comparisons = comparePricingCosts(selections.map(({ variant }) => estimatePricingCost(variant.row, scenario).totalUsd));
  const sameCosts = comparisons.every(comparison => comparison?.isLowest);
  const lowestCount = comparisons.filter(comparison => comparison?.isLowest).length;
  const canDisplayPrice = currency === 'USD' || (exchangeRate !== null && Number.isFinite(exchangeRate) && exchangeRate > 0);
  const rateValues = (key: 'input' | 'output' | 'cacheRead' | 'cacheWrite') => selections.map(({ variant }) => variant.row.billingMode === 'subscription' ? null : variant.row[key]);
  const renderRate = (variant: PricingVariant, key: 'input' | 'output' | 'cacheRead' | 'cacheWrite') => variant.row.billingMode === 'subscription'
    ? <span className="text-[11px] text-muted">{t('pricing.details.subscriptionNotApplicable')}</span> : <PricingRate value={variant.row[key]} currency={currency} exchangeRate={exchangeRate} />;
  const metrics: Array<{ id: string; label: string; detail?: string; values?: Array<number | null>; preferred?: 'lower' | 'higher'; primary?: boolean; supporting?: boolean; render: (group: PricingModelGroup, variant: PricingVariant) => ReactNode }> = [
    { id: 'input', label: t('pricing.metric.input'), detail: t('pricing.metric.perMillion'), values: canDisplayPrice ? rateValues('input') : undefined, preferred: 'lower', primary: true, render: (_, variant) => renderRate(variant, 'input') },
    { id: 'output', label: t('pricing.metric.output'), detail: t('pricing.metric.perMillion'), values: canDisplayPrice ? rateValues('output') : undefined, preferred: 'lower', primary: true, render: (_, variant) => renderRate(variant, 'output') },
    { id: 'context', label: t('pricing.metric.context'), values: selections.map(({ variant }) => {
      const value = variant.row.contextWindow;
      return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : null;
    }), preferred: 'higher', primary: true, render: (_, variant) => formatPricingContext(variant.row.contextWindow, locale) },
    { id: 'cacheRead', label: t('pricing.metric.cacheRead'), detail: `${t('pricing.metric.perMillion')} · ${scenario.cacheRead === 0 ? t('pricing.metric.notUsed') : t('pricing.metric.usedTokens', { count: formatPricingTokens(scenario.cacheRead, locale) })}`, values: canDisplayPrice ? rateValues('cacheRead') : undefined, preferred: 'lower', render: (_, variant) => renderRate(variant, 'cacheRead') },
    { id: 'cacheWrite', label: t('pricing.metric.cacheWrite'), detail: `${t('pricing.metric.perMillion')} · ${scenario.cacheWrite === 0 ? t('pricing.metric.notUsed') : t('pricing.metric.usedTokens', { count: formatPricingTokens(scenario.cacheWrite, locale) })}`, values: canDisplayPrice ? rateValues('cacheWrite') : undefined, preferred: 'lower', render: (_, variant) => renderRate(variant, 'cacheWrite') },
    { id: 'cacheSavings', label: t('pricing.metric.cacheSavings'), detail: t('pricing.metric.vsInput'), render: (_, variant) => {
      const saving = getCacheReadSavings(variant.row);
      const percent = saving == null ? '' : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Math.abs(saving));
      return saving == null ? '—' : saving >= 0 ? t('pricing.metric.saving', { percent }) : t('pricing.metric.moreExpensive', { percent });
    } },
    { id: 'release', label: t('pricing.metric.releaseDate'), supporting: true, render: (_, variant) => variant.row.releaseDate ? formatPricingReleaseDate(variant.row.releaseDate, locale) : t('pricing.metric.notRecorded') },
    { id: 'usage', label: t('pricing.metric.personalUsage'), detail: t('pricing.metric.modelTotal'), supporting: true, render: group => usageStatus === 'error' ? t('pricing.metric.usageUnavailable') : usageStatus === 'loading' ? t('pricing.metric.loading') : (group.usageTokens ?? 0) > 0 ? formatPricingTokens(group.usageTokens!, locale) : t('pricing.metric.noMatchingUsage') },
    { id: 'callingId', label: t('pricing.metric.callingId'), supporting: true, render: (_, variant) => <div className="space-y-2">{variant.entries.map(entry => <div key={entry.model} className="flex items-start gap-1"><code className="min-w-0 flex-1 select-text break-all text-[11px] leading-5">{entry.model}</code><CopyPricingId model={entry.model} /></div>)}</div> },
  ];
  return <Modal.Backdrop isOpen onOpenChange={open => { if (!open) onClose(); }}>
    <Modal.Container scroll="inside" placement="center" className="p-3 sm:p-6">
      <Modal.Dialog className="w-full !max-w-[1160px] min-w-0 !max-h-[calc(100dvh-1.5rem)]">
        <Modal.CloseTrigger aria-label={t('pricing.compare.close')} />
        <Modal.Header className="gap-2 pr-12">
          <Modal.Heading>{t('pricing.compare.title')} <span className="text-sm font-normal text-muted">{groups.length} / 4</span></Modal.Heading>
          <p className="text-xs text-muted">{t('pricing.compare.subtitle', { currency })}</p>
          <div className="flex flex-wrap items-center gap-2">
            <PricingCalculator scenario={scenario} onChange={onScenarioChange} enabled comparison onEnabledChange={() => {}} />
            <span className="text-[11px] text-muted"><PricingScenarioSummary scenario={scenario} /></span>
          </div>
        </Modal.Header>
        <Modal.Body className="min-w-0">
          <p className="mb-2 text-[11px] text-muted sm:hidden">{t('pricing.compare.scrollHint')}</p>
          <div role="region" aria-label={t('pricing.compare.scrollRegion')} tabIndex={0} className="max-w-full overflow-auto overscroll-contain rounded-xl border border-border/70 outline-none focus-visible:outline-2 focus-visible:outline-accent">
            <table className="w-full border-separate border-spacing-0 text-left text-xs" style={{ minWidth: 112 + groups.length * 210 }}>
              <caption className="sr-only">{t('pricing.compare.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 top-0 z-20 w-28 min-w-28 bg-surface-secondary p-3 text-muted">{t('pricing.compare.modelChannel')}</th>
                  {selections.map(({ group, variant }) => {
                    const provider = getPricingProvider(group.model);
                    const name = getPricingModelName(group.model, group.displayName);
                    const variants = [...group.apiVariants, ...group.subscriptionVariants];
                    return <th scope="col" key={group.id} className="sticky top-0 z-10 min-w-52 bg-surface-secondary p-3 align-top">
                      <div className="mb-2 flex items-center gap-2"><ModelProviderIcon provider={provider} size={20} /><span className="font-[system-ui,sans-serif] text-sm font-semibold">{name}</span></div>
                      <p className="mb-2 text-[11px] font-normal text-muted">{provider.key === 'unknown' ? t('pricing.provider.other') : provider.label}</p>
                      {variants.length > 1 ? <Select aria-label={t('pricing.compare.channelSelect', { name })} value={variant.id} onChange={key => { if (typeof key === 'string') setChannels(current => ({ ...current, [group.id]: key })); }} variant="secondary" className="w-full min-w-0">
                        <Label className="sr-only">{t('pricing.compare.channelSelect', { name })}</Label>
                        <Select.Trigger className="!h-auto !min-h-8 max-w-full !rounded-lg !text-[11px]"><Select.Value className="min-w-0 max-w-48 truncate" /><Select.Indicator /></Select.Trigger>
                        <FilterSelectPopover className="w-80 max-w-[calc(100vw-2rem)]"><ListBox aria-label={t('pricing.compare.channelOptions', { name })}>
                          {variants.map(item => <ListBox.Item id={item.id} key={item.id} textValue={channelLabel(item)} className="text-xs"><span className="min-w-0 break-all">{channelLabel(item)}</span><ListBox.ItemIndicator /></ListBox.Item>)}
                        </ListBox></FilterSelectPopover>
                      </Select> : <p className="max-w-64 break-all text-[11px] font-normal text-muted">{channelLabel(variant)}</p>}
                    </th>;
                  })}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" className="sticky left-0 z-10 border-t border-border/60 bg-surface-secondary p-3 font-medium">{t('pricing.compare.equalUsageCost')}<span className="mt-1 block text-[10px] font-normal text-muted">{t('pricing.compare.currentUsage')}</span></th>
                  {selections.map(({ group, variant }, index) => {
                    const comparison = canDisplayPrice ? comparisons[index] : null;
                    const lowest = Boolean(comparison?.isLowest);
                    return <td key={group.id} className={`border-t border-border/60 p-3 align-top ${lowest ? 'bg-accent-soft/60' : 'bg-surface'}`}>
                      <div className={`text-2xl font-semibold tracking-tight ${lowest ? 'text-accent-soft-foreground' : 'text-foreground'}`}><PricingEstimatedCost row={variant.row} scenario={scenario} currency={currency} exchangeRate={exchangeRate} /></div>
                      {lowest && <p className="mt-1.5 text-[11px] font-medium text-accent-soft-foreground">{sameCosts ? t('pricing.compare.sameCost') : comparisons.some(value => value === null) ? t('pricing.compare.knownLowest', { rank: t(lowestCount > 1 ? 'pricing.compare.tiedLowest' : 'pricing.compare.lowest') }) : t(lowestCount > 1 ? 'pricing.compare.tiedLowest' : 'pricing.compare.lowest')}</p>}
                      {comparison && !comparison.isLowest && <p className="mt-1.5 text-[11px] leading-5 text-muted" title={formatPricingDisplayRate(comparison.differenceUsd, currency, exchangeRate, locale).exact}>{t('pricing.compare.higherCost', { difference: formatPricingDisplayRate(comparison.differenceUsd, currency, exchangeRate, locale).text })}{comparison.multiple !== null && comparison.multiple >= 1.01 && <> · {t('pricing.compare.multiple', { multiple: new Intl.NumberFormat(locale, { maximumSignificantDigits: 3 }).format(comparison.multiple) })}</>}</p>}
                    </td>;
                  })}
                </tr>
                {metrics.map(metric => {
                  const known = metric.values?.filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0) ?? [];
                  const same = known.length === selections.length && known.every(value => value === known[0]);
                  const different = known.length > 1 && Math.min(...known) !== Math.max(...known);
                  const preferred = metric.preferred === 'higher' ? Math.max(...known) : Math.min(...known);
                  return <tr key={metric.id}>
                    <th scope="row" className={`sticky left-0 z-10 border-t border-border/60 bg-surface-secondary p-3 font-medium ${metric.supporting ? 'text-[11px] text-muted' : ''}`}>{metric.label}{same && <span className="ml-1.5 inline-block rounded bg-surface px-1 py-0.5 text-[10px] font-normal text-muted">{t('pricing.compare.same')}</span>}{metric.detail && <span className="mt-1 block text-[10px] font-normal leading-4 text-muted">{metric.detail}</span>}</th>
                    {selections.map(({ group, variant }, index) => {
                      const highlighted = different && metric.values?.[index] === preferred;
                      return <td key={group.id} className={`border-t border-border/60 p-3 align-top tabular-nums ${highlighted ? 'bg-accent-soft/30 text-accent-soft-foreground' : 'bg-surface'} ${metric.primary ? 'text-sm font-semibold' : metric.supporting ? 'text-[11px] text-muted' : 'text-[13px]'}`}>
                        {metric.render(group, variant)}{highlighted && <span className="mt-1 block text-[10px] font-normal">{t(metric.preferred === 'higher' ? 'pricing.compare.maxContext' : 'pricing.compare.minRate')}</span>}
                      </td>;
                    })}
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          {scenario.cacheRead === 0 && scenario.cacheWrite === 0 && <p className="mt-3 text-[11px] leading-relaxed text-muted">{t('pricing.compare.noCache')}</p>}
          <p className="mt-2 text-[11px] leading-relaxed text-muted">{t('pricing.compare.disclaimer')}</p>
        </Modal.Body>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>;
}
