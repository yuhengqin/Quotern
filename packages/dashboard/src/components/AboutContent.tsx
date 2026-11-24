import { Link } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { SupportedToolsGrid } from '@/components/SupportedToolsGrid';
import { APP_DISPLAY_NAME, appVersion } from '@/lib/about';
import { GITHUB_REPO_URL } from '@/lib/downloads';

const FEEDBACK_URL = 'https://github.com/yuhengqin/Quotern/issues/new';

/** About body — version, repository, feedback, and supported tools. */
export function AboutContent() {
  const { t } = useTranslation();
  const version = appVersion();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <p className="text-sm text-foreground/70">
          {APP_DISPLAY_NAME}{' '}
          <span className="font-mono text-foreground/90">v{version}</span>
        </p>
        <Link
          className="w-fit text-sm text-accent"
          href={GITHUB_REPO_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t('shell.githubRepository')}
          <Link.Icon />
        </Link>
        <Link
          className="w-fit text-sm text-accent"
          href={FEEDBACK_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t('about.submitFeedback')}
          <Link.Icon />
        </Link>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">{t('about.supportedAgents')}</h3>
        <SupportedToolsGrid />
      </section>
    </div>
  );
}
