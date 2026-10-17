import { useState } from 'react';
import { Check, Copy, Ellipsis } from 'lucide-react';
import { Button, Popover, Tooltip } from '@heroui/react';
import type { PricingCurrency } from '../lib/pricing-currency';
import type { PricingVariant } from '../lib/pricing-groups';
import { formatPricingContext } from '../lib/pricing-groups';
import { formatPricingDisplayRate } from '../lib/pricing-display';

export type PriceDisplay = { currency: PricingCurrency; exchangeRate: number | null };

export function PricingRate({ value, currency, exchangeRate }: { value: number | null } & PriceDisplay) {
  const price = formatPricingDisplayRate(value, currency, exchangeRate);
  if (!price.approximate) return <span className="whitespace-nowrap font-mono tabular-nums">{price.text}</span>;
  return <Tooltip delay={200}>
    <Tooltip.Trigger className="inline-flex cursor-help whitespace-nowrap rounded font-mono tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-accent" aria-label={`${price.text}，精确参考价 ${price.exact}`}>
      {price.text}
    </Tooltip.Trigger>
    <Tooltip.Content><span className="font-mono">{price.exact}</span><span className="ml-1 text-muted">/ 百万 Token</span></Tooltip.Content>
  </Tooltip>;
}

export function PricingChannelDetails({ name, variant, currency, exchangeRate }: { name: string; variant: PricingVariant } & PriceDisplay) {
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const subscription = variant.row.billingMode === 'subscription';
  const channelLabel = `${variant.regions.join(' / ')} ${subscription ? '订阅' : 'API'}`.trim();
  return <Popover onOpenChange={() => { setCopied(null); setCopyError(false); }}>
    <Button isIconOnly size="sm" variant="ghost" className="!size-6 !min-h-6 !min-w-6 shrink-0 !rounded-md !p-0 text-muted" aria-label={`查看${name} ${channelLabel} ${formatPricingContext(variant.row.contextWindow)}渠道详情：${variant.row.model}`}>
      <Ellipsis className="size-3.5" aria-hidden />
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
          {variant.entries.map(entry => <div key={entry.model} className="flex items-start gap-2">
            <code className="min-w-0 flex-1 select-text break-all text-[11px] leading-5">{entry.model}</code>
            <Button isIconOnly variant="tertiary" size="sm" className="!size-6 !min-h-6 !min-w-6 !rounded-md !p-0" aria-label={`复制渠道 ID ${entry.model}`} onPress={async () => {
              try { await navigator.clipboard.writeText(entry.model); setCopied(entry.model); setCopyError(false); }
              catch { setCopyError(true); }
            }}>{copied === entry.model ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}</Button>
          </div>)}
          <p role="status" className={`text-[11px] ${copyError ? 'text-danger' : 'text-muted'} ${!copied && !copyError ? 'sr-only' : ''}`}>{copyError ? '未能复制，请选中调用 ID 手动复制。' : copied ? '已复制调用 ID' : ''}</p>
        </div>
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}
