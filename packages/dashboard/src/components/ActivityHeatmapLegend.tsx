import type { ReactNode } from 'react';
import { useTranslation } from 'quotern-i18n/react';
import type { ActivityHeatmapData } from '../lib/activity-heatmap';
import { formatTokens } from '../lib/format';
import { HelpPopover } from './HelpPopover';

/** Shared by the HTTP and IPC calendars; thresholds come from each calendar's data. */
export function ActivityHeatmapLegend({
  colors,
  thresholds,
  footer,
}: {
  colors: readonly string[];
  thresholds: ActivityHeatmapData['thresholds'];
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const title = t('usage.heatmap.legendTitle');
  const boundaries = [0, thresholds.t1, thresholds.t2, thresholds.t3];

  return (
    <div data-heatmap-footer className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      {footer ? <div className="min-w-0 empty:hidden">{footer}</div> : null}
      <div data-heatmap-legend className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted">
        <div className="inline-flex items-center gap-1">
          <span>{title}</span>
          <HelpPopover title={t('usage.heatmap.legendHelpTitle')}>
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="size-3 shrink-0 rounded-[3px] border border-foreground/10" style={{ background: colors[0] }} />
              <span>{t('usage.heatmap.noRecordedUsage')}</span>
            </div>
            {thresholds.t3 > 0 ? (
              <dl className="space-y-2">
                {boundaries.map((min, index) => {
                  const max = boundaries[index + 1];
                  // Equal quantiles make some colors unreachable; don't invent a range.
                  if (max != null && max <= min) return null;
                  const level = index + 1;
                  const lower = formatTokens(min);
                  const upper = max == null ? null : formatTokens(max);
                  const range = max == null
                    ? t('usage.heatmap.rangeAbove', { min: lower })
                    : min === 0
                      ? t('usage.heatmap.rangeUpTo', { max: upper })
                      : lower === upper
                        ? t('usage.heatmap.rangeAround', { value: lower })
                        : t('usage.heatmap.rangeBetween', { min: lower, max: upper });
                  return (
                    <div key={level} data-heatmap-band className="flex items-start gap-3">
                      <dt className="flex h-5 shrink-0 items-center">
                        <span aria-hidden="true" className="size-3 shrink-0 rounded-[3px] border border-foreground/10" style={{ background: colors[level] }} />
                        <span className="sr-only">{t('usage.heatmap.level', { level })}</span>
                      </dt>
                      <dd className="min-w-0 font-mono tabular-nums">{range}</dd>
                    </div>
                  );
                })}
              </dl>
            ) : <p>{t('usage.heatmap.legendNoActivity')}</p>}
            {thresholds.t3 > 0 && <p className="text-muted">{t('usage.heatmap.legendRangeNote')}</p>}
            <details className="border-t border-separator pt-2 text-muted">
              <summary className="w-fit cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-accent">{t('usage.heatmap.legendMethod')}</summary>
              <div className="mt-2 space-y-2">
                <p>{t('usage.heatmap.legendDescription')}</p>
                <p>{t('usage.heatmap.legendZeroDescription')}</p>
                <p>{t('usage.heatmap.legendTimezone')}</p>
              </div>
            </details>
          </HelpPopover>
        </div>
        <div className="inline-flex items-center gap-1.5">
          <span>{t('usage.heatmap.low')}</span>
          <div aria-hidden="true" className="flex gap-1">
            {colors.map((color, level) => (
              <span key={level} className="size-3 shrink-0 rounded-[3px] border border-foreground/10" style={{ background: color }} />
            ))}
          </div>
          <span>{t('usage.heatmap.high')}</span>
        </div>
      </div>
    </div>
  );
}
