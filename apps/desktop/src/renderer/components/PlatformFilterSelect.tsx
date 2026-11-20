import type { ReactNode } from 'react';
import { Check, ChevronDown } from '@gravity-ui/icons';
import { Button, Popover } from '@heroui/react';
import { FilterMenuPopover } from './FilterMenu';
import { TOOLTIP_SHADOW } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { useTranslation } from 'quotern-i18n/react';

export {
  applyPlatformFilterChange,
  PlatformFilterSelect,
} from '../../../../../packages/dashboard/src/components/PlatformFilterSelect';

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
  const { t } = useTranslation();
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
        aria-label={t('usage.filter.genericAria', { label })}
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

      <FilterMenuPopover
        className="min-w-56 overflow-hidden rounded-[10px] border border-border bg-overlay p-0 text-overlay-foreground"
        placement="bottom end"
        style={{ boxShadow: TOOLTIP_SHADOW }}
        header={<div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
            <Popover.Heading className="text-[10px] font-semibold tracking-wider text-muted">
              {heading}
            </Popover.Heading>
            <div className="flex items-center gap-1">
              <button
                className="rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
                type="button"
                onClick={() => onChange([...allKeys])}
              >
                {t('usage.filter.all')}
              </button>
              <span aria-hidden="true" className="text-border">
                ·
              </span>
              <button
                className="rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
                type="button"
                onClick={() => onChange([])}
              >
                {t('usage.filter.clear')}
              </button>
            </div>
          </div>}
      >
          <ul
            aria-multiselectable="true"
            className="p-1.5"
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
      </FilterMenuPopover>
    </Popover>
  );
}
