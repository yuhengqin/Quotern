import { useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { CircleDollarSign, History as RotateCcwClock, RefreshCw, Settings, Share2, Wallet } from 'lucide-react';
import { Button, Tooltip } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { AchievementEntry } from '../achievements/AchievementEntry';
import { useAppToastQueue } from '@/components/AppToastContext';
import { CHROME_ICON_BUTTON_CLASS_NAME } from './chrome-action-styles';
import { isCliBackend, triggerSync } from '@/lib/api';
import {
  dispatchDataSynced,
  dispatchOpenSettings,
  shareCurrentPage,
} from '@/lib/shell-events';
import { cn } from '@/lib/utils';
import { createSessionPageSearch, type SessionScope } from '../lib/session-page';
import { isDemoMode } from '../lib/demo-runtime';
import { registerMessages } from 'quotern-i18n';
import { billingMessages } from '../i18n/billing-messages';
registerMessages(billingMessages);

/**
 * Page actions and an always-available settings entry for browser preferences.
 * Sync is available only with the local runtime.
 */
export function FilterChromeActions({ sessionScope }: { sessionScope?: SessionScope }) {
  const { t } = useTranslation();
  const toastQueue = useAppToastQueue();
  const cliBackend = isCliBackend();
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
        if (
          typeof (window as { tud?: { onDataSynced?: unknown } }).tud
            ?.onDataSynced !== 'function'
        ) {
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
      {cliBackend && sessionScope && <Tooltip closeDelay={80} delay={100}>
        <Tooltip.Trigger aria-label={t('usage.activity.pageTitle')} className={CHROME_ICON_BUTTON_CLASS_NAME} render={props => <Link {...(props as ComponentPropsWithRef<'a'>)} role="link" to="/sessions" search={createSessionPageSearch(sessionScope)} />}>
          <RotateCcwClock className="size-4" aria-hidden />
        </Tooltip.Trigger>
        <Tooltip.Content placement="bottom"><p>{t('usage.activity.pageTitle')}</p></Tooltip.Content>
      </Tooltip>}
      <Tooltip closeDelay={80} delay={100}>
        <Tooltip.Trigger
          aria-label={t('shell.pricing')}
          className={CHROME_ICON_BUTTON_CLASS_NAME}
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
      {cliBackend && !isDemoMode() && (
        <Tooltip closeDelay={80} delay={100}>
          <Tooltip.Trigger
            aria-label={t('billing.title')}
            className={CHROME_ICON_BUTTON_CLASS_NAME}
            render={props => <Link {...(props as ComponentPropsWithRef<'a'>)} role="link" to="/billing" />}
          >
            <Wallet aria-hidden className="size-4" />
          </Tooltip.Trigger>
          <Tooltip.Content placement="bottom"><p>{t('billing.title')}</p></Tooltip.Content>
        </Tooltip>
      )}
      <AchievementEntry />
      <ChromeAction
        icon={<Share2 className="size-4" aria-hidden />}
        label={t('shell.share')}
        onPress={() => {
          void shareCurrentPage();
        }}
      />
      {cliBackend && !isDemoMode() ? (
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
      ) : null}
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
        className={CHROME_ICON_BUTTON_CLASS_NAME}
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
