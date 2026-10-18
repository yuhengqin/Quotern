import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { formatDistanceToNow } from 'date-fns';
import { enUS, ja, ko, zhCN } from 'date-fns/locale';
import { normalizeLocale, translate, type SupportedLocale } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';
import {
  Button,
  Card,
  ProgressBar,
  Skeleton,
  Tabs,
} from '@heroui/react';
import {
  DASHBOARD_RANGE_DAYS,
  ToolChannelSelect,
  type DashboardRange,
} from './DashboardFilter';
import { DashboardRangeSyncOverlay } from './DashboardRangeSyncOverlay';
import { DailyUsageTrendCard } from './DailyUsageTrendCard';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useRollingDayRange } from '@/hooks/useRollingDayRange';
import { fetchSyncStatus } from '@/lib/api';
import { formatTokens, formatTokensExact, formatUsd } from '@/lib/format';
import { scheduleAfterPaint } from '@/lib/schedule-after-paint';
import { DATA_SYNCED_EVENT } from '@/lib/shell-events';
import { localDateNow } from '@/lib/stats-timezone';
import { sourceColor, sourceLabel } from '@/lib/tokens';
import {
  buildVisibleMetricTrends,
  filterTrendRowsBySources,
  summarizeTrendRows,
} from '@/lib/usage-filter';
import { Check } from '@gravity-ui/icons';
import { ThemeToggle } from './ThemeToggle';
import { SubscriptionUsageGrid } from './SubscriptionUsageGrid';
import { DEFAULT_DASHBOARD_RANGE } from '../../shared/dashboard-range';
import {
  TRAY_PANEL_WIDTH,
  TRAY_PANEL_MIN_HEIGHT,
  TRAY_PANEL_MAX_HEIGHT,
  TRAY_PANEL_GUTTER,
} from '../../shared/tray-popover-layout';
import './TrayPopoverView.css';

const POPOVER_SHELL_STYLE = {
  '--tray-panel-width': `${TRAY_PANEL_WIDTH}px`,
  '--tray-panel-max-height': `${TRAY_PANEL_MAX_HEIGHT}px`,
  '--tray-panel-gutter': `${TRAY_PANEL_GUTTER}px`,
} as CSSProperties;

/** Tabs update immediately; data fetch waits until after paint. */
function useDeferredDashboardRange(range: DashboardRange): DashboardRange {
  const [dataRange, setDataRange] = useState(range);

  useEffect(() => {
    if (dataRange === range) return;
    return scheduleAfterPaint(() => {
      setDataRange(range);
    });
  }, [range, dataRange]);

  return dataRange;
}

/** Dedicated React surface loaded inside the native tray popover window. */
export function TrayPopoverView() {
  const { t, i18n } = useTranslation();
  const locale = normalizeLocale(i18n.resolvedLanguage);
  const [range, setRange] = useState<DashboardRange>(DEFAULT_DASHBOARD_RANGE);
  const dataRange = useDeferredDashboardRange(range);
  const rangeDays = DASHBOARD_RANGE_DAYS[dataRange];
  const rollingRange = useRollingDayRange(dataRange === 'last-24-hours');
  const { data, error, loading, refreshing, reload } = useDashboardData(rangeDays, null, rollingRange);
  const {
    distributions,
    rangeDailyUsage,
    todayHourlyUsage,
    toolModelUsage,
  } = data;
  const headerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const lastSentHeight = useRef(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [selectedTools, setSelectedTools] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void window.tud.getDashboardRange().then((savedRange) => {
      if (!cancelled) setRange(savedRange);
    });
    const unsubscribe = window.tud.onDashboardRange(setRange);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const reloadSyncStatus = useCallback(async () => {
    try {
      const status = await fetchSyncStatus();
      setLastSyncAt(status.lastSyncAt);
      setNow(Date.now());
    } catch {
      // Keep the last known timestamp. A transient IPC/API failure must not
      // make a previously synced tray look as though it has never synced.
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    void reloadSyncStatus();
    let timer = 0;
    const onSynced = () => {
      // Hidden tray popover: skip — the data hook's visibility handler
      // refreshes when the popover is shown again.
      if (document.visibilityState === 'hidden') return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void reload();
        void reloadSyncStatus();
      }, 250);
    };
    // The native popover stays mounted while hidden, so mount-only status
    // loading leaves this footer stale after an empty background sync.
    const onFocus = () => {
      void reloadSyncStatus();
    };
    window.addEventListener(DATA_SYNCED_EVENT, onSynced);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(DATA_SYNCED_EVENT, onSynced);
      window.removeEventListener('focus', onFocus);
    };
  }, [reload, reloadSyncStatus]);

  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      if (document.visibilityState !== 'hidden') {
        void reloadSyncStatus();
      }
    };
    const timer = window.setInterval(tick, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [reloadSyncStatus]);

  const availableTools = useMemo(
    () => toolModelUsage.filter((row) => row.tokens > 0),
    [toolModelUsage],
  );

  useEffect(() => {
    const availableSources = new Set(availableTools.map((tool) => tool.source));
    setSelectedTools((current) => {
      const next = current.filter((source) => availableSources.has(source));
      return next.length === current.length ? current : next;
    });
  }, [availableTools]);

  const visibleTrendRows = useMemo(
    () =>
      filterTrendRowsBySources({
        dailyRows: rangeDailyUsage,
        hourlyRows: todayHourlyUsage,
        hourlyApiRows: rollingRange ? data.rangeHourlyApiRows ?? [] : data.hourlyApiRows,
        rollingRange,
        hourlyDate: range === 'today' ? localDateNow() : undefined,
        heatmapDays: rollingRange ? data.rangeDailyApiRows ?? [] : data.heatmapDays,
        modelRows: data.modelRows,
        toolRows: toolModelUsage,
        selectedSources: selectedTools,
      }),
    [
      data.heatmapDays,
      data.hourlyApiRows,
      data.rangeHourlyApiRows,
      data.rangeDailyApiRows,
      rollingRange,
      data.modelRows,
      range,
      rangeDailyUsage,
      selectedTools,
      todayHourlyUsage,
      toolModelUsage,
    ],
  );
  const visibleSummary = useMemo(
    () =>
      summarizeTrendRows({
        dailyRows: visibleTrendRows.dailyRows,
        hourlyRows: visibleTrendRows.hourlyRows,
        hourly: rangeDays === 1,
      }),
    [rangeDays, visibleTrendRows],
  );
  const visibleMetricTrends = useMemo(
    () =>
      buildVisibleMetricTrends({
        currentDailyRows: visibleTrendRows.dailyRows,
        currentHourlyRows: visibleTrendRows.hourlyRows,
        heatmapDailyRows: data.heatmapDailyUsage,
        heatmapDays: data.heatmapDays,
        hourlyApiRows: data.hourlyApiRows,
        modelRows: data.modelRows,
        toolRows: toolModelUsage,
        selectedSources: selectedTools,
        rangeDays,
        hourly: rangeDays === 1,
        rollingRange,
        previousHourlyApiRows: data.previousHourlyApiRows,
        availableFromDate: data.availableFromDate,
        availableFromTime: data.availableFromTime,
      }),
    [
      data.heatmapDailyUsage,
      data.previousHourlyApiRows,
      data.availableFromDate,
      data.availableFromTime,
      rollingRange,
      data.heatmapDays,
      data.hourlyApiRows,
      data.modelRows,
      range,
      rangeDays,
      selectedTools,
      toolModelUsage,
      visibleTrendRows,
    ],
  );

  /** Keep the native tray window fitted to the rendered header and content. */
  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;

    const measure = () => {
      const header = headerRef.current?.offsetHeight ?? 0;
      const footer = footerRef.current?.offsetHeight ?? 0;
      const natural = header + contentEl.offsetHeight + footer;
      const clamped = Math.ceil(
        Math.min(Math.max(natural, TRAY_PANEL_MIN_HEIGHT), TRAY_PANEL_MAX_HEIGHT)
          + TRAY_PANEL_GUTTER * 2,
      );
      if (clamped === lastSentHeight.current) return;
      lastSentHeight.current = clamped;
      window.tud?.resizeTrayPopover?.(clamped);
    };

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(contentEl);
    if (headerRef.current) resizeObserver.observe(headerRef.current);
    if (footerRef.current) resizeObserver.observe(footerRef.current);
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [loading, error]);

  const comparisonLabel = range === 'today'
    ? t('desktop.tray.comparedYesterday')
    : t('desktop.tray.comparedPreviousDays', { count: rangeDays });
  const metrics = useMemo(
    () => [
      {
        label: t('usage.common.estimatedCost'),
        value: visibleSummary.totalCostUsd,
        trend: visibleMetricTrends.totalCostUsd,
        trendDisplay: 'percent' as const,
        format: formatUsd,
        exactFormat: formatUsd,
      },
      {
        label: t('usage.common.totalTokens'),
        value: visibleSummary.totalTokens,
        trend: visibleMetricTrends.totalTokens,
        trendDisplay: 'percent' as const,
        format: formatTokens,
        exactFormat: formatTokensExact,
      },
      {
        label: t('usage.common.inputTokens'),
        value: visibleSummary.inputTokens,
        trend: visibleMetricTrends.inputTokens,
        trendDisplay: 'tokens' as const,
        format: formatTokens,
        exactFormat: formatTokensExact,
      },
      {
        label: t('usage.common.outputTokens'),
        value: visibleSummary.outputTokens,
        trend: visibleMetricTrends.outputTokens,
        trendDisplay: 'tokens' as const,
        format: formatTokens,
        exactFormat: formatTokensExact,
      },
    ] as const,
    [t, visibleMetricTrends, visibleSummary],
  );

  const topTools = useMemo(
    () => availableTools
      .filter(
        (tool) =>
          selectedTools.length === 0 || selectedTools.includes(tool.source),
      )
      .slice(0, 3)
      .map((tool) => ({
        id: tool.source,
        label: sourceLabel(tool.source),
        color: sourceColor(tool.source),
        tokens: tool.tokens,
        costUsd: tool.costUsd,
      })),
    [availableTools, selectedTools],
  );

  const topModels = useMemo(
    () => {
      if (selectedTools.length === 0) return distributions.models.slice(0, 3);

      const selected = new Set(selectedTools);
      const models = new Map<
        string,
        { tokens: number; costUsd: number; bySource: Map<string, number> }
      >();
      for (const tool of availableTools) {
        if (!selected.has(tool.source)) continue;
        for (const model of tool.models) {
          const entry = models.get(model.model) ?? {
            tokens: 0,
            costUsd: 0,
            bySource: new Map<string, number>(),
          };
          entry.tokens += model.tokens;
          entry.costUsd += model.costUsd;
          entry.bySource.set(
            tool.source,
            (entry.bySource.get(tool.source) ?? 0) + model.tokens,
          );
          models.set(model.model, entry);
        }
      }

      return [...models.entries()]
        .map(([model, usage]) => {
          const dominantSource = [...usage.bySource.entries()].sort(
            (a, b) => b[1] - a[1],
          )[0]?.[0] ?? 'unknown';
          return {
            id: model,
            label: model,
            color: sourceColor(dominantSource),
            tokens: usage.tokens,
            costUsd: usage.costUsd,
          };
        })
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 3);
    },
    [availableTools, distributions.models, selectedTools],
  );

  const modelProgressTotal = useMemo(() => {
    if (selectedTools.length === 0) return visibleSummary.totalTokens;
    const selected = new Set(selectedTools);
    return availableTools.reduce(
      (total, tool) => total + (selected.has(tool.source) ? tool.tokens : 0),
      0,
    );
  }, [availableTools, selectedTools, visibleSummary.totalTokens]);

  return (
    <div className="tray-popover font-sans text-foreground" style={POPOVER_SHELL_STYLE}>
      <header
        ref={headerRef}
        className="tray-popover__header flex flex-col gap-2 px-4 py-2"
      >
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold text-foreground">{t('desktop.tray.overview')}</h1>
          <ThemeToggle />
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Tabs
            className="w-fit shrink-0 text-center"
            selectedKey={range}
            onSelectionChange={(key) => {
              const next = String(key) as DashboardRange;
              if (next === range) return;
              setRange(next);
              void window.tud.setDashboardRange(next);
            }}
          >
            <Tabs.ListContainer>
              <Tabs.List
                aria-label={t('usage.filter.timeRange')}
                className="w-fit *:h-6 *:w-fit *:px-3 *:text-sm *:font-normal *:transition-none! *:data-[selected=true]:text-accent-foreground"
              >
                <Tabs.Tab className="transition-none!" id="today">
                  <span className="text-xs font-normal">{t('usage.range.today')}</span>
                  <Tabs.Indicator className="bg-accent transition-none!" />
                </Tabs.Tab>
                <Tabs.Tab className="transition-none!" id="last-24-hours">
                  <span className="text-xs font-normal">1D</span>
                  <Tabs.Indicator className="bg-accent transition-none!" />
                </Tabs.Tab>
                <Tabs.Tab className="transition-none!" id="last-7-days">
                  <span className="text-xs font-normal">7D</span>
                  <Tabs.Indicator className="bg-accent transition-none!" />
                </Tabs.Tab>
                <Tabs.Tab className="transition-none!" id="last-30-days">
                  <span className="text-xs font-normal">30D</span>
                  <Tabs.Indicator className="bg-accent transition-none!" />
                </Tabs.Tab>
                <Tabs.Tab className="transition-none!" id="last-90-days">
                  <span className="text-xs font-normal">90D</span>
                  <Tabs.Indicator className="bg-accent transition-none!" />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>

          <div className="flex min-h-8 min-w-0 shrink-0 items-center">
            {availableTools.length > 0 ? (
              <ToolChannelSelect
                selectedTools={selectedTools}
                tools={availableTools}
                onChange={setSelectedTools}
              />
            ) : null}
          </div>
        </div>
      </header>

      <div className="tray-popover__body">
        <div ref={contentRef} className="px-4 pb-4">
          <SubscriptionUsageGrid className="mb-3 grid-cols-1 gap-2.5" />
          {loading ? (
            <div className="relative isolate min-h-40">
              <DashboardRangeSyncOverlay visible />
              <TrayLoadingSkeleton />
            </div>
          ) : error ? (
            <div className="flex min-h-40 items-center justify-center px-2 text-center text-xs text-muted">
              {t('desktop.tray.loadFailed')}
            </div>
          ) : (
            <div className="tray-popover__usage relative isolate grid min-h-40 gap-3">
              <DashboardRangeSyncOverlay visible={refreshing} />
              <section aria-label={t('desktop.tray.usageMetrics')} className="grid grid-cols-2 gap-2">
                {metrics.slice(0, 2).map((metric) => (
                  <Card
                    key={metric.label}
                    className="min-w-0 overflow-hidden rounded-xl px-3 py-2.5"
                  >
                    <Card.Content className="grid gap-1 p-0">
                      <div className="flex h-5 min-w-0 items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-xs font-medium leading-5 text-muted">
                          {metric.label}
                        </p>
                        <div className="flex h-5 shrink-0 items-center justify-end">
                          {metric.trend ? (
                            <MetricTrend
                              comparisonLabel={comparisonLabel}
                              display={metric.trendDisplay}
                              trend={metric.trend}
                            />
                          ) : null}
                        </div>
                      </div>
                      <AnimatedMetricValue
                        exactFormat={metric.exactFormat}
                        format={metric.format}
                        label={metric.label}
                        value={metric.value}
                      />
                    </Card.Content>
                  </Card>
                ))}
                <div className="col-span-full grid grid-cols-2 divide-x divide-separator rounded-xl bg-surface/60 py-2">
                  {metrics.slice(2).map((metric, index) => (
                    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 px-3" key={metric.label}>
                      <p className="text-xs text-muted">{t(index === 0 ? 'usage.common.input' : 'usage.common.output')}</p>
                      <AnimatedMetricValue
                        compact
                        exactFormat={metric.exactFormat}
                        format={metric.format}
                        label={metric.label}
                        value={metric.value}
                      />
                      {metric.trend && (
                        <span className="ml-auto">
                          <MetricTrend compact comparisonLabel={comparisonLabel} display={metric.trendDisplay} trend={metric.trend} />
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <DailyUsageTrendCard
                className="tray-popover__trend"
                compact
                hourly={rangeDays === 1}
                rangeLabel={rollingRange ? t('usage.range.last24Hours') : undefined}
                hourlyRows={visibleTrendRows.hourlyRows}
                rangeDays={rangeDays}
                rows={visibleTrendRows.dailyRows}
              />

              {topTools.length > 0 && (
                <DistributionMiniCard
                  rows={topTools}
                  title={t('desktop.tray.agentTop3')}
                  totalTokens={visibleSummary.totalTokens}
                />
              )}

              {topModels.length > 0 && (
                <DistributionMiniCard
                  rows={topModels}
                  title={t('desktop.tray.modelTop3')}
                  totalTokens={modelProgressTotal}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <footer
        ref={footerRef}
        className="tray-popover__footer flex items-center gap-1.5 px-4 py-2"
      >
        <span
          aria-hidden="true"
          className="flex size-4 shrink-0 items-center justify-center text-success"
        >
          <Check className="size-3" />
        </span>
        <span
          className="min-w-0 truncate text-xs text-muted"
          title={lastSyncAt && Number.isFinite(new Date(lastSyncAt).getTime())
            ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastSyncAt))
            : undefined}
        >
          {t('desktop.tray.lastSynced', { time: formatLastSyncTime(lastSyncAt, now, locale) })}
        </span>
        <Button
          type="button"
          className="ml-auto h-8 min-h-8 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs"
          size="sm"
          variant="secondary"
          onPress={() => window.tud?.showMainWindow?.()}
        >
          {t('desktop.tray.openMain')}
          <span aria-hidden="true">↗</span>
        </Button>
      </footer>
    </div>
  );
}

/** Preserve the tray's final content rhythm while the first dataset loads. */
function TrayLoadingSkeleton() {
  const { t } = useTranslation();
  return (
    <div aria-label={t('desktop.tray.loading')} className="grid gap-3" role="status">
      <section aria-hidden="true" className="grid grid-cols-2 gap-2">
        {Array.from({ length: 2 }, (_, index) => (
          <Card className="min-w-0 overflow-hidden rounded-xl px-3 py-2.5" key={index}>
            <Card.Content className="grid gap-1 p-0">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-3 w-14 rounded-md" />
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
              <Skeleton className="h-8 w-24 rounded-md" />
            </Card.Content>
          </Card>
        ))}
        <div className="col-span-full grid grid-cols-2 gap-3 rounded-xl bg-surface/60 px-3 py-2">
          {Array.from({ length: 2 }, (_, index) => <div className="flex items-center gap-2" key={index}>
            <Skeleton className="h-3 w-8 rounded-md" />
            <Skeleton className="h-5 w-16 rounded-md" />
          </div>)}
        </div>
      </section>

      <Card aria-hidden="true" className="overflow-hidden rounded-2xl p-3">
        <Card.Header className="flex-row items-center justify-between">
          <Skeleton className="h-4 w-20 rounded-md" />
          <Skeleton className="h-6 w-24 rounded-lg" />
        </Card.Header>
        <Card.Content>
          <Skeleton className="h-[6.5rem] w-full rounded-xl" />
        </Card.Content>
      </Card>

      {Array.from({ length: 2 }, (_, index) => (
        <Card aria-hidden="true" className="rounded-2xl" key={index}>
          <Card.Header className="pb-0">
            <Skeleton className="h-4 w-28 rounded-md" />
          </Card.Header>
          <Card.Content className="space-y-3 pt-4">
            {Array.from({ length: 3 }, (_, row) => (
              <div className="grid grid-cols-[1fr_5rem] items-center gap-3" key={row}>
                <Skeleton className="h-4 w-28 rounded-md" />
                <Skeleton className="h-4 w-16 justify-self-end rounded-md" />
              </div>
            ))}
          </Card.Content>
        </Card>
      ))}
    </div>
  );
}

function formatLastSyncTime(lastSyncAt: string | null, now: number, locale: SupportedLocale): string {
  if (!lastSyncAt) return translate(locale, 'desktop.tray.never');
  const date = new Date(lastSyncAt);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) return translate(locale, 'desktop.tray.unknown');

  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (elapsedSeconds < 60) return translate(locale, 'desktop.tray.justNow');

  if (elapsedSeconds < 7 * 24 * 60 * 60) {
    return formatDistanceToNow(date, { addSuffix: true, locale: { 'zh-CN': zhCN, en: enUS, ja, ko }[locale] });
  }

  return new Intl.DateTimeFormat(locale, {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}

function MetricTrend({
  compact = false,
  comparisonLabel,
  display,
  trend,
}: {
  compact?: boolean;
  comparisonLabel: string;
  display: 'percent' | 'tokens';
  trend: { changePct: number; changeValue: number };
}) {
  const { t } = useTranslation();
  const isIncrease = trend.changeValue > 0;
  const unchanged = trend.changeValue === 0;
  const direction = t(isIncrease ? 'desktop.tray.increased' : 'desktop.tray.decreased');
  const absoluteValue = display === 'tokens'
    ? formatTokens(Math.abs(trend.changeValue))
    : `${Math.abs(trend.changePct).toFixed(1)}%`;
  const label =
    display === 'tokens'
      ? `${isIncrease ? '+' : '−'}${formatTokens(Math.abs(trend.changeValue))}`
      : `${Math.abs(trend.changePct).toFixed(1)}%`;
  const description = unchanged
    ? t('desktop.tray.trendNoChange', { comparison: comparisonLabel })
    : t('desktop.tray.trendDescription', { comparison: comparisonLabel, direction, value: absoluteValue });

  return (
    <span
      aria-label={description}
      title={description}
      className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[11px] leading-5 tabular-nums text-muted ${compact ? '' : 'rounded-md bg-default/50 px-1.5'}`}
    >
      {!unchanged && <span aria-hidden="true">{isIncrease ? '↑' : '↓'}</span>}
      {unchanged ? t('desktop.tray.unchanged') : label}
    </span>
  );
}

function AnimatedMetricValue({
  compact = false,
  exactFormat,
  format,
  label,
  value,
}: {
  compact?: boolean;
  exactFormat: (value: number) => string;
  format: (value: number) => string;
  label: string;
  value: number;
}) {
  const animatedValue = useAnimatedNumber(value);

  return (
    <span
      aria-label={`${label} ${exactFormat(value)}`}
      className={`min-w-0 truncate font-semibold tracking-tight text-foreground tabular-nums ${compact ? 'text-sm leading-5' : 'text-[26px] leading-8'}`}
      title={exactFormat(value)}
    >
      {format(animatedValue)}
    </span>
  );
}

function DistributionMiniCard({
  title,
  rows,
  totalTokens,
}: {
  title: string;
  rows: Array<{ id: string; label: string; color: string; tokens: number; costUsd: number }>;
  totalTokens: number;
}) {
  const { t } = useTranslation();
  return (
    <Card className="min-w-0 rounded-xl p-3">
      <Card.Content className="grid gap-2.5 p-0">
        <p className="text-xs font-medium text-muted">{title}</p>
        {rows.map((row) => {
          const pct = totalTokens > 0 ? (row.tokens / totalTokens) * 100 : 0;
          return (
            <div
              className="grid grid-cols-[minmax(0,132px)_minmax(0,1fr)_auto] items-center gap-x-2"
              key={row.id}
            >
              <span className="truncate text-xs font-medium text-foreground">
                {row.label}
              </span>
              <ProgressBar
                aria-label={t('desktop.tray.sharePercent', { name: row.label, percent: pct.toFixed(1) })}
                className="w-full"
                maxValue={100}
                size="sm"
                value={pct}
              >
                <ProgressBar.Track className="h-2 rounded-full bg-surface-secondary">
                  <ProgressBar.Fill
                    className="rounded-full"
                    style={{ backgroundColor: row.color }}
                  />
                </ProgressBar.Track>
              </ProgressBar>
              <span className="text-right text-xs font-semibold tabular-nums text-foreground">
                {formatTokens(row.tokens)}
              </span>
            </div>
          );
        })}
      </Card.Content>
    </Card>
  );
}
