import type { ReactNode } from 'react';
import { useTranslation } from 'quotern-i18n/react';

export function ActivityHeatmapLegend({
  colors,
  footer,
}: {
  colors: readonly string[];
  footer?: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div data-heatmap-footer className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      {footer ? <div className="min-w-0 empty:hidden">{footer}</div> : null}
      <div data-heatmap-legend className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted">
        <span>{t('usage.heatmap.low')}</span>
        <div aria-hidden="true" className="flex gap-1">
          {colors.map((color, level) => (
            <span key={level} className="size-3 shrink-0 rounded-[3px] border border-foreground/10" style={{ background: color }} />
          ))}
        </div>
        <span>{t('usage.heatmap.high')}</span>
      </div>
    </div>
  );
}
