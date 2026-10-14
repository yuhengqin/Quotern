import { useEffect, useId, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button, Input, Label, ListBox, Popover, Select } from '@heroui/react';
import type { PricingCurrency, PricingExchangeRate } from '../lib/pricing-currency';
import { getRecentReleaseRange, type PricingFilters } from '../lib/pricing-filters';

export type PricingAdvancedFilters = Required<Pick<PricingFilters, 'minContext' | 'releasedAfter' | 'releasedBefore'>>;
export const EMPTY_PRICING_FILTERS: PricingAdvancedFilters = { minContext: 0, releasedAfter: '', releasedBefore: '' };

export function PricingMoreFilters({ filters, onChange, currency, exchangeRate, exchangeStatus, onManualRate, onRefreshRate }: {
  filters: PricingAdvancedFilters;
  onChange: (filters: PricingAdvancedFilters) => void;
  currency: PricingCurrency;
  exchangeRate: PricingExchangeRate | null;
  exchangeStatus: 'idle' | 'loading' | 'ready' | 'error';
  onManualRate: (rate: number) => void;
  onRefreshRate: () => void;
}) {
  const id = useId();
  const [manualDraft, setManualDraft] = useState('');
  useEffect(() => { setManualDraft(exchangeRate ? String(exchangeRate.rate) : ''); }, [exchangeRate]);
  const count = Number(filters.minContext > 0) + Number(Boolean(filters.releasedAfter || filters.releasedBefore));
  const manualRate = Number(manualDraft);
  const invalidRange = Boolean(filters.releasedAfter && filters.releasedBefore && filters.releasedAfter > filters.releasedBefore);

  return (
    <Popover>
      <Popover.Trigger className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface-secondary px-3 text-xs hover:bg-default">
        <SlidersHorizontal className="size-3.5" aria-hidden />更多筛选{count > 0 ? ` (${count})` : ''}
      </Popover.Trigger>
      <Popover.Content className="w-80 max-w-[calc(100vw-2rem)]" placement="bottom end">
        <Popover.Dialog className="space-y-4" aria-label="更多筛选">
          <Popover.Heading className="text-sm font-medium">更多筛选</Popover.Heading>
          <Select value={String(filters.minContext)} onChange={key => {
            if (typeof key === 'string') onChange({ ...filters, minContext: Number(key) });
          }} variant="secondary">
            <Label className="text-xs">最低上下文长度</Label>
            <Select.Trigger className="!h-9 !min-h-9 !text-xs"><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover><ListBox aria-label="最低上下文长度选项">
              {[[0, '不限'], [8000, '8K'], [32000, '32K'], [128000, '128K'], [200000, '200K'], [1000000, '1M'], [2000000, '2M']].map(([value, label]) => (
                <ListBox.Item id={String(value)} key={String(value)} textValue={String(label)}>{label}<ListBox.ItemIndicator /></ListBox.Item>
              ))}
            </ListBox></Select.Popover>
          </Select>
          <div className="space-y-2">
            <p className="text-xs font-medium">发布时间</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0 space-y-1">
                <label htmlFor={`${id}-after`} className="text-xs text-muted">发布自</label>
                <Input id={`${id}-after`} type="date" className="!h-9 min-w-0 !text-xs" value={filters.releasedAfter} onChange={event => onChange({ ...filters, releasedAfter: event.target.value })} variant="secondary" />
              </div>
              <div className="min-w-0 space-y-1">
                <label htmlFor={`${id}-before`} className="text-xs text-muted">发布至</label>
                <Input id={`${id}-before`} type="date" className="!h-9 min-w-0 !text-xs" value={filters.releasedBefore} onChange={event => onChange({ ...filters, releasedBefore: event.target.value })} variant="secondary" />
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {[30, 90, 365].map(days => <Button key={days} className="!h-7 !min-h-7 !text-xs" size="sm" variant="tertiary" onPress={() => onChange({ ...filters, ...getRecentReleaseRange(days) })}>{days === 365 ? '近一年' : `近 ${days} 天`}</Button>)}
            </div>
            {invalidRange && <p className="text-xs text-danger" role="alert">开始日期不能晚于结束日期</p>}
          </div>
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] leading-relaxed text-muted">未收录的信息不参与对应筛选；仅有月份的发布日期按整月匹配。</p>
            <Button className="!h-7 !min-h-7 shrink-0 !text-xs" size="sm" variant="tertiary" isDisabled={count === 0} onPress={() => onChange(EMPTY_PRICING_FILTERS)}>重置</Button>
          </div>
          {currency === 'CNY' && <div className="space-y-2 border-t border-border pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">人民币参考汇率</span>
              <Button className="!h-7 !min-h-7 !text-xs" size="sm" variant="tertiary" isDisabled={exchangeStatus === 'loading'} onPress={onRefreshRate}>{exchangeRate?.source === 'manual' ? '恢复自动' : '更新汇率'}</Button>
            </div>
            <p className="text-[11px] text-muted">{exchangeRate ? `$1 = ¥${exchangeRate.rate} · ${exchangeRate.source === 'manual' ? '手动设置' : `Frankfurter · ${exchangeRate.date}`}` : '暂无汇率，可自动获取或手动设置'}</p>
            <label htmlFor={`${id}-rate`} className="block text-xs text-muted">手动汇率（1 USD 对应 CNY）</label>
            <div className="flex gap-2">
              <Input id={`${id}-rate`} type="number" step="any" min="0.000001" className="!h-8 min-w-0 !text-xs" placeholder="例如 7" value={manualDraft} onChange={event => setManualDraft(event.target.value)} variant="secondary" />
              <Button className="!h-8 !min-h-8 shrink-0 !text-xs" size="sm" variant="secondary" isDisabled={!Number.isFinite(manualRate) || manualRate <= 0} onPress={() => onManualRate(manualRate)}>应用</Button>
            </div>
          </div>}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
