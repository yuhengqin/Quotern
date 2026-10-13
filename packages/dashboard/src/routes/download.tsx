import { createFileRoute, redirect } from '@tanstack/react-router';
import { InstallGuidePage } from '@/components/InstallGuidePage';
import { useInstallGuideUi } from '@/hooks/InstallGuideUiContext';
import { isCliBackend } from '@/lib/api';

export const Route = createFileRoute('/download')({
  beforeLoad: () => {
    // Download / install guide is Server Web only.
    if (isCliBackend()) {
      throw redirect({ to: '/dashboard' });
    }
  },
  component: DownloadPage,
});

function DownloadPage() {
  const installGuideUi = useInstallGuideUi();
  const reason =
    installGuideUi?.reason === 'uninstalled' ? 'uninstalled' : 'new_user';

  return <InstallGuidePage reason={reason} />;
}
