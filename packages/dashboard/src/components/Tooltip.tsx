import { Tooltip as HeroTooltip } from '@heroui/react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function TooltipRoot(props: ComponentProps<typeof HeroTooltip>) {
  return <HeroTooltip delay={150} closeDelay={150} {...props} />;
}

function TooltipContent({ children, className, showArrow = true, ...props }: ComponentProps<typeof HeroTooltip.Content>) {
  return <HeroTooltip.Content placement="bottom" {...props} showArrow={showArrow} className={values => cn('app-tooltip', typeof className === 'function' ? className(values) : className)}>
    {showArrow && <HeroTooltip.Arrow><svg width="8" height="4" viewBox="0 0 8 4" aria-hidden><path d="M0 0L4 4L8 0Z" /></svg></HeroTooltip.Arrow>}
    {children}
  </HeroTooltip.Content>;
}

/** Short, non-interactive hints share the WeKnora tooltip skin. */
export const Tooltip = Object.assign(TooltipRoot, {
  Content: TooltipContent,
  Trigger: HeroTooltip.Trigger,
  Arrow: HeroTooltip.Arrow,
});
