import { useMemo, useRef } from 'react';
import { Xmark } from '@gravity-ui/icons';
import {
  Button,
  ButtonGroup,
  Label,
  ListBox,
  Select,
} from '@heroui/react';
import { FilterChromeActions } from '@/components/FilterChromeActions';
import { ProviderIcon } from '@/components/ProviderIcon';
import type { DashboardToolUsageRow } from '@/lib/dashboard-mock-data';
import { sourceLabel } from '@/lib/tokens';
import { DashboardDateRangePicker } from './DashboardDateRangePicker';
import { formatDashboardDateRange, type DashboardDateRange } from '@/lib/dashboard-date-range';
import { DASHBOARD_RANGE_DAYS, type DashboardRange } from '../../shared/dashboard-range';

export {
  DASHBOARD_RANGE_DAYS,
  type DashboardRange,
} from '../../shared/dashboard-range';

const RANGE_OPTIONS: readonly { id: DashboardRange; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'last-7-days', label: '7D' },
  { id: 'last-30-days', label: '30D' },
  { id: 'last-90-days', label: '90D' },
];

export function DashboardFilter({
  value,
  onChange,
  tools,
  selectedTools,
  onToolsChange,
  customRange = null,
  onCustomRangeChange,
  disabled = false,
}: {
  value: DashboardRange;
  onChange: (value: DashboardRange) => void;
  tools: DashboardToolUsageRow[];
  /** Empty = all available tools. */
  selectedTools: string[];
  onToolsChange: (sources: string[]) => void;
  customRange?: DashboardDateRange | null;
  onCustomRangeChange: (range: DashboardDateRange) => void;
  /** When true, ignore range/tool changes (e.g. while local range sync runs). */
  disabled?: boolean;
}) {
  const availableTools = useMemo(
    () => tools.filter((tool) => tool.tokens > 0),
    [tools],
  );

  return (
    <div className="mb-5 flex min-w-0 flex-wrap items-center gap-2" aria-label="筛选条件">
      <div className="flex shrink-0 items-center rounded-full bg-surface-secondary p-0.5" role="group" aria-label="时间范围">
        {RANGE_OPTIONS.map((option) => (
          <Button
            aria-pressed={!customRange && value === option.id}
            className={`!h-6 !min-h-6 !min-w-0 rounded-full px-3 text-xs font-normal transition-none! ${!customRange && value === option.id ? '!bg-accent !text-accent-foreground' : '!bg-transparent text-muted hover:text-foreground'}`}
            isDisabled={disabled}
            key={option.id}
            size="sm"
            variant="ghost"
            onPress={() => onChange(option.id)}
          >{option.label}</Button>
        ))}
        <DashboardDateRangePicker value={customRange} initialDays={DASHBOARD_RANGE_DAYS[value]} disabled={disabled} onChange={onCustomRangeChange} />
      </div>
      {customRange && <span className="text-xs text-muted">{formatDashboardDateRange(customRange)}</span>}

      {/* Reserve the Agent slot so time controls stay stable as data changes. */}
      <div className="flex min-h-8 min-w-0 shrink-0 items-center">
        {availableTools.length > 0 ? (
          <ToolChannelSelect
            selectedTools={selectedTools}
            tools={availableTools}
            onChange={(sources) => {
              if (disabled) return;
              onToolsChange(sources);
            }}
          />
        ) : null}
      </div>

      <div className="ml-auto shrink-0">
        <FilterChromeActions />
      </div>
    </div>
  );
}

/** The dashboard's single, compact multi-select entry point for tools. */
export function ToolChannelSelect({
  ariaLabel = '筛选 Agent',
  tools,
  selectedTools,
  onChange,
}: {
  ariaLabel?: string;
  tools: Pick<DashboardToolUsageRow, 'source'>[];
  selectedTools: string[];
  onChange: (sources: string[]) => void;
}) {
  const availableSources = useMemo(
    () => new Set(tools.map((tool) => tool.source)),
    [tools],
  );
  const value = selectedTools.filter((source) => availableSources.has(source));
  const hasSelection = value.length > 0;
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <ButtonGroup className="shrink-0">
      <Select
        aria-label={ariaLabel}
        className="w-fit max-w-52 text-xs"
        selectionMode="multiple"
        value={value}
        variant="secondary"
        onChange={(keys) => {
          const next = Array.isArray(keys)
            ? keys.map(String)
            : keys == null
              ? []
              : [String(keys)];
          onChange(next.filter((source) => availableSources.has(source)));
        }}
      >
        <Label className="sr-only">Agent</Label>
        <Select.Trigger
          ref={triggerRef}
          className={`!h-8 !min-h-8 !w-fit max-w-52 ps-3 pe-8 !text-xs font-normal ${
            hasSelection ? '!rounded-r-none' : '!rounded-full'
          }`}
        >
          <Select.Value className="min-w-0 max-w-40 !text-xs">
            {({ state }) => {
              const selected = state.selectedItems
                .map((item) => tools.find((tool) => tool.source === item.key))
                .filter((tool): tool is Pick<DashboardToolUsageRow, 'source'> => Boolean(tool));
              if (selected.length === 0) return '全部 Agent';
              if (selected.length > 1) return `已选 ${selected.length} 个 Agent`;

              const [tool] = selected;
              return tool ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <ProviderIcon provider={tool.source} size={18} />
                  <span className="truncate">{sourceLabel(tool.source)}</span>
                </span>
              ) : '全部 Agent';
            }}
          </Select.Value>
          <Select.Indicator className="size-3.5 text-muted" />
        </Select.Trigger>
        <Select.Popover
          className="w-50 rounded-xl bg-surface shadow-md"
          placement="bottom start"
        >
          <ListBox aria-label="Agent 列表" selectionMode="multiple">
            {tools.map((tool) => (
              <ListBox.Item
                className="py-1 rounded-lg px-1.5 text-xs gap-2!"
                id={tool.source}
                key={tool.source}
                textValue={sourceLabel(tool.source)}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md ">
                  <ProviderIcon provider={tool.source} size={18} />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {sourceLabel(tool.source)}
                </span>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      {hasSelection ? (
        <Button
          aria-label="清空 Agent 筛选"
          className="!h-8 !min-h-8 !w-8 !min-w-8 !rounded-l-none !rounded-r-full p-0"
          size="sm"
          isIconOnly
          variant="tertiary"
          onPress={() => {
            onChange([]);
            triggerRef.current?.focus();
          }}
        >
          <ButtonGroup.Separator />
          <Xmark className="size-3.5" />
        </Button>
      ) : null}
    </ButtonGroup>
  );
}
