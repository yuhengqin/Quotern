import { useEffect, useId, useState } from 'react';
import { ChevronDown } from '@gravity-ui/icons';
import { SlidersHorizontal } from 'lucide-react';
import { Button, DateField, Input, Label, ListBox, Popover, RangeCalendar, Select } from '@heroui/react';
import { CalendarDate, parseDate } from '@internationalized/date';
import { I18nProvider } from 'react-aria';
import type { PricingCurrency, PricingExchangeRate } from '../lib/pricing-currency';
import { getRecentReleaseRange, type PricingFilters } from '../lib/pricing-filters';
import { localDateNow } from '../lib/stats-timezone';

export type PricingAdvancedFilters = Required<Pick<PricingFilters, 'minContext' | 'releasedAfter' | 'releasedBefore'>>;
export const EMPTY_PRICING_FILTERS: PricingAdvancedFilters = { minContext: 0, releasedAfter: '', releasedBefore: '' };

function ReleaseDateRangePicker({ filters, onChange }: {
  filters: PricingAdvancedFilters;
  onChange: (filters: PricingAdvancedFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<CalendarDate | null>(() => filters.releasedAfter ? parseDate(filters.releasedAfter) : null);
  const [end, setEnd] = useState<CalendarDate | null>(() => filters.releasedBefore ? parseDate(filters.releasedBefore) : null);
  const valid = !start || !end || start.compare(end) <= 0;
  const selected = start && end && start.compare(end) <= 0 ? { start, end } : null;
  const label = filters.releasedAfter || filters.releasedBefore
    ? `${filters.releasedAfter ? filters.releasedAfter.replaceAll('-', '/') : '不限'} ～ ${filters.releasedBefore ? filters.releasedBefore.replaceAll('-', '/') : '不限'}`
    : '选择日期范围';
  const changeOpen = (next: boolean) => {
    if (next) {
      setStart(filters.releasedAfter ? parseDate(filters.releasedAfter) : null);
      setEnd(filters.releasedBefore ? parseDate(filters.releasedBefore) : null);
    }
    setOpen(next);
  };

  return (
    <Popover isOpen={open} onOpenChange={changeOpen}>
      <Button aria-label={`发布时间范围：${label}`} className="!h-9 !min-h-9 w-full justify-between !text-xs" variant="secondary">
        <span className="truncate">{label}</span><ChevronDown className="size-3 shrink-0 text-muted" />
      </Button>
      <Popover.Content className="!w-[560px] max-w-[calc(100vw-24px)] rounded-2xl border border-border bg-overlay p-0 shadow-surface" placement="bottom start" offset={8}>
        <Popover.Dialog aria-label="选择发布时间范围" className="p-4 outline-none">
          <I18nProvider locale="zh-CN">
            <RangeCalendar
              aria-label="选择发布日期起止日期"
              className="!w-full !max-w-none !border-0 !bg-transparent !p-0 !shadow-none"
              value={selected}
              defaultFocusedValue={end ?? start ?? parseDate(localDateNow())}
              onChange={range => { setStart(parseDate(range.start.toString())); setEnd(parseDate(range.end.toString())); }}
            >
              {({ state }) => (
                <div className="flex flex-col gap-4 sm:flex-row">
                  <div className="flex w-full flex-col gap-3 sm:w-48 sm:shrink-0">
                    <h2 className="text-sm font-medium">自定义发布日期范围</h2>
                    <DateField value={start} onChange={setStart}>
                      <Label className="text-xs text-muted">开始日期</Label>
                      <DateField.Group className="rounded-xl">
                        <DateField.Input>{segment => <DateField.Segment segment={segment} />}</DateField.Input>
                      </DateField.Group>
                    </DateField>
                    <DateField value={end} onChange={setEnd}>
                      <div className="flex min-h-6 items-center justify-between gap-2">
                        <Label className="text-xs text-muted">结束日期</Label>
                        <Button slot={null} size="sm" variant="ghost" className="!h-6 !min-h-6 !min-w-0 rounded-md px-1.5 text-xs font-normal text-accent hover:bg-accent/10" onPress={() => {
                          const today = parseDate(localDateNow());
                          if (state.anchorDate) state.selectDate(today);
                          else setEnd(today);
                          state.setFocusedDate(today);
                        }}>结束日期设为今天</Button>
                      </div>
                      <DateField.Group className="rounded-xl">
                        <DateField.Input>{segment => <DateField.Segment segment={segment} />}</DateField.Input>
                      </DateField.Group>
                    </DateField>
                    {!valid && <p role="alert" className="text-xs text-danger">开始日期不能晚于结束日期</p>}
                    <div className="mt-auto flex justify-end gap-2 pt-1">
                      <Button slot={null} size="sm" variant="ghost" onPress={() => setOpen(false)}>取消</Button>
                      <Button slot={null} size="sm" isDisabled={!valid || Boolean(state.anchorDate)} onPress={() => {
                        onChange({ ...filters, releasedAfter: start?.toString() ?? '', releasedBefore: end?.toString() ?? '' });
                        setOpen(false);
                      }}>确定</Button>
                    </div>
                  </div>
                  <div className="min-w-0 w-full sm:flex-1">
                    <RangeCalendar.Header>
                      <RangeCalendar.NavButton slot="previous" aria-label="上个月" />
                      <RangeCalendar.Heading className="text-center" />
                      <RangeCalendar.NavButton slot="next" aria-label="下个月" />
                    </RangeCalendar.Header>
                    <RangeCalendar.Grid weekdayStyle="narrow">
                      <RangeCalendar.GridHeader>{day => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}</RangeCalendar.GridHeader>
                      <RangeCalendar.GridBody>{date => <RangeCalendar.Cell date={date} />}</RangeCalendar.GridBody>
                    </RangeCalendar.Grid>
                  </div>
                </div>
              )}
            </RangeCalendar>
          </I18nProvider>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

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
            <ReleaseDateRangePicker filters={filters} onChange={onChange} />
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
