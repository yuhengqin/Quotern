import { Link } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { ProviderIcon } from '@/components/ProviderIcon';
import {
  APP_DISPLAY_NAME,
  SUPPORTED_TOOLS,
  appVersion,
  formatSupportedTool,
} from '@/lib/about';

const FEEDBACK_URL = 'https://github.com/yuhengqin/Quotern/issues/new';

/** Shared about body — version + supported tools. */
export function AboutContent() {
  const { t } = useTranslation();
  const version = appVersion();

  return (
    <div className="space-y-5">
      <section className="space-y-1.5">
        <h3 className="text-sm font-medium text-foreground">{t('about.versionTitle')}</h3>
        <p className="text-sm text-foreground/70">
          {APP_DISPLAY_NAME}{' '}
          <span className="font-mono text-foreground/90">v{version}</span>
        </p>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-sm font-medium text-foreground">{t('about.feedbackTitle')}</h3>
        <Link
          className="w-fit text-sm text-accent"
          href={FEEDBACK_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t('about.submitFeedback')}
          <Link.Icon />
        </Link>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">{t('about.supportedAgents')}</h3>
        <p className="text-xs text-foreground/55">
          {t('about.multiPlatformHint')}
        </p>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {SUPPORTED_TOOLS.map((tool) => (
            <li
              key={tool.source}
              className="flex items-center gap-2 rounded-lg bg-black/3 px-2.5 py-1.5 text-sm text-foreground/80 dark:bg-white/5"
            >
              <ProviderIcon provider={tool.source} size={16} />
              <span className="min-w-0 leading-snug">
                {formatSupportedTool(tool)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
