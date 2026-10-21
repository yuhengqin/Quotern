import { useEffect, useState, type CSSProperties } from 'react';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { ToastQueue } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
// Sidebar / FAB chrome temporarily hidden — actions moved to FilterChromeActions.
// import {
//   AppSidebar,
//   readSidebarCollapsed,
//   writeSidebarCollapsed,
// } from './AppSidebar';
import { AboutModal } from './AboutModal';
import { AppToastProvider as AppToastQueueProvider } from './AppToastContext';
import { AutoUpdateNotice } from './AutoUpdateNotice';
import {
  AppToastProvider,
  type AppToastContent,
} from './AppToastProvider';
import { BackendConfigModal } from './BackendConfigModal';
// import { MobileActionBubble } from './MobileActionBubble';
import { ShareActivityModal } from './ShareActivityModal';
import { WindowTitleControls } from './WindowTitleControls';
import {
  dispatchOpenSettings,
  getDefaultSettingsTab,
  type SettingsTabId,
} from '@/lib/shell-events';
import { ShareSnapshotProvider } from '../../../../../packages/dashboard/src/hooks/ShareSnapshotContext';
import { AchievementProvider } from '../../../../../packages/dashboard/src/achievements/AchievementProvider';
import { AchievementOverlays } from '../../../../../packages/dashboard/src/achievements/AchievementOverlays';
import { updateAchievements } from '@/lib/api';
import { TITLEBAR_HEIGHT } from '../../shared/window-chrome';
import { parseSessionPageSearch } from '../../../../../packages/dashboard/src/lib/session-page';

/**
 * Publish the shared title-bar height to CSS so `.desktop-window-drag-region`
 * and the native Window Controls Overlay (which the main process sizes from the
 * same constant) cannot drift apart.
 */
const TITLEBAR_STYLE = {
  '--desktop-titlebar-height': `${TITLEBAR_HEIGHT}px`,
} as CSSProperties;

/** Root shell: filter chrome actions + nested route outlet. */
export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  // const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>(getDefaultSettingsTab);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);
  const [toastQueue] = useState(
    () => new ToastQueue<AppToastContent>({ maxVisibleToasts: 2 }),
  );

  // useEffect(() => {
  //   setSidebarCollapsed(readSidebarCollapsed());
  // }, []);

  useEffect(() => {
    if (pathname !== '/settings') return;
    setSettingsOpen(true);
    void navigate({ to: '/dashboard', replace: true });
  }, [pathname, navigate]);

  useEffect(() => {
    const updateScrolledState = () => setHasScrolled(window.scrollY > 4);
    updateScrolledState();
    window.addEventListener('scroll', updateScrolledState, { passive: true });
    return () => window.removeEventListener('scroll', updateScrolledState);
  }, []);

  useEffect(() => {
    if (typeof window.tud?.onOpenSettings !== 'function') return;
    return window.tud.onOpenSettings((detail) => {
      if (detail?.tab) setSettingsTab(detail.tab);
      dispatchOpenSettings(detail);
      setSettingsOpen(true);
    });
  }, []);

  useEffect(() => {
    const api = window.tud?.dshPet;
    if (typeof api?.getNavigation !== 'function') return;
    let disposed = false, running = false, again = false;
    const consume = () => {
      again = true;
      if (running) return;
      running = true;
      void (async () => {
        while (again && !disposed) {
          again = false;
          const target = await api.getNavigation();
          if (!target || disposed) continue;
          setSettingsOpen(false); setAboutOpen(false);
          await navigate({ to: '/sessions', search: parseSessionPageSearch({ sessionSource: target.source, sessionId: target.sessionId, sessionFocus: target.navigationId }), resetScroll: false });
          if (!disposed) await api.acknowledgeNavigation(target.navigationId);
        }
      })().catch(() => {}).finally(() => { running = false; });
    };
    const unsubscribe = api.onNavigation(consume);
    consume();
    return () => { disposed = true; unsubscribe(); };
  }, [navigate]);

  useEffect(() => {
    if (typeof window.tud?.onRuntimeNotice !== 'function') return;
    return window.tud.onRuntimeNotice((detail) => {
      if (detail.kind !== 'config-reset') return;
      toastQueue.add({
        title: t('desktop.shell.configReset'),
        variant: 'warning',
      });
    });
  }, [toastQueue, t]);

  // const toggleSidebarCollapsed = () => {
  //   setSidebarCollapsed((prev) => {
  //     const next = !prev;
  //     writeSidebarCollapsed(next);
  //     return next;
  //   });
  // };

  return (
    <AppToastQueueProvider queue={toastQueue}>
      <ShareSnapshotProvider>
        <AchievementProvider request={updateAchievements}>
        <div
          className="flex min-h-svh flex-col bg-background text-foreground"
          style={TITLEBAR_STYLE}
        >
        <AppToastProvider queue={toastQueue} />
        <AutoUpdateNotice toastQueue={toastQueue} />
      {/* Fixed title chrome: transparent until scrolled, then frosted; always draggable. */}
      <div
        className={`desktop-window-drag-region fixed inset-x-0 top-0 z-50 flex items-stretch transition-[background-color,backdrop-filter] duration-200 ${
          hasScrolled
            ? 'bg-white/35 backdrop-blur-xl dark:bg-black/30'
            : 'bg-transparent'
        }`}
      >
        <div className="min-w-0 flex-1" />
        <WindowTitleControls />
      </div>
      {/* Reserve layout space matching the fixed title strip. */}
      <div className="shrink-0" style={{ height: TITLEBAR_HEIGHT }} aria-hidden="true" />
      <div className="relative flex-1">
        {/* <aside
          className="fixed top-1/2 z-30 hidden -translate-x-full -translate-y-1/2 min-[1488px]:block"
          style={{
            left: `max(0.75rem, calc(50% - ${CONTENT_HALF_PX}px - ${SIDEBAR_CONTENT_GAP}))`,
          }}
        >
          <AppSidebar
            collapsed={sidebarCollapsed}
            onToggleCollapsed={toggleSidebarCollapsed}
          />
        </aside> */}

        <div className="relative mx-auto w-full max-w-300 px-8 py-5 pb-12 sm:px-4 sm:py-6 min-[1040px]:pb-10 2xl:max-w-360">
          <main className="min-w-0 w-full">
            <Outlet />
          </main>
        </div>

        {/* <MobileActionBubble /> */}

        <BackendConfigModal
          hideTrigger
          isOpen={settingsOpen}
          onOpenChange={setSettingsOpen}
          activeTab={settingsTab}
          onTabChange={setSettingsTab}
        />
        <AboutModal hideTrigger isOpen={aboutOpen} onOpenChange={setAboutOpen} />
        <ShareActivityModal />
      </div>
        </div>
        <AchievementOverlays />
        </AchievementProvider>
      </ShareSnapshotProvider>
    </AppToastQueueProvider>
  );
}
