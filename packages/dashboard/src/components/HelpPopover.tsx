import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Popover, Tooltip } from '@heroui/react';
import { CircleHelp } from 'lucide-react';
import { useInteractOutside } from 'react-aria';
import { useTranslation } from 'quotern-i18n/react';

/** Supplementary explanations stay beside the result, available by keyboard or click. */
export function HelpPopover({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // React Aria's non-modal popover permits page scrolling but needs explicit
  // outside-click dismissal for a standalone help button.
  useInteractOutside({
    ref: contentRef,
    isDisabled: !open,
    onInteractOutside: event => {
      if (!triggerRef.current || !event.composedPath().includes(triggerRef.current)) setOpen(false);
    },
  });
  useEffect(() => {
    if (!open) return;
    const ownerDocument = triggerRef.current?.ownerDocument;
    // Help has no keyboard input to preserve: close on ancestor scroll even
    // during React Aria's viewport-resize grace period. Internal scroll stays open.
    const onScroll = (event: Event) => {
      const trigger = triggerRef.current;
      if (trigger && event.target instanceof Node && event.target.contains(trigger)) setOpen(false);
    };
    ownerDocument?.addEventListener('scroll', onScroll, true);
    return () => ownerDocument?.removeEventListener('scroll', onScroll, true);
  }, [open]);
  const label = t('usage.session.helpAria', { label: title });
  return <Popover isOpen={open} onOpenChange={setOpen}>
    <Tooltip delay={400} isDisabled={open}>
      <Button ref={triggerRef} aria-label={label} isIconOnly size="sm" variant="ghost" className="size-5 min-h-5 min-w-5 shrink-0 p-0 text-muted data-[hovered]:text-foreground"><CircleHelp aria-hidden className="size-3.5" /></Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
    <Popover.Content ref={contentRef} isNonModal shouldSkipAnimation maxHeight={448} placement="bottom start" className="flex w-96 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border-0 bg-overlay p-0 text-overlay-foreground shadow-surface">
      <Popover.Dialog className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-4 text-xs leading-5 outline-none">
        <Popover.Heading className="font-semibold">{title}</Popover.Heading>
        {children}
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}
