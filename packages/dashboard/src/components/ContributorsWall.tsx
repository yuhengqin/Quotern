import { cn } from '@/lib/utils';
import { useTranslation } from 'quotern-i18n/react';

/** Same source as README Contributing section (`contrib.rocks`). */
const DEFAULT_REPO = 'yuhengqin/Quotern';

export function ContributorsWall({
  className,
  repo = DEFAULT_REPO,
  max = 500,
  columns = 20,
}: {
  className?: string;
  repo?: string;
  max?: number;
  columns?: number;
}) {
  const { t } = useTranslation();
  const imageSrc = `https://contrib.rocks/image?repo=${encodeURIComponent(repo)}&max=${max}&columns=${columns}`;
  const contributorsPage = `https://github.com/${repo}/graphs/contributors`;

  return (
    <a
      aria-label={t('about.contributors.aria')}
      className={cn(
        'group block overflow-hidden rounded-2xl border border-border',
        'bg-surface-secondary/80 shadow-[0_1px_2px_rgb(0_0_0/0.06)]',
        'outline-offset-2 transition-[background-color,box-shadow,border-color] duration-200',
        'hover:border-border hover:bg-surface-secondary hover:shadow-[0_8px_24px_-12px_rgb(15_23_42/0.28)]',
        'focus-visible:outline-2 focus-visible:outline-accent',
        'dark:bg-overlay/60 dark:hover:bg-overlay/80 dark:hover:shadow-[0_8px_24px_-12px_rgb(0_0_0/0.55)]',
        className,
      )}
      href={contributorsPage}
      rel="noopener noreferrer"
      target="_blank"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border/70 px-5 py-3.5">
        <div className="min-w-0">
          <p className="text-base font-medium tracking-tight text-foreground">
            {t('about.contributors.title')}
            <span aria-hidden="true" className="ml-1">
              🎉
            </span>
          </p>
          <p className="mt-0.5 text-sm leading-6 text-muted">
            {t('about.contributors.subtitle')}
          </p>
        </div>
        <span
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground/70"
        >
          →
        </span>
      </div>
      <div className="bg-surface/40 px-4 py-3.5 dark:bg-black/10">
        <img
          alt={t('about.contributors.imageAlt')}
          className="h-auto w-full scale-[1.01] transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          decoding="async"
          loading="lazy"
          src={imageSrc}
        />
      </div>
    </a>
  );
}
