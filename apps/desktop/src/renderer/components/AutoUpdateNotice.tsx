import type { ToastQueue } from '@heroui/react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'quotern-i18n/react';
import type { AutoUpdateState } from '../../shared/auto-update';
import type { AppToastContent } from './AppToastProvider';

type AutoUpdateNoticeProps = {
  toastQueue: ToastQueue<AppToastContent>;
};

/** Shows a one-time success toast after an automatic update restarts the app. */
export function AutoUpdateNotice({ toastQueue }: AutoUpdateNoticeProps) {
  const { t } = useTranslation();
  const notifiedVersion = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const showCompletedToast = (state: AutoUpdateState) => {
      const version = state.completedVersion;
      if (!version || notifiedVersion.current === version) return;

      notifiedVersion.current = version;
      toastQueue.add({
        title: t('desktop.update.completedTitle', { version }),
        description: t('desktop.update.completedDescription'),
        variant: 'success',
      });
      void window.tud.acknowledgeUpdateCompleted().catch((reason) => {
        if (!cancelled) {
          console.warn('确认更新完成通知失败:', reason);
        }
      });
    };

    const unsubscribe = window.tud.onAutoUpdateStateChanged(showCompletedToast);
    void window.tud
      .getAutoUpdateState()
      .then((state) => {
        if (!cancelled) showCompletedToast(state);
      })
      .catch(() => {
        // Settings keeps the detailed error and retry flow for state failures.
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [toastQueue, t]);

  return null;
}
