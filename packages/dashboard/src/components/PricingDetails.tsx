import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, Popover, Tooltip } from '@heroui/react';
import type { PricingCurrency } from '../lib/pricing-currency';
import type { PricingModelGroup, PricingVariant } from '../lib/pricing-groups';
import { formatPricingContext } from '../lib/pricing-groups';
import { formatPricingDisplayRate, getPricingVariantAliases, splitPricingHighlight } from '../lib/pricing-display';
import { estimatePricingCost, PRICING_TOKEN_FIELDS, type PricingScenario } from '../lib/pricing-workbench';
import type { PricingCatalogRow } from '../lib/pricing-data';

export type PriceDisplay = { currency: PricingCurrency; exchangeRate: number | null };

export function PricingHighlight({ text, query = '' }: { text: string; query?: string }) {
  return <>{splitPricingHighlight(text, query).map((part, index) => part.match
    ? <mark key={index} className="rounded-sm bg-warning/20 text-inherit">{part.text}</mark>
    : part.text)}</>;
}

export function CopyPricingId({ model, label, query = '' }: { model: string; label?: string; query?: string }) {
  const [result, setResult] = useState<{ model: string; status: 'copied' | 'error' } | null>(null);
  const status = result?.model === model ? result.status : 'idle';
  return <span className="inline-flex min-w-0 max-w-full items-center gap-1" title={status === 'copied' ? `已复制：${model}` : `复制调用 ID：${model}`}>
    <Button isIconOnly={!label} size="sm" variant={label ? 'tertiary' : 'ghost'}
      className={label ? '!h-6 !min-h-6 min-w-0 max-w-40 !gap-1 !rounded-md !px-1.5 font-mono !text-[11px]' : '!size-6 !min-h-6 !min-w-6 !rounded-md !p-0 text-muted'}
      aria-label={`复制渠道 ID ${model}`} onPress={async () => {
        try { await navigator.clipboard.writeText(model); setResult({ model, status: 'copied' }); }
        catch { setResult({ model, status: 'error' }); }
      }}>
      {label && <span className="min-w-0 truncate"><PricingHighlight text={label} query={query} /></span>}
      {status === 'copied' ? <Check className="size-3 shrink-0 text-success" aria-hidden /> : <Copy className="size-3 shrink-0" aria-hidden />}
    </Button>
    <span role="status" className={status === 'error' ? 'text-[10px] text-danger' : 'sr-only'}>{status === 'copied' ? `已复制调用 ID：${model}` : status === 'error' ? '复制失败，请在详情中手动复制' : ''}</span>
  </span>;
}

function CallingIds({ models, query }: { models: string[]; query: string }) {
  return <div className="space-y-2">{models.map(model => <div key={model} className="flex min-w-0 items-start gap-2">
    <code className="min-w-0 flex-1 select-text break-all text-[11px] leading-5"><PricingHighlight text={model} query={query} /></code>
    <CopyPricingId model={model} />
  </div>)}</div>;
}

export function PricingAliases({ group, variant, query }: { group: PricingModelGroup; variant: PricingVariant; query: string }) {
  if (variant.row.billingMode === 'subscription') return null;
  const aliases = getPricingVariantAliases(group.canonicalModelId ?? group.model, variant.entries.map(entry => entry.model));
  const visible = aliases.slice(0, 2);
  const remaining = aliases.slice(2);
  return <>{visible.map(alias => alias.models.length === 1
    ? <CopyPricingId key={alias.label} model={alias.models[0]!} label={alias.label} query={query} />
    : <Popover key={alias.label}>
      <Button size="sm" variant="tertiary" className="!h-6 !min-h-6 min-w-0 max-w-40 !rounded-md !px-1.5 font-mono !text-[11px]" aria-label={`查看 ${alias.label} 的调用 ID`}><span className="truncate"><PricingHighlight text={alias.label} query={query} /></span></Button>
      <Popover.Content className="w-88 max-w-[calc(100vw-2rem)]"><Popover.Dialog className="space-y-2 p-3"><Popover.Heading className="text-xs">选择渠道 ID</Popover.Heading><CallingIds models={alias.models} query={query} /></Popover.Dialog></Popover.Content>
    </Popover>)}
    {remaining.length > 0 && <Popover>
      <Button size="sm" variant="tertiary" className="!h-6 !min-h-6 !min-w-6 !rounded-md !px-1.5 !text-[11px]" aria-label={`查看其余 ${remaining.length} 个别名`}>+{remaining.length}</Button>
      <Popover.Content className="w-88 max-w-[calc(100vw-2rem)]"><Popover.Dialog className="space-y-2 p-3"><Popover.Heading className="text-xs">更多调用 ID</Popover.Heading><CallingIds models={remaining.flatMap(alias => alias.models)} query={query} /></Popover.Dialog></Popover.Content>
    </Popover>}
  </>;
}

export function PricingRate({ value, currency, exchangeRate, unit = '/ 百万 Token' }: { value: number | null; unit?: string } & PriceDisplay) {
  const price = formatPricingDisplayRate(value, currency, exchangeRate);
  if (!price.approximate) return <span className="whitespace-nowrap font-mono tabular-nums">{price.text}</span>;
  return <Tooltip delay={200}>
    <Tooltip.Trigger className="inline-flex cursor-help whitespace-nowrap rounded font-mono tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-accent" aria-label={`${price.text}，精确值 ${price.exact} ${unit}`}>
      {price.text}
    </Tooltip.Trigger>
    <Tooltip.Content><span className="font-mono">{price.exact}</span><span className="ml-1 text-muted">{unit}</span></Tooltip.Content>
  </Tooltip>;
}

export function PricingEstimatedCost({ row, scenario, currency, exchangeRate }: { row: PricingCatalogRow; scenario: PricingScenario } & PriceDisplay) {
  const estimate = estimatePricingCost(row, scenario);
  if (estimate.status === 'ready') {
    const price = formatPricingDisplayRate(estimate.totalUsd, currency, exchangeRate);
    return <span className="whitespace-nowrap font-mono tabular-nums" title={price.exact === '—' ? '汇率暂不可用' : `参考费用 ${price.exact}`}>{price.text}</span>;
  }
  const description = estimate.status === 'missing' ? `缺少${estimate.missing.map(key => PRICING_TOKEN_FIELDS.find(field => field[0] === key)![1]).join('、')}价格`
    : estimate.status === 'subscription' ? '订阅按套餐额度使用，不适用 API 试算' : '用量超出有效范围';
  return <span className="text-[11px] text-muted" title={description}>{estimate.status === 'subscription' ? '订阅不适用' : estimate.status === 'missing' ? description : '无法估算'}</span>;
}

export function PricingChannelDetails({ name, variant, currency, exchangeRate, query = '' }: { name: string; variant: PricingVariant; query?: string } & PriceDisplay) {
  const subscription = variant.row.billingMode === 'subscription';
  const channelLabel = `${variant.regions.join(' / ')} ${subscription ? '订阅' : 'API'}`.trim();
  return <Popover>
    <Button size="sm" variant="ghost" className="!h-6 !min-h-6 !min-w-0 shrink-0 !rounded-md !px-1 !text-[11px] text-muted" aria-label={`查看${name} ${channelLabel} ${formatPricingContext(variant.row.contextWindow)}渠道详情：${variant.row.model}`}>
      渠道详情
    </Button>
    <Popover.Content placement="bottom start" className="w-96 max-w-[calc(100vw-2rem)]">
      <Popover.Dialog className="space-y-3 p-3">
        <div><Popover.Heading className="text-sm">{name}</Popover.Heading><p className="mt-1 text-xs text-muted">{channelLabel} · 上下文 {formatPricingContext(variant.row.contextWindow)}</p></div>
        {subscription ? <p className="text-xs text-muted">按套餐额度使用，金额与额度以各渠道公布的套餐为准。</p> : <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {([['input', '输入'], ['output', '输出'], ['cacheRead', '缓存读'], ['cacheWrite', '缓存写']] as const).map(([key, label]) => <div key={key} className="flex items-baseline justify-between gap-2"><dt className="text-muted">{label}</dt><dd className="font-mono tabular-nums">{formatPricingDisplayRate(variant.row[key], currency, exchangeRate).exact}</dd></div>)}
          <div className="col-span-2 text-[11px] text-muted">{currency} / 百万 Token{currency === 'CNY' ? ' · 人民币为参考换算' : ''}</div>
        </dl>}
        <div className="space-y-2 border-t border-border/60 pt-2">
          <p className="text-[11px] text-muted">调用 ID</p>
          <CallingIds models={variant.entries.map(entry => entry.model)} query={query} />
        </div>
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}
