import type { ReactNode } from 'react';
import { Check, ChevronDown } from '@gravity-ui/icons';
import { Button, Popover } from '@heroui/react';
import { ProviderIcon } from '@/components/ProviderIcon';
import { sourceLabel } from '@/lib/tokens';
import { cn } from '@/lib/utils';

/**
 * Text-only multi-select used by Token / Daily / Heatmap platform filters.
 * Parent owns `null = 全部` semantics; pass `value = allSources` when unfiltered.
 */
export function PlatformFilterSelect({
  allSources,
  value,
  onChange,
}: {
  allSources: string[];
  value: string[];
  onChange: (keys: string[]) => void;
}) {
  if (allSources.length === 0) return null;

  const selected = new Set(value);
  const allSelected = value.length === allSources.length;
  const isFiltered = !allSelected && value.length > 0;

  let label = '全部平台';
  if (value.length === 0) label = '选择平台';
  else if (!allSelected && value.length === 1) {
    label = sourceLabel(value[0] ?? '');
  } else if (!allSelected) {
    label = `已选 ${value.length} 个平台`;
  }

  const toggleSource = (source: string) => {
    const next = new Set(selected);
    if (next.has(source)) next.delete(source);
    else next.add(source);
    onChange([...next]);
  };

  return (
    <Popover>
      <Button
        aria-label={`筛选平台：${label}`}
        className={cn(
          'h-auto min-h-0 max-w-36 gap-1 rounded-none border-0 bg-transparent p-0',
          'text-xs font-medium text-muted shadow-none',
          'hover:bg-transparent hover:text-foreground',
          'data-[pressed=true]:bg-transparent data-[pressed=true]:text-foreground',
          isFiltered && 'text-foreground',
        )}
        size="sm"
        variant="ghost"
      >
        {!allSelected && value.length === 1 && value[0] ? (
          <ProviderIcon provider={value[0]} size={12} />
        ) : null}
        <span className="min-w-0 max-w-28 truncate whitespace-nowrap">
          {label}
        </span>
        <ChevronDown className="size-3.5 shrink-0 opacity-70" />
      </Button>

      <Popover.Content
        className="min-w-56 overflow-hidden rounded-[10px] border-0 bg-overlay p-0 text-overlay-foreground shadow-surface"
        placement="bottom end"
      >
        <Popover.Dialog className="p-0 outline-none">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <Popover.Heading className="text-[10px] font-semibold tracking-wider text-muted">
              选择平台
            </Popover.Heading>
            <div className="flex items-center gap-1">
              <button
                className="rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
                type="button"
                onClick={() => onChange([...allSources])}
              >
                全部
              </button>
              <button
                className="rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
                type="button"
                onClick={() => onChange([])}
              >
                清空
              </button>
            </div>
          </div>

          <ul
            aria-multiselectable="true"
            className="max-h-64 overflow-y-auto p-1.5"
            role="listbox"
          >
            {allSources.map((source) => {
              const isSelected = selected.has(source);
              return (
                <li aria-selected={isSelected} key={source} role="option">
                  <button
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors',
                      'hover:bg-surface-secondary',
                      isSelected && 'bg-accent/10 hover:bg-accent/15',
                    )}
                    type="button"
                    onClick={() => toggleSource(source)}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                        isSelected
                          ? 'border-accent bg-accent text-accent-foreground'
                          : 'border-border bg-surface',
                      )}
                    >
                      {isSelected ? <Check className="size-2.5" /> : null}
                    </span>
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white">
                      <ProviderIcon
                        onLightBackground
                        provider={source}
                        size={14}
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {sourceLabel(source)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

/** Normalize onChange so selecting all keys collapses to `null` (=全部). */
export function applyPlatformFilterChange(
  keys: string[],
  allSources: string[],
  setSelected: (next: string[] | null) => void,
): void {
  if (keys.length === 0) {
    setSelected([]);
    return;
  }
  if (
    keys.length === allSources.length &&
    allSources.every((source) => keys.includes(source))
  ) {
    setSelected(null);
    return;
  }
  setSelected(keys);
}

/** Optional custom multi-key filter trigger (e.g. models). */
export function KeyFilterSelect({
  allKeys,
  value,
  onChange,
  heading,
  fullLabel,
  emptyLabel,
  triggerLabel,
  triggerIcon,
  renderOption,
}: {
  allKeys: string[];
  value: string[];
  onChange: (keys: string[]) => void;
  heading: string;
  fullLabel: string;
  emptyLabel: string;
  triggerLabel: (keys: string[], allSelected: boolean) => string;
  triggerIcon?: (keys: string[]) => ReactNode;
  renderOption: (key: string) => ReactNode;
}) {
  if (allKeys.length === 0) return null;

  const selected = new Set(value);
  const allSelected = value.length === allKeys.length;
  const isFiltered = !allSelected && value.length > 0;
  const label =
    triggerLabel(value, allSelected) ||
    (allSelected ? fullLabel : emptyLabel);

  const toggleKey = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange([...next]);
  };

  return (
    <Popover>
      <Button
        aria-label={`筛选：${label}`}
        className={cn(
          'h-auto min-h-0 max-w-36 gap-1 rounded-none border-0 bg-transparent p-0',
          'text-xs font-medium text-muted shadow-none',
          'hover:bg-transparent hover:text-foreground',
          'data-[pressed=true]:bg-transparent data-[pressed=true]:text-foreground',
          isFiltered && 'text-foreground',
        )}
        size="sm"
        variant="ghost"
      >
        {triggerIcon?.(value)}
        <span className="min-w-0 max-w-28 truncate whitespace-nowrap">
          {label}
        </span>
        <ChevronDown className="size-3.5 shrink-0 opacity-70" />
      </Button>

      <Popover.Content
        className="min-w-56 overflow-hidden rounded-[10px] border-0 bg-overlay p-0 text-overlay-foreground shadow-surface"
        placement="bottom end"
      >
        <Popover.Dialog className="p-0 outline-none">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <Popover.Heading className="text-[10px] font-semibold tracking-wider text-muted">
              {heading}
            </Popover.Heading>
            <div className="flex items-center gap-1">
              <button
                className="rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
                type="button"
                onClick={() => onChange([...allKeys])}
              >
                全部
              </button>
              <button
                className="rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
                type="button"
                onClick={() => onChange([])}
              >
                清空
              </button>
            </div>
          </div>

          <ul
            aria-multiselectable="true"
            className="max-h-64 overflow-y-auto p-1.5"
            role="listbox"
          >
            {allKeys.map((key) => {
              const isSelected = selected.has(key);
              return (
                <li aria-selected={isSelected} key={key} role="option">
                  <button
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors',
                      'hover:bg-surface-secondary',
                      isSelected && 'bg-accent/10 hover:bg-accent/15',
                    )}
                    type="button"
                    onClick={() => toggleKey(key)}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                        isSelected
                          ? 'border-accent bg-accent text-accent-foreground'
                          : 'border-border bg-surface',
                      )}
                    >
                      {isSelected ? <Check className="size-2.5" /> : null}
                    </span>
                    {renderOption(key)}
                  </button>
                </li>
              );
            })}
          </ul>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
