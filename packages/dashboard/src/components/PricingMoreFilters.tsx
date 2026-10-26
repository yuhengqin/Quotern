import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from '@gravity-ui/icons';
import { ArrowLeft, SlidersHorizontal } from 'lucide-react';
import { Button, DateField, Input, Label, ListBox, Popover, RangeCalendar, Select } from '@heroui/react';
import { CalendarDate, parseDate } from '@internationalized/date';
import { I18nProvider } from 'react-aria';
import { useTranslation } from 'quotern-i18n/react';
import type { PricingCurrency, PricingExchangeRate } from '../lib/pricing-currency';
import { getRecentReleaseRange, type PricingFilters } from '../lib/pricing-filters';
import { localDateNow } from '../lib/stats-timezone';
import { formatPricingReleaseDate } from '../lib/pricing-display';
import { formatPricingExchangeRate } from '../lib/pricing-currency';
import { FilterSelectPopover } from './FilterMenu';

export type PricingAdvancedFilters = Required<Pick<PricingFilters, 'minContext' | 'releasedAfter' | 'releasedBefore'>>;
export const EMPTY_PRICING_FILTERS: PricingAdvancedFilters = { minContext: 0, releasedAfter: '', releasedBefore: '' };

function ReleaseDateRangeEditor({ filters, onApply, onBack }: {
  filters: PricingAdvancedFilters;
  onApply: (filters: PricingAdvancedFilters) => void;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [start, setStart] = useState<CalendarDate | null>(() => filters.releasedAfter ? parseDate(filters.releasedAfter) : null);
  const [end, setEnd] = useState<CalendarDate | null>(() => filters.releasedBefore ? parseDate(filters.releasedBefore) : null);
  const valid = !start || !end || start.compare(end) <= 0;
  const selected = start && end && start.compare(end) <= 0 ? { start, end } : null;

  return (
    <div className="space-y-3" onKeyDownCapture={event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onBack();
      }
    }}>
      <Button autoFocus slot={null} size="sm" variant="ghost" className="!h-7 !min-h-7 !min-w-0 gap-1 px-1 !text-xs" onPress={onBack}>
        <ArrowLeft className="size-3.5" aria-hidden />{t('pricing.filters.back')}
      </Button>
      <I18nProvider locale={i18n.language}>
        <RangeCalendar
          aria-label={t('pricing.filters.selectReleaseDates')}
          className="!w-full !max-w-none !border-0 !bg-transparent !p-0 !shadow-none"
          value={selected}
          defaultFocusedValue={end ?? start ?? parseDate(localDateNow())}
          onChange={range => { setStart(parseDate(range.start.toString())); setEnd(parseDate(range.end.toString())); }}
        >
          {({ state }) => (
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex w-full flex-col gap-3 sm:w-48 sm:shrink-0">
                <h2 className="text-sm font-medium">{t('pricing.filters.customReleaseRange')}</h2>
                <DateField value={start} onChange={setStart}>
                  <Label className="text-xs text-muted">{t('pricing.filters.startDate')}</Label>
                  <DateField.Group className="rounded-xl">
                    <DateField.Input>{segment => <DateField.Segment segment={segment} />}</DateField.Input>
                  </DateField.Group>
                </DateField>
                <DateField value={end} onChange={setEnd}>
                  <div className="flex min-h-6 items-center justify-between gap-2">
                    <Label className="text-xs text-muted">{t('pricing.filters.endDate')}</Label>
                    <Button slot={null} size="sm" variant="ghost" className="!h-6 !min-h-6 !min-w-0 rounded-md px-1.5 text-xs font-normal text-accent hover:bg-accent/10" onPress={() => {
                      const today = parseDate(localDateNow());
                      if (state.anchorDate) state.selectDate(today);
                      else setEnd(today);
                      state.setFocusedDate(today);
                    }}>{t('pricing.filters.endToday')}</Button>
                  </div>
                  <DateField.Group className="rounded-xl">
                    <DateField.Input>{segment => <DateField.Segment segment={segment} />}</DateField.Input>
                  </DateField.Group>
                </DateField>
                {!valid && <p role="alert" className="text-xs text-danger">{t('pricing.filters.invalidDateRange')}</p>}
                <div className="mt-auto flex justify-end gap-2 pt-1">
                  <Button slot={null} size="sm" variant="ghost" onPress={onBack}>{t('pricing.filters.cancel')}</Button>
                  <Button slot={null} size="sm" isDisabled={!valid || Boolean(state.anchorDate)} onPress={() => {
                    onApply({ ...filters, releasedAfter: start?.toString() ?? '', releasedBefore: end?.toString() ?? '' });
                  }}>{t('pricing.filters.confirm')}</Button>
                </div>
              </div>
              <div className="min-w-0 w-full sm:flex-1">
                <RangeCalendar.Header>
                  <RangeCalendar.NavButton slot="previous" aria-label={t('pricing.filters.previousMonth')} />
                  <RangeCalendar.Heading className="text-center" />
                  <RangeCalendar.NavButton slot="next" aria-label={t('pricing.filters.nextMonth')} />
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
    </div>
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
  const { t, i18n } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [showDateRange, setShowDateRange] = useState(false);
  const applyFilters = (next: PricingAdvancedFilters) => {
    onChange(next);
    setOpen(false);
    setShowDateRange(false);
  };
  const dateTrigger = useRef<HTMLButtonElement>(null);
  const returnToFilters = () => {
    setShowDateRange(false);
    requestAnimationFrame(() => dateTrigger.current?.focus());
  };
  const [manualDraft, setManualDraft] = useState('');
  useEffect(() => { setManualDraft(exchangeRate ? String(exchangeRate.rate) : ''); }, [exchangeRate]);
  const count = Number(filters.minContext > 0) + Number(Boolean(filters.releasedAfter || filters.releasedBefore));
  const manualRate = Number(manualDraft);
  const invalidRange = Boolean(filters.releasedAfter && filters.releasedBefore && filters.releasedAfter > filters.releasedBefore);
  const rangeLabel = filters.releasedAfter || filters.releasedBefore
    ? `${filters.releasedAfter ? formatPricingReleaseDate(filters.releasedAfter, i18n.language) : t('pricing.filters.unlimited')} ～ ${filters.releasedBefore ? formatPricingReleaseDate(filters.releasedBefore, i18n.language) : t('pricing.filters.unlimited')}`
    : t('pricing.filters.chooseDateRange');

  return (
    <Popover isOpen={open} onOpenChange={next => { setOpen(next); if (!next) setShowDateRange(false); }}>
      <Popover.Trigger className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface-secondary px-3 text-xs hover:bg-default">
        <SlidersHorizontal className="size-3.5" aria-hidden />{count > 0 ? t('pricing.filters.moreCount', { count }) : t('pricing.filters.more')}
      </Popover.Trigger>
      <Popover.Content className={`${showDateRange ? '!w-[560px]' : 'w-80'} max-w-[calc(100vw-2rem)]`} placement="bottom end">
        <Popover.Dialog className="space-y-4" aria-label={t(showDateRange ? 'pricing.filters.releaseRange' : 'pricing.filters.more')}>
          {showDateRange ? <ReleaseDateRangeEditor filters={filters} onApply={applyFilters} onBack={returnToFilters} /> : <>
          <Popover.Heading className="text-sm font-medium">{t('pricing.filters.more')}</Popover.Heading>
          <Select value={String(filters.minContext)} onChange={key => {
            if (typeof key === 'string') applyFilters({ ...filters, minContext: Number(key) });
          }} variant="secondary">
            <Label className="text-xs">{t('pricing.filters.minContext')}</Label>
            <Select.Trigger className="!h-9 !min-h-9 !items-center !py-0 !text-xs"><Select.Value className="!text-xs !leading-4" /><Select.Indicator /></Select.Trigger>
            <FilterSelectPopover><ListBox aria-label={t('pricing.filters.minContextOptions')}>
              {[[0, t('pricing.filters.unlimited')], [8000, '8K'], [128000, '128K'], [1000000, '1M']].map(([value, label]) => (
                <ListBox.Item id={String(value)} key={String(value)} textValue={String(label)}>{label}<ListBox.ItemIndicator /></ListBox.Item>
              ))}
            </ListBox></FilterSelectPopover>
          </Select>
          <div className="space-y-2">
            <p className="text-xs font-medium">{t('pricing.filters.release')}</p>
            <Button ref={dateTrigger} slot={null} aria-label={t('pricing.filters.releaseRangeValue', { range: rangeLabel })} className="!h-9 !min-h-9 w-full justify-between !text-xs" variant="secondary" onPress={() => setShowDateRange(true)}>
              <span className="truncate">{rangeLabel}</span><ChevronDown className="size-3 shrink-0 text-muted" />
            </Button>
            <div className="flex flex-wrap gap-1">
              {[30, 90, 365].map(days => <Button key={days} className="!h-7 !min-h-7 !text-xs" size="sm" variant="tertiary" onPress={() => onChange({ ...filters, ...getRecentReleaseRange(days) })}>{days === 365 ? t('pricing.filters.recentYear') : t('pricing.filters.recentDays', { count: days })}</Button>)}
            </div>
            {invalidRange && <p className="text-xs text-danger" role="alert">{t('pricing.filters.invalidDateRange')}</p>}
          </div>
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] leading-relaxed text-muted">{t('pricing.filters.missingMetadata')}</p>
            <Button className="!h-7 !min-h-7 shrink-0 !text-xs" size="sm" variant="tertiary" isDisabled={count === 0} onPress={() => onChange(EMPTY_PRICING_FILTERS)}>{t('pricing.filters.reset')}</Button>
          </div>
          {currency === 'CNY' && <div className="space-y-2 border-t border-border pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">{t('pricing.exchange.heading')}</span>
              <Button className="!h-7 !min-h-7 !text-xs" size="sm" variant="tertiary" isDisabled={exchangeStatus === 'loading'} onPress={onRefreshRate}>{t(exchangeRate?.source === 'manual' ? 'pricing.exchange.restoreAuto' : 'pricing.exchange.update')}</Button>
            </div>
            <p className="text-[11px] text-muted">{exchangeRate ? `$1 = ¥${formatPricingExchangeRate(exchangeRate.rate, i18n.language)} · ${exchangeRate.source === 'manual' ? t('pricing.exchange.manualSet') : `Frankfurter · ${formatPricingReleaseDate(exchangeRate.date ?? undefined, i18n.language)}`}` : t('pricing.exchange.noRate')}</p>
            <label htmlFor={`${id}-rate`} className="block text-xs text-muted">{t('pricing.exchange.manualLabel')}</label>
            <div className="flex gap-2">
              <Input id={`${id}-rate`} type="number" step="any" min="0.000001" className="!h-8 min-w-0 !text-xs" placeholder={t('pricing.exchange.example')} value={manualDraft} onChange={event => setManualDraft(event.target.value)} variant="secondary" />
              <Button className="!h-8 !min-h-8 shrink-0 !text-xs" size="sm" variant="secondary" isDisabled={!Number.isFinite(manualRate) || manualRate <= 0} onPress={() => onManualRate(manualRate)}>{t('pricing.exchange.apply')}</Button>
            </div>
          </div>}
          </>}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
