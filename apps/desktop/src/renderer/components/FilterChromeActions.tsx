import { useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { CircleDollarSign, History as RotateCcwClock, RefreshCw, Settings, Share2, Wallet } from 'lucide-react';
import { Button, Tooltip } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { AchievementEntry } from '../achievements/AchievementEntry';
import { AutoUpdateAction } from '@/components/AutoUpdateAction';
import { useAppToastQueue } from '@/components/AppToastContext';
import { isCliBackend, triggerSync } from '@/lib/api';
import {
  dispatchDataSynced,
  dispatchOpenSettings,
  shareCurrentPage,
} from '@/lib/shell-events';
import { cn } from '@/lib/utils';
import { createSessionPageSearch, type SessionScope } from '../../../../../packages/dashboard/src/lib/session-page';
import { registerMessages } from 'quotern-i18n';
import { billingMessages } from '../../../../../packages/dashboard/src/i18n/billing-messages';
registerMessages(billingMessages);

const primaryChromeBtn =
  'inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-[#1e80ff] px-2.5 text-[12px] font-medium text-white outline-none transition-colors hover:bg-[#1171ee] focus-visible:ring-2 focus-visible:ring-[#1e80ff]/40 disabled:pointer-events-none disabled:opacity-40 dark:bg-[#4b9cff] dark:hover:bg-[#3a8ff0]';
/** Filter-bar chrome: page actions / refresh / settings. */
export function FilterChromeActions({ sessionScope }: { sessionScope?: SessionScope }) {
  const { t } = useTranslation();
  const cliBackend = isCliBackend();
  const toastQueue = useAppToastQueue();
  const [busy, setBusy] = useState(false);
  const refreshLabel = t(cliBackend ? 'shell.syncData' : 'shell.refreshData');

  const refreshData = async () => {
    setBusy(true);
    try {
      if (cliBackend) {
        const result = await triggerSync();
        if (!result.ok) {
          toastQueue.add({
            title: t('shell.syncFailed'),
            variant: 'danger',
          });
          return;
        }
        toastQueue.add({ title: t('shell.syncSuccess'), variant: 'success' });
        // Electron IPC already pushes DATA_SYNCED; a second dispatch double-reloads charts.
        if (typeof window.tud?.onDataSynced !== 'function') {
          dispatchDataSynced();
        }
      } else {
        dispatchDataSynced();
      }
    } catch {
      toastQueue.add({
        title: t('shell.syncFailed'),
        variant: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <AutoUpdateAction className={primaryChromeBtn} />
      {cliBackend && sessionScope && <Tooltip closeDelay={80} delay={100}>
        <Tooltip.Trigger aria-label={t('usage.activity.pageTitle')} className="button button--sm button--tertiary button--icon-only inline-flex size-8 min-h-8 min-w-8 shrink-0 p-0" render={props => <Link {...(props as ComponentPropsWithRef<'a'>)} role="link" to="/sessions" search={createSessionPageSearch(sessionScope)} />}>
          <RotateCcwClock className="size-4" aria-hidden />
        </Tooltip.Trigger>
        <Tooltip.Content placement="bottom"><p>{t('usage.activity.pageTitle')}</p></Tooltip.Content>
      </Tooltip>}
      <Tooltip closeDelay={80} delay={100}>
        <Tooltip.Trigger
          aria-label={t('shell.pricing')}
          className="button button--sm button--tertiary button--icon-only inline-flex size-8 min-h-8 min-w-8 shrink-0 p-0"
          render={(props) => (
            <Link
              {...(props as ComponentPropsWithRef<'a'>)}
              role="link"
              to="/pricing"
              search={{ q: '' }}
            />
          )}
        >
          <CircleDollarSign className="size-4" aria-hidden />
        </Tooltip.Trigger>
        <Tooltip.Content placement="bottom">
          <p>{t('shell.pricing')}</p>
        </Tooltip.Content>
      </Tooltip>
      {cliBackend && <Tooltip><Tooltip.Trigger aria-label={t('billing.title')} className="button button--sm button--tertiary button--icon-only size-8" render={props => <Link {...(props as ComponentPropsWithRef<'a'>)} to="/billing" />}><Wallet aria-hidden className="size-4" /></Tooltip.Trigger><Tooltip.Content>{t('billing.title')}</Tooltip.Content></Tooltip>}
      <AchievementEntry />
      <ChromeAction
        icon={<Share2 className="size-4" aria-hidden />}
        label={t('shell.share')}
        onPress={() => {
          void shareCurrentPage();
        }}
      />
      <ChromeAction
        disabled={busy}
        icon={
          <RefreshCw
            className={cn('size-4', busy && 'animate-spin')}
            aria-hidden
          />
        }
        label={refreshLabel}
        onPress={() => {
          void refreshData();
        }}
      />
      <ChromeAction
        icon={<Settings className="size-4" aria-hidden />}
        label={t('shell.settings')}
        onPress={() => dispatchOpenSettings()}
      />
    </div>
  );
}

function ChromeAction({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip closeDelay={80} delay={100}>
      <Button
        aria-label={label}
        className="size-8 min-h-8 min-w-8 shrink-0 p-0"
        isDisabled={disabled}
        isIconOnly
        onPress={onPress}
        size="sm"
        variant="tertiary"
      >
        {icon}
      </Button>
      <Tooltip.Content placement="bottom">
        <p>{label}</p>
      </Tooltip.Content>
    </Tooltip>
  );
}
