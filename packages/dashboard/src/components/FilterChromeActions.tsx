import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Coins } from 'lucide-react';
import {
  ArrowsRotateRight,
  Gear,
  LogoGithub,
  NodesRight,
} from '@gravity-ui/icons';
import { Button, Tooltip } from '@heroui/react';
import { useAppToastQueue } from '@/components/AppToastContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { isCliBackend, triggerSync } from '@/lib/api';
import { GITHUB_REPO_URL } from '@/lib/downloads';
import {
  dispatchDataSynced,
  dispatchOpenSettings,
  shareCurrentPage,
} from '@/lib/shell-events';
import { cn } from '@/lib/utils';

function openGithubRepository(): void {
  const opened = window.open(GITHUB_REPO_URL, '_blank');
  if (opened) {
    opened.opener = null;
    return;
  }
  window.location.assign(GITHUB_REPO_URL);
}

/**
 * Filter-bar chrome: share / refresh / settings + theme toggle.
 * Public web shows share + theme; CLI also shows refresh / settings.
 */
export function FilterChromeActions() {
  const toastQueue = useAppToastQueue();
  const cliBackend = isCliBackend();
  const [busy, setBusy] = useState(false);
  const refreshLabel = cliBackend ? '同步数据' : '刷新数据';
  const refreshData = async () => {
    setBusy(true);
    try {
      if (cliBackend) {
        const result = await triggerSync();
        if (!result.ok) {
          toastQueue.add({
            title: '同步失败，请稍后重试',
            variant: 'danger',
          });
          return;
        }
        toastQueue.add({ title: '同步成功', variant: 'success' });
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
        title: '同步失败，请稍后重试',
        variant: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Link
        to="/pricing"
        search={{ q: '' }}
        className="mr-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface-secondary px-3 text-xs font-medium hover:bg-default focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Coins className="size-3.5" aria-hidden />
        模型价格
      </Link>
      <ChromeAction
        icon={<LogoGithub className="size-4" />}
        label="GitHub 仓库"
        onPress={openGithubRepository}
      />
      <ChromeAction
        icon={<NodesRight className="size-4" />}
        label="分享"
        onPress={() => {
          void shareCurrentPage();
        }}
      />
      {cliBackend ? (
        <>
          <ChromeAction
            disabled={busy}
            icon={
              <ArrowsRotateRight
                className={cn('size-4', busy && 'animate-spin')}
              />
            }
            label={refreshLabel}
            onPress={() => {
              void refreshData();
            }}
          />
          <ChromeAction
            icon={<Gear className="size-4" />}
            label="设置"
            onPress={() => dispatchOpenSettings()}
          />
        </>
      ) : null}
      <ThemeToggle />
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
