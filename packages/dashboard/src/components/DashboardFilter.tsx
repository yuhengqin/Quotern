import { useMemo, useRef } from 'react';
import { useTranslation } from 'quotern-i18n/react';
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
import type { SessionScope } from '../lib/session-page';
import { sourceLabel } from '@/lib/tokens';
import { DashboardTimeRangeControl } from './DashboardTimeRangeControl';
import type { DashboardDateRange } from '@/lib/dashboard-date-range';
import type { DashboardRange } from '../lib/dashboard-range';
import { FilterSelectPopover } from './FilterMenu';

export { DASHBOARD_RANGE_DAYS, type DashboardRange } from '../lib/dashboard-range';

export function DashboardFilter({
  value,
  onChange,
  tools,
  selectedTools,
  onToolsChange,
  customRange = null,
  onCustomRangeChange,
  disabled = false,
  sessionScope,
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
  sessionScope?: SessionScope;
}) {
  const { t } = useTranslation();
  const availableTools = useMemo(
    () => tools.filter((tool) => tool.tokens > 0),
    [tools],
  );

  return (
    <div className="mb-5 flex min-w-0 flex-wrap items-center gap-2" aria-label={t('usage.filter.conditions')}>
      <DashboardTimeRangeControl value={value} customRange={customRange} onChange={onChange} onCustomRangeChange={onCustomRangeChange} disabled={disabled} />

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
        <FilterChromeActions sessionScope={sessionScope} />
      </div>
    </div>
  );
}

/** The dashboard's single, compact multi-select entry point for tools. */
export function ToolChannelSelect({
  ariaLabel,
  tools,
  selectedTools,
  onChange,
}: {
  ariaLabel?: string;
  tools: Pick<DashboardToolUsageRow, 'source'>[];
  selectedTools: string[];
  onChange: (sources: string[]) => void;
}) {
  const { t } = useTranslation();
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
        aria-label={ariaLabel ?? t('usage.filter.agent')}
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
          className={`!h-8 !min-h-8 !w-fit max-w-52 !items-center !py-0 ps-3 pe-8 !text-xs font-normal ${
            hasSelection ? '!rounded-r-none' : '!rounded-full'
          }`}
        >
          <Select.Value className="min-w-0 max-w-40 !text-xs !leading-4">
            {({ state }) => {
              const selected = state.selectedItems
                .map((item) => tools.find((tool) => tool.source === item.key))
                .filter((tool): tool is Pick<DashboardToolUsageRow, 'source'> => Boolean(tool));
              if (selected.length === 0) return t('usage.filter.allAgents');
              if (selected.length > 1) return t('usage.filter.selectedAgents', { count: selected.length });

              const [tool] = selected;
              return tool ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <ProviderIcon provider={tool.source} size={18} />
                  <span className="truncate">{sourceLabel(tool.source)}</span>
                </span>
              ) : t('usage.filter.allAgents');
            }}
          </Select.Value>
          <Select.Indicator className="size-3.5 text-muted" />
        </Select.Trigger>
        <FilterSelectPopover
          className="w-50 rounded-xl bg-surface shadow-md"
          placement="bottom start"
        >
          <ListBox aria-label={t('usage.filter.agentList')} selectionMode="multiple">
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
        </FilterSelectPopover>
      </Select>
      {hasSelection ? (
        <Button
          aria-label={t('usage.filter.clearAgents')}
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
