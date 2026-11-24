import type { ReactNode } from 'react';
import { Drawer } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';

/** A viewport-edge dialog. HeroUI owns the portal, focus scope and dismissal stack. */
export function SideDrawer({ isOpen, onOpenChange, title, children, footer }: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  return <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} className="bg-black/25 dark:bg-black/45">
    <Drawer.Content placement="right" className="pt-[var(--desktop-titlebar-height,0px)]">
      <Drawer.Dialog aria-label={title} className="w-full max-w-md gap-0 p-0">
        <Drawer.Header className="shrink-0 border-b border-separator px-5 py-4 pe-16 sm:px-6 sm:pe-16">
          <Drawer.Heading className="break-words">{title}</Drawer.Heading>
        </Drawer.Header>
        <Drawer.CloseTrigger aria-label={t('usage.common.close')} />
        <Drawer.Body className="m-0 min-w-0 px-5 py-5 text-foreground sm:px-6">{children}</Drawer.Body>
        {footer && <Drawer.Footer className="m-0 shrink-0 flex-wrap border-t border-separator px-5 py-3 sm:px-6">{footer}</Drawer.Footer>}
      </Drawer.Dialog>
    </Drawer.Content>
  </Drawer.Backdrop>;
}
