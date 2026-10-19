import type { ComponentProps, ReactNode } from 'react';
import { Autocomplete, Popover, Select } from '@heroui/react';
import { cn } from '../lib/utils';

export const FILTER_MENU_MAX_HEIGHT = 320;
const MENU_WIDTH = 'max-w-[calc(100vw-2rem)]';

/** Keep HeroUI's selection, keyboard, focus and viewport-positioning contracts. */
export function FilterSelectPopover({ className, ...props }: Omit<ComponentProps<typeof Select.Popover>, 'maxHeight'>) {
  return <Select.Popover {...props} maxHeight={FILTER_MENU_MAX_HEIGHT}
    className={state => cn(MENU_WIDTH, typeof className === 'function' ? className(state) : className)} />;
}

/** HeroUI keeps the search field and actions outside its shrinking listbox. */
export function FilterAutocompletePopover({ className, ...props }: Omit<ComponentProps<typeof Autocomplete.Popover>, 'maxHeight'>) {
  return <Autocomplete.Popover {...props} maxHeight={FILTER_MENU_MAX_HEIGHT}
    className={state => cn(MENU_WIDTH, typeof className === 'function' ? className(state) : className)} />;
}

type FilterMenuPopoverProps = Omit<ComponentProps<typeof Popover.Content>, 'children' | 'className' | 'maxHeight'> & {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** A cascading picker may use a grid with independently scrolling columns. */
  bodyClassName?: string;
};

/** Custom option lists share a bounded shell with fixed search/actions. */
export function FilterMenuPopover({ children, header, footer, className, bodyClassName, ...props }: FilterMenuPopoverProps) {
  return <Popover.Content {...props} maxHeight={FILTER_MENU_MAX_HEIGHT}
    className={cn(MENU_WIDTH, 'flex flex-col overflow-hidden p-0', className)}>
    <Popover.Dialog className="flex min-h-0 flex-col p-0 outline-none">
      {header && <div className="shrink-0">{header}</div>}
      <div className={cn('min-h-0 overflow-y-auto overscroll-contain', bodyClassName)}>{children}</div>
      {footer && <div className="shrink-0">{footer}</div>}
    </Popover.Dialog>
  </Popover.Content>;
}
