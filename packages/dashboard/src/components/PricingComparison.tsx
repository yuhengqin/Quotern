import { useState, type ReactNode } from 'react';
import { Label, ListBox, Modal, Select } from '@heroui/react';
import { ModelProviderIcon } from './ModelProviderIcon';
import { CopyPricingId, PricingEstimatedCost, PricingRate, type PriceDisplay } from './PricingDetails';
import { PricingCalculator, formatPricingScenario } from './PricingTools';
import { getPricingModelName, getPricingProvider } from '../lib/pricing-catalog';
import { formatPricingContext, getPrimaryPricingVariant, type PricingModelGroup, type PricingVariant } from '../lib/pricing-groups';
import { comparePricingCosts, estimatePricingCost, getCacheReadSavings, type PricingScenario } from '../lib/pricing-workbench';
import { formatTokens } from '../lib/format';

function channelLabel(variant: PricingVariant): string {
  return `${variant.row.billingMode === 'subscription' ? '订阅' : 'API'}${variant.regions.length ? ` · ${variant.regions.join(' / ')}` : ''} · ${formatPricingContext(variant.row.contextWindow)} · ${variant.row.model}`;
}

export function PricingComparison({ groups, initialChannels, onClose, scenario, onScenarioChange, currency, exchangeRate, usageStatus }: {
  groups: PricingModelGroup[]; onClose: () => void; scenario: PricingScenario;
  initialChannels: Record<string, string>;
  onScenarioChange: (value: PricingScenario) => void; usageStatus: 'loading' | 'ready' | 'error';
} & PriceDisplay) {
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
    ? <span className="text-[11px] text-muted">订阅不适用</span> : <PricingRate value={variant.row[key]} currency={currency} exchangeRate={exchangeRate} />;
  const metrics: Array<{ label: string; detail?: string; values?: Array<number | null>; preferred?: 'lower' | 'higher'; primary?: boolean; supporting?: boolean; render: (group: PricingModelGroup, variant: PricingVariant) => ReactNode }> = [
    { label: '输入', detail: '/ 百万 Token', values: canDisplayPrice ? rateValues('input') : undefined, preferred: 'lower', primary: true, render: (_, variant) => renderRate(variant, 'input') },
    { label: '输出', detail: '/ 百万 Token', values: canDisplayPrice ? rateValues('output') : undefined, preferred: 'lower', primary: true, render: (_, variant) => renderRate(variant, 'output') },
    { label: '上下文', values: selections.map(({ variant }) => {
      const value = variant.row.contextWindow;
      return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : null;
    }), preferred: 'higher', primary: true, render: (_, variant) => formatPricingContext(variant.row.contextWindow) },
    { label: '缓存读', detail: `/ 百万 Token · ${scenario.cacheRead === 0 ? '本次未使用' : `本次 ${formatTokens(scenario.cacheRead)} Token`}`, values: canDisplayPrice ? rateValues('cacheRead') : undefined, preferred: 'lower', render: (_, variant) => renderRate(variant, 'cacheRead') },
    { label: '缓存写', detail: `/ 百万 Token · ${scenario.cacheWrite === 0 ? '本次未使用' : `本次 ${formatTokens(scenario.cacheWrite)} Token`}`, values: canDisplayPrice ? rateValues('cacheWrite') : undefined, preferred: 'lower', render: (_, variant) => renderRate(variant, 'cacheWrite') },
    { label: '缓存读优惠', detail: '相对普通输入', render: (_, variant) => {
      const saving = getCacheReadSavings(variant.row);
      return saving == null ? '—' : saving >= 0 ? `节省 ${Number(saving.toFixed(2))}%` : `贵 ${Number((-saving).toFixed(2))}%`;
    } },
    { label: '发布时间', supporting: true, render: (_, variant) => variant.row.releaseDate ?? '未收录' },
    { label: '个人近 30 天用量', detail: '模型合计 · Token', supporting: true, render: group => usageStatus === 'error' ? '用量不可用' : usageStatus === 'loading' ? '加载中' : (group.usageTokens ?? 0) > 0 ? formatTokens(group.usageTokens!) : '无匹配用量' },
    { label: '调用 ID', supporting: true, render: (_, variant) => <div className="space-y-2">{variant.entries.map(entry => <div key={entry.model} className="flex items-start gap-1"><code className="min-w-0 flex-1 select-text break-all text-[11px] leading-5">{entry.model}</code><CopyPricingId model={entry.model} /></div>)}</div> },
  ];
  return <Modal.Backdrop isOpen onOpenChange={open => { if (!open) onClose(); }}>
    <Modal.Container scroll="inside" placement="center" className="p-3 sm:p-6">
      <Modal.Dialog className="w-full !max-w-[1160px] min-w-0 !max-h-[calc(100dvh-1.5rem)]">
        <Modal.CloseTrigger aria-label="关闭模型对比" />
        <Modal.Header className="gap-2 pr-12">
          <Modal.Heading>模型对比 <span className="text-sm font-normal text-muted">{groups.length} / 4</span></Modal.Heading>
          <p className="text-xs text-muted">{currency} API 参考价 · 选择具体渠道后比较；订阅按套餐额度使用。</p>
          <div className="flex flex-wrap items-center gap-2">
            <PricingCalculator scenario={scenario} onChange={onScenarioChange} enabled comparison onEnabledChange={() => {}} />
            <span className="text-[11px] text-muted">{formatPricingScenario(scenario)}</span>
          </div>
        </Modal.Header>
        <Modal.Body className="min-w-0">
          <p className="mb-2 text-[11px] text-muted sm:hidden">横向滑动查看全部模型，左侧指标保持可见。</p>
          <div role="region" aria-label="模型对比表，可横向滚动" tabIndex={0} className="max-w-full overflow-auto overscroll-contain rounded-xl border border-border/70 outline-none focus-visible:outline-2 focus-visible:outline-accent">
            <table className="w-full border-separate border-spacing-0 text-left text-xs" style={{ minWidth: 112 + groups.length * 210 }}>
              <caption className="sr-only">同等用量费用、API 单价、上下文与个人使用记录对比</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 top-0 z-20 w-28 min-w-28 bg-surface-secondary p-3 text-muted">模型 / 渠道</th>
                  {selections.map(({ group, variant }) => {
                    const provider = getPricingProvider(group.model);
                    const name = getPricingModelName(group.model, group.displayName);
                    const variants = [...group.apiVariants, ...group.subscriptionVariants];
                    return <th scope="col" key={group.id} className="sticky top-0 z-10 min-w-52 bg-surface-secondary p-3 align-top">
                      <div className="mb-2 flex items-center gap-2"><ModelProviderIcon provider={provider} size={20} /><span className="font-[system-ui,sans-serif] text-sm font-semibold">{name}</span></div>
                      <p className="mb-2 text-[11px] font-normal text-muted">{provider.label}</p>
                      {variants.length > 1 ? <Select aria-label={`${name}对比渠道`} value={variant.id} onChange={key => { if (typeof key === 'string') setChannels(current => ({ ...current, [group.id]: key })); }} variant="secondary" className="w-full min-w-0">
                        <Label className="sr-only">{name}对比渠道</Label>
                        <Select.Trigger className="!h-auto !min-h-8 max-w-full !rounded-lg !text-[11px]"><Select.Value className="min-w-0 max-w-48 truncate" /><Select.Indicator /></Select.Trigger>
                        <Select.Popover className="w-80 max-w-[calc(100vw-2rem)]"><ListBox aria-label={`${name}渠道选项`}>
                          {variants.map(item => <ListBox.Item id={item.id} key={item.id} textValue={channelLabel(item)} className="text-xs"><span className="min-w-0 break-all">{channelLabel(item)}</span><ListBox.ItemIndicator /></ListBox.Item>)}
                        </ListBox></Select.Popover>
                      </Select> : <p className="max-w-64 break-all text-[11px] font-normal text-muted">{channelLabel(variant)}</p>}
                    </th>;
                  })}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" className="sticky left-0 z-10 border-t border-border/60 bg-surface-secondary p-3 font-medium">同等用量费用<span className="mt-1 block text-[10px] font-normal text-muted">按当前试算用量</span></th>
                  {selections.map(({ group, variant }, index) => {
                    const comparison = canDisplayPrice ? comparisons[index] : null;
                    const lowest = Boolean(comparison?.isLowest);
                    return <td key={group.id} className={`border-t border-border/60 p-3 align-top ${lowest ? 'bg-accent-soft/60' : 'bg-surface'}`}>
                      <div className={`text-2xl font-semibold tracking-tight ${lowest ? 'text-accent-soft-foreground' : 'text-foreground'}`}><PricingEstimatedCost row={variant.row} scenario={scenario} currency={currency} exchangeRate={exchangeRate} /></div>
                      {lowest && <p className="mt-1.5 text-[11px] font-medium text-accent-soft-foreground">{sameCosts ? '费用相同' : `${comparisons.some(value => value === null) ? '已知费用中' : ''}${lowestCount > 1 ? '并列最低' : '费用最低'}`}</p>}
                      {comparison && !comparison.isLowest && <p className="mt-1.5 text-[11px] leading-5 text-muted">比最低贵 <PricingRate value={comparison.differenceUsd} currency={currency} exchangeRate={exchangeRate} unit="总费用差额" />{comparison.multiple !== null && comparison.multiple >= 1.01 && <> · 约 {comparison.multiple.toLocaleString('zh-CN', { maximumSignificantDigits: 3 })} 倍</>}</p>}
                    </td>;
                  })}
                </tr>
                {metrics.map(metric => {
                  const known = metric.values?.filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0) ?? [];
                  const same = known.length === selections.length && known.every(value => value === known[0]);
                  const different = known.length > 1 && Math.min(...known) !== Math.max(...known);
                  const preferred = metric.preferred === 'higher' ? Math.max(...known) : Math.min(...known);
                  return <tr key={metric.label}>
                    <th scope="row" className={`sticky left-0 z-10 border-t border-border/60 bg-surface-secondary p-3 font-medium ${metric.supporting ? 'text-[11px] text-muted' : ''}`}>{metric.label}{same && <span className="ml-1.5 inline-block rounded bg-surface px-1 py-0.5 text-[10px] font-normal text-muted">相同</span>}{metric.detail && <span className="mt-1 block text-[10px] font-normal leading-4 text-muted">{metric.detail}</span>}</th>
                    {selections.map(({ group, variant }, index) => {
                      const highlighted = different && metric.values?.[index] === preferred;
                      return <td key={group.id} className={`border-t border-border/60 p-3 align-top tabular-nums ${highlighted ? 'bg-accent-soft/30 text-accent-soft-foreground' : 'bg-surface'} ${metric.primary ? 'text-sm font-semibold' : metric.supporting ? 'text-[11px] text-muted' : 'text-[13px]'}`}>
                        {metric.render(group, variant)}{highlighted && <span className="mt-1 block text-[10px] font-normal">{metric.preferred === 'higher' ? '已知上下文最大' : '已知单价最低'}</span>}
                      </td>;
                    })}
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          {scenario.cacheRead === 0 && scenario.cacheWrite === 0 && <p className="mt-3 text-[11px] leading-relaxed text-muted">本次未使用缓存读写，缓存单价与缓存读优惠不影响上述费用。</p>}
          <p className="mt-2 text-[11px] leading-relaxed text-muted">试算不等于实际账单，不含税费或渠道折扣；缺失单价不按零计算。个人用量反映使用记录，价格与上下文不能代表模型能力。</p>
        </Modal.Body>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>;
}
