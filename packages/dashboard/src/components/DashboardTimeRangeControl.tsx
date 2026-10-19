import { Button } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { DASHBOARD_RANGE_DAYS, type DashboardRange } from '../lib/dashboard-range';
import { formatDashboardDateRange, type DashboardDateRange } from '../lib/dashboard-date-range';
import { DashboardDateRangePicker } from './DashboardDateRangePicker';

const RANGE_OPTIONS: readonly { id: DashboardRange; label: string }[] = [
  { id: 'today', label: '' },
  { id: 'last-24-hours', label: '1D' },
  { id: 'last-7-days', label: '7D' },
  { id: 'last-30-days', label: '30D' },
  { id: 'last-90-days', label: '90D' },
];

/** Shared calendar presets and custom picker; the caller owns query scope. */
export function DashboardTimeRangeControl({ value, onChange, customRange = null, onCustomRangeChange, disabled = false }: {
  value: DashboardRange;
  onChange: (value: DashboardRange) => void;
  customRange?: DashboardDateRange | null;
  onCustomRangeChange: (range: DashboardDateRange) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    <div className="flex shrink-0 items-center rounded-full bg-surface-secondary p-0.5" role="group" aria-label={t('usage.filter.timeRange')}>
      {RANGE_OPTIONS.map(option => <Button
        aria-pressed={!customRange && value === option.id}
        render={props => <button {...props} title={option.id === 'last-24-hours' ? t('usage.range.last24HoursHint') : undefined} />}
        className={`!h-6 !min-h-6 !min-w-0 rounded-full px-3 text-xs font-normal transition-none! ${!customRange && value === option.id ? '!bg-accent !text-accent-foreground' : '!bg-transparent text-muted hover:text-foreground'}`}
        isDisabled={disabled}
        key={option.id}
        size="sm"
        variant="ghost"
        onPress={() => onChange(option.id)}
      >{option.id === 'today' ? t('usage.range.today') : option.label}</Button>)}
      <DashboardDateRangePicker value={customRange} initialDays={DASHBOARD_RANGE_DAYS[value]} disabled={disabled} onChange={onCustomRangeChange} />
    </div>
    {customRange && <span className="text-xs text-muted">{formatDashboardDateRange(customRange)}</span>}
  </div>;
}
