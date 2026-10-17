import { useState, type ReactNode } from 'react';
import { Label, ListBox, Modal, Select } from '@heroui/react';
import { ModelProviderIcon } from './ModelProviderIcon';
import { CopyPricingId, PricingEstimatedCost, PricingRate, type PriceDisplay } from './PricingDetails';
import { PricingCalculator, formatPricingScenario } from './PricingTools';
import { getPricingModelName, getPricingProvider } from '../lib/pricing-catalog';
import { formatPricingContext, getPrimaryPricingVariant, type PricingModelGroup, type PricingVariant } from '../lib/pricing-groups';
import { estimatePricingCost, getCacheReadSavings, type PricingScenario } from '../lib/pricing-workbench';
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
  const totals = selections.map(({ variant }) => estimatePricingCost(variant.row, scenario).totalUsd).filter((value): value is number => value !== null);
  const minimum = totals.length > 1 ? Math.min(...totals) : null;
  const metrics: Array<{ label: string; detail?: string; render: (group: PricingModelGroup, variant: PricingVariant) => ReactNode }> = [
    { label: '输入', detail: '/ 百万 Token', render: (_, variant) => <PricingRate value={variant.row.input} currency={currency} exchangeRate={exchangeRate} /> },
    { label: '输出', detail: '/ 百万 Token', render: (_, variant) => <PricingRate value={variant.row.output} currency={currency} exchangeRate={exchangeRate} /> },
    { label: '缓存读', detail: '/ 百万 Token', render: (_, variant) => <PricingRate value={variant.row.cacheRead} currency={currency} exchangeRate={exchangeRate} /> },
    { label: '缓存写', detail: '/ 百万 Token', render: (_, variant) => <PricingRate value={variant.row.cacheWrite} currency={currency} exchangeRate={exchangeRate} /> },
    { label: '缓存读优惠', detail: '相对普通输入', render: (_, variant) => {
      const saving = getCacheReadSavings(variant.row);
      return saving == null ? '—' : saving >= 0 ? `节省 ${Number(saving.toFixed(2))}%` : `贵 ${Number((-saving).toFixed(2))}%`;
    } },
    { label: '上下文', render: (_, variant) => formatPricingContext(variant.row.contextWindow) },
    { label: '发布时间', render: (_, variant) => variant.row.releaseDate ?? '未收录' },
    { label: '近 30 天用量', detail: '模型合计', render: group => usageStatus === 'error' ? '用量不可用' : usageStatus === 'loading' ? '加载中' : (group.usageTokens ?? 0) > 0 ? formatTokens(group.usageTokens!) : '无匹配用量' },
    { label: '调用 ID', render: (_, variant) => <div className="space-y-2">{variant.entries.map(entry => <div key={entry.model} className="flex items-start gap-1"><code className="min-w-0 flex-1 select-text break-all text-[11px] leading-5">{entry.model}</code><CopyPricingId model={entry.model} /></div>)}</div> },
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
          <div role="region" aria-label="模型对比表，可横向滚动" tabIndex={0} className="max-w-full overflow-auto rounded-xl border border-border/70 outline-none focus-visible:outline-2 focus-visible:outline-accent">
            <table className="w-full border-separate border-spacing-0 text-left text-xs" style={{ minWidth: 112 + groups.length * 210 }}>
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
                  <th scope="row" className="sticky left-0 z-10 bg-surface-secondary p-3 font-medium">试算费用</th>
                  {selections.map(({ group, variant }) => {
                    const estimate = estimatePricingCost(variant.row, scenario);
                    const lowest = minimum !== null && estimate.totalUsd === minimum && (currency === 'USD' || exchangeRate !== null);
                    return <td key={group.id} className={`border-t border-border/60 p-3 ${lowest ? 'bg-accent-soft' : 'bg-surface'}`}>
                      <div className="text-base font-semibold"><PricingEstimatedCost row={variant.row} scenario={scenario} currency={currency} exchangeRate={exchangeRate} /></div>
                      {lowest && <p className="mt-1 text-[10px] text-accent-soft-foreground">已知价格中最低</p>}
                    </td>;
                  })}
                </tr>
                {metrics.map(metric => <tr key={metric.label}>
                  <th scope="row" className="sticky left-0 z-10 border-t border-border/60 bg-surface-secondary p-3 font-medium">{metric.label}{metric.detail && <span className="mt-1 block text-[10px] font-normal text-muted">{metric.detail}</span>}</th>
                  {selections.map(({ group, variant }) => <td key={group.id} className="border-t border-border/60 bg-surface p-3 align-top tabular-nums">{metric.render(group, variant)}</td>)}
                </tr>)}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted">试算不等于实际账单，不含税费或渠道折扣；缺失单价不按零计算。价格与上下文不能代表模型能力。</p>
        </Modal.Body>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>;
}
