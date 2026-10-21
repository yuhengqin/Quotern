import { useState, type ReactNode } from 'react';
import { Button, Popover, Tooltip } from '@heroui/react';
import { Info } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';

/** Keep the trigger beside a setting label, outside the label's click target. */
export function SettingsHelpPopover({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const helpLabel = t('desktop.settings.help', { label: title });

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Tooltip delay={400} isDisabled={open}>
        <Button
          aria-label={helpLabel}
          className="size-6 min-h-6 min-w-6 shrink-0 p-0 text-muted data-[hovered]:text-foreground"
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
        >
          <Info aria-hidden className="size-3.5" />
        </Button>
        <Tooltip.Content placement="top">{helpLabel}</Tooltip.Content>
      </Tooltip>
      <Popover.Content
        className="w-80 max-w-[calc(100vw-2rem)] rounded-xl border-0 bg-overlay p-0 text-overlay-foreground shadow-surface"
        placement="bottom start"
      >
        <Popover.Dialog className="max-h-[min(24rem,calc(100dvh-3rem))] overflow-y-auto p-4 outline-none">
          <Popover.Heading className="mb-2 text-sm font-semibold">{title}</Popover.Heading>
          <div className="space-y-3 text-sm leading-relaxed text-muted">{children}</div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
