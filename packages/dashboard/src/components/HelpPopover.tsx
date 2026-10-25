import { useState, type ReactNode } from 'react';
import { Button, Popover, Tooltip } from '@heroui/react';
import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';

/** Supplementary explanations stay beside the result, available by keyboard or click. */
export function HelpPopover({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = t('usage.session.helpAria', { label: title });
  return <Popover isOpen={open} onOpenChange={setOpen}>
    <Tooltip delay={400} isDisabled={open}>
      <Button aria-label={label} isIconOnly size="sm" variant="ghost" className="size-5 min-h-5 min-w-5 shrink-0 p-0 text-muted data-[hovered]:text-foreground"><CircleHelp aria-hidden className="size-3.5" /></Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
    <Popover.Content placement="bottom start" className="w-96 max-w-[calc(100vw-2rem)] rounded-xl border-0 bg-overlay p-0 text-overlay-foreground shadow-surface">
      <Popover.Dialog className="max-h-[min(28rem,calc(100dvh-3rem))] space-y-3 overflow-y-auto p-4 text-xs leading-5 outline-none">
        <Popover.Heading className="font-semibold">{title}</Popover.Heading>
        {children}
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}
