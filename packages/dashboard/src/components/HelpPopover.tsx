import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, Popover } from '@heroui/react';
import { PreviewTrigger } from 'react-aria-components';
import { CircleHelp } from 'lucide-react';
import { useInteractOutside } from 'react-aria';
import { useTranslation } from 'quotern-i18n/react';
import { cn } from '@/lib/utils';
import { isTopmostPopover } from '../lib/overlay-dismiss';

/** Rich help opens on interest, without moving focus or blocking the page. */
export function HelpPopup({ title, showTitle = true, children, trigger, isOpen, onOpenChange }: {
  title: string;
  showTitle?: boolean;
  children: ReactNode;
  trigger: ReactNode | ((open: () => void) => ReactNode);
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = isOpen ?? localOpen;
  const changeOpen = useCallback((next: boolean) => {
    setLocalOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange]);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  useInteractOutside({
    ref: contentRef,
    isDisabled: !open,
    onInteractOutside: event => {
      if (!anchorRef.current?.contains(event.target as Node)) changeOpen(false);
    },
  });
  useEffect(() => {
    if (!open) return;
    const ownerDocument = anchorRef.current?.ownerDocument;
    const onScroll = (event: Event) => {
      const anchor = anchorRef.current;
      if (anchor && event.target instanceof Node && event.target.contains(anchor)) changeOpen(false);
    };
    // Hover does not move focus, so Escape may originate outside this overlay.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTopmostPopover(contentRef.current)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (contentRef.current?.contains(ownerDocument?.activeElement ?? null)) {
        anchorRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
      }
      changeOpen(false);
    };
    ownerDocument?.addEventListener('scroll', onScroll, true);
    ownerDocument?.addEventListener('keydown', onKeyDown, true);
    return () => {
      ownerDocument?.removeEventListener('scroll', onScroll, true);
      ownerDocument?.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, changeOpen]);
  return <span ref={anchorRef} className="inline-flex shrink-0 align-middle">
    <PreviewTrigger delay={150} closeDelay={150} isOpen={open} onOpenChange={changeOpen}>
      {typeof trigger === 'function' ? trigger(() => changeOpen(true)) : trigger}
      <Popover.Content ref={contentRef} isNonModal shouldSkipAnimation maxHeight={448} placement="bottom start" offset={8} aria-label={showTitle ? undefined : title} aria-labelledby={showTitle ? headingId : undefined} className={cn('help-popup', !showTitle && 'help-popup--plain')}>
        {showTitle && <h2 id={headingId} className="help-popup__title">{title}</h2>}
        <div className="help-popup__content">{children}</div>
      </Popover.Content>
    </PreviewTrigger>
  </span>;
}

export function HelpPopover({ title, showTitle = false, children, ariaLabel, icon, triggerClassName }: {
  title: string;
  /** Only show headings that add information beyond the adjacent label. */
  showTitle?: boolean;
  children: ReactNode;
  ariaLabel?: string;
  icon?: ReactNode;
  triggerClassName?: string;
}) {
  const { t } = useTranslation();
  const label = ariaLabel ?? t('usage.session.helpAria', { label: title });
  return <HelpPopup title={title} showTitle={showTitle} trigger={open => <Button aria-label={label} onPress={open} isIconOnly size="sm" variant="ghost" className={cn('size-5 min-h-5 min-w-5 shrink-0 cursor-help p-0 text-muted data-[hovered]:bg-transparent data-[hovered]:text-accent', triggerClassName)}>
    {icon ?? <CircleHelp aria-hidden className="size-3.5" />}
  </Button>}>{children}</HelpPopup>;
}
