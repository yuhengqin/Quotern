import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { Toast, ToastQueue } from '@heroui/react';
import { AboutModal } from './AboutModal';
import { AppToastProvider } from './AppToastContext';
import { BackendConfigModal } from './BackendConfigModal';
import { ShareActivityModal } from './ShareActivityModal';
import { ShareSnapshotProvider } from '@/hooks/ShareSnapshotContext';
import { cn } from '@/lib/utils';
import { AchievementProvider } from '../achievements/AchievementProvider';
import { AchievementOverlays } from '../achievements/AchievementOverlays';
import { updateAchievements } from '@/lib/api';
import { getDemoMetadata, isDemoMode } from '../lib/demo-runtime';
import { StatusBanner } from './StatusBanner';
import { useTranslation } from 'quotern-i18n/react';
import { localDateNow } from '../lib/stats-timezone';

/** Local usage panel; navigation never starts account or cloud flows. */
export function AppShell() {
  const { t } = useTranslation();
  const demo = getDemoMetadata();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [toastQueue] = useState(() => new ToastQueue({ maxVisibleToasts: 2 }));

  useEffect(() => {
    if (pathname !== '/settings') return;
    setSettingsOpen(true);
    void navigate({ to: '/dashboard', replace: true });
  }, [pathname, navigate]);

  return (
    <AppToastProvider queue={toastQueue}>
      <ShareSnapshotProvider>
        <AchievementProvider request={updateAchievements} readOnly={isDemoMode()}>
        <div className="flex h-svh min-w-0 max-w-full flex-col overflow-hidden bg-background text-foreground">
          <Toast.Provider placement="top end" queue={toastQueue} />
          <div data-dashboard-scroll-container className={cn('relative min-h-0 flex-1 overflow-x-hidden overscroll-contain', pathname === '/pricing' ? 'overflow-y-hidden' : 'overflow-y-auto', pathname === '/dashboard' && '[overflow-anchor:none]')}>
            <div className="relative mx-auto w-full max-w-300 px-4 py-4 pb-12 sm:py-6 md:px-8 2xl:max-w-360">
              <main className="min-w-0 w-full">{demo && <div className="mb-4"><StatusBanner title={t('shell.demo.title')} description={t('shell.demo.description', { date: localDateNow(undefined, new Date(demo.referenceTime)) })} /></div>}<Outlet /></main>
            </div>
            <BackendConfigModal hideTrigger isOpen={settingsOpen} onOpenChange={setSettingsOpen} />
            <AboutModal hideTrigger isOpen={aboutOpen} onOpenChange={setAboutOpen} />
            <ShareActivityModal />
          </div>
        </div>
        <AchievementOverlays />
        </AchievementProvider>
      </ShareSnapshotProvider>
    </AppToastProvider>
  );
}
