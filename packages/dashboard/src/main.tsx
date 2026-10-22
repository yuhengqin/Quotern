import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from './hooks/useTheme';
import { BrowserLocaleProvider, browserInitialLocale } from './hooks/useLocalePreference';
import { setActiveLocale } from 'quotern-i18n';
import { registerInitialDashboardMessages } from './i18n/register-initial';
import { router } from './router';
import './index.css';

registerInitialDashboardMessages();
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
