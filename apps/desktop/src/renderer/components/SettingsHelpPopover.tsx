import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import { HelpPopover } from '../../../../../packages/dashboard/src/components/HelpPopover';

/** Keep the trigger beside a setting label, outside the label's click target. */
export function SettingsHelpPopover({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  const helpLabel = t('desktop.settings.help', { label: title });

  return (
    <HelpPopover title={title} ariaLabel={helpLabel} icon={<Info aria-hidden className="size-3.5" />} triggerClassName="size-6 min-h-6 min-w-6">
      {children}
    </HelpPopover>
  );
}
