import { useState } from 'react';
import { ChevronDown } from '@gravity-ui/icons';
import { Button, DateField, Label, Popover, RangeCalendar } from '@heroui/react';
import { CalendarDate, parseDate } from '@internationalized/date';
import { I18nProvider } from 'react-aria';
import { CUSTOM_RANGE_LOOKBACK_DAYS, formatDashboardDateRange, isDashboardDateRange, type DashboardDateRange } from '@/lib/dashboard-date-range';
import { localDateDaysAgo, localDateNow } from '@/lib/stats-timezone';

export function DashboardDateRangePicker({ value, initialDays, disabled, onChange }: {
  value: DashboardDateRange | null;
  initialDays: number;
  disabled: boolean;
  onChange: (range: DashboardDateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const initial = value ?? { start: localDateDaysAgo(initialDays), end: localDateNow() };
  const [start, setStart] = useState<CalendarDate | null>(() => parseDate(initial.start));
  const [end, setEnd] = useState<CalendarDate | null>(() => parseDate(initial.end));
  const draft = start && end ? { start: start.toString(), end: end.toString() } : null;
  const valid = isDashboardDateRange(draft);
  const min = parseDate(localDateDaysAgo(CUSTOM_RANGE_LOOKBACK_DAYS));
  const max = parseDate(localDateNow());
  const selected = start && end && start.compare(end) <= 0 ? { start, end } : null;
  const changeOpen = (next: boolean) => {
    if (next) {
      setStart(parseDate(initial.start));
      setEnd(parseDate(initial.end));
    }
    setOpen(next);
  };

  return (
    <Popover isOpen={open} onOpenChange={changeOpen}>
      <Button
        aria-label={value ? `自定义日期范围：${formatDashboardDateRange(value)}` : '自定义日期范围'}
        aria-pressed={Boolean(value)}
        className={`!h-6 !min-h-6 !min-w-0 gap-1 rounded-full px-3 text-xs font-normal transition-none! ${value ? '!bg-accent !text-accent-foreground' : '!bg-transparent text-muted hover:text-foreground'}`}
        isDisabled={disabled}
        size="sm"
        variant="ghost"
      >
        自定义
        <ChevronDown className="size-3" />
      </Button>
      <Popover.Content className="!w-[560px] max-w-[calc(100vw-24px)] rounded-2xl border border-border bg-overlay p-0 shadow-surface" placement="bottom start" offset={8}>
        <Popover.Dialog aria-label="自定义日期范围" className="p-4 outline-none">
          <I18nProvider locale="zh-CN">
            <RangeCalendar
              aria-label="选择起止日期"
              className="!w-full !border-0 !bg-transparent !p-0 !shadow-none"
              value={selected}
              defaultFocusedValue={parseDate(initial.end)}
              minValue={min}
              maxValue={max}
              onChange={(range) => { setStart(parseDate(range.start.toString())); setEnd(parseDate(range.end.toString())); }}
            >
              {({ state }) => (
                <div className="flex flex-col gap-4 sm:flex-row">
                  <div className="flex w-full flex-col gap-3 sm:w-48 sm:shrink-0">
                    <h2 className="text-sm font-medium">自定义日期范围</h2>
                    <DateField value={start} onChange={setStart} minValue={min} maxValue={max}>
                      <Label className="text-xs text-muted">开始日期</Label>
                      <DateField.Group className="rounded-xl">
                        <DateField.Input>{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
                      </DateField.Group>
                    </DateField>
                    <DateField value={end} onChange={setEnd} minValue={min} maxValue={max}>
                      <Label className="text-xs text-muted">结束日期</Label>
                      <DateField.Group className="rounded-xl">
                        <DateField.Input>{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
                      </DateField.Group>
                    </DateField>
                    <p className="text-xs text-muted">按北京时间统计，包含起止日期。可选择近一年内的日期。</p>
                    {!valid && <p role="alert" className="text-xs text-danger">请选择有效的起止日期，开始日期不能晚于结束日期。</p>}
                    <div className="mt-auto flex justify-end gap-2 pt-1">
                      <Button slot={null} size="sm" variant="ghost" onPress={() => setOpen(false)}>取消</Button>
                      <Button slot={null} size="sm" isDisabled={!valid || Boolean(state.anchorDate)} onPress={() => {
                        if (draft && valid) { onChange(draft); setOpen(false); }
                      }}>确定</Button>
                    </div>
                  </div>
                  <div className="min-w-0 w-full sm:w-72 sm:shrink-0">
                    <RangeCalendar.Header>
                      <RangeCalendar.NavButton slot="previous" aria-label="上个月" />
                      <RangeCalendar.Heading />
                      <RangeCalendar.NavButton slot="next" aria-label="下个月" />
                    </RangeCalendar.Header>
                    <RangeCalendar.Grid>
                      <RangeCalendar.GridHeader>{(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}</RangeCalendar.GridHeader>
                      <RangeCalendar.GridBody>{(date) => <RangeCalendar.Cell date={date} />}</RangeCalendar.GridBody>
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
