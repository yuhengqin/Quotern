import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from './hooks/useTheme';
import { DesktopLocaleProvider, type DesktopLocaleState } from './hooks/useLocalePreference';
import { registerMessages, setActiveLocale } from 'quotern-i18n';
import { registerDashboardMessages } from '../../../../packages/dashboard/src/i18n/register';
import { desktopRendererMessages } from './i18n/desktop-renderer-messages';
import { desktopShellMessages } from './i18n/desktop-shell-messages';
import { desktopSubscriptionMessages } from './i18n/desktop-subscription-messages';
import { dispatchDataSynced } from './lib/shell-events';
import { router } from './router';
import { TrayPopoverView } from './components/TrayPopoverView';
import './index.css';

/** Bridge main-process Core sync → same CustomEvent pages already listen for. */
if (typeof window.tud?.onDataSynced === 'function') {
  window.tud.onDataSynced(() => {
    dispatchDataSynced();
  });
}

const isTrayPopover = new URLSearchParams(window.location.search).get('view') === 'tray-popover';

async function startRenderer() {
  registerDashboardMessages();
  registerMessages(desktopRendererMessages);
  registerMessages(desktopShellMessages);
  registerMessages(desktopSubscriptionMessages);
  const initialState: DesktopLocaleState = await window.tud.getLocalePreference()
    .catch(() => ({ preference: 'system', resolved: 'zh-CN' }));
  await setActiveLocale(initialState.resolved);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <DesktopLocaleProvider initialState={initialState}>
        <ThemeProvider>
          {isTrayPopover ? <TrayPopoverView /> : <RouterProvider router={router} />}
        </ThemeProvider>
      </DesktopLocaleProvider>
    </StrictMode>,
  );
}

void startRenderer();
