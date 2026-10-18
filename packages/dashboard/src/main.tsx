import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from './hooks/useTheme';
import { BrowserLocaleProvider, browserInitialLocale } from './hooks/useLocalePreference';
import { setActiveLocale } from 'quotern-i18n';
import { registerDashboardMessages } from './i18n/register';
import { router } from './router';
import './index.css';

registerDashboardMessages();
void setActiveLocale(browserInitialLocale()).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserLocaleProvider>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </BrowserLocaleProvider>
    </StrictMode>,
  );
});
