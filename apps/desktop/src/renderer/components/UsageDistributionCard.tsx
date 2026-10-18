import { memo, useMemo, useRef, useState } from 'react';
import { Button, Card, Modal, Tooltip } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import type { SupportedLocale } from 'quotern-i18n';
import { UNSAFE_PortalProvider } from 'react-aria/PortalProvider';
import { Cell, Pie, PieChart } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  CHART_TOOLTIP_SURFACE_CLASSNAME,
  type ChartConfig,
} from '@/components/ChartPrimitives';
import { DashboardMetricTabs } from '@/components/DashboardMetricTabs';
import type {
  DashboardDistributionMetric,
  DashboardDistributionRow,
} from '@/lib/dashboard-mock-data';
import {
  formatDashboardMetric,
  formatDashboardMetricCompact,
} from '@/lib/dashboard-metric-format';
import { cn } from '@/lib/utils';

const METRICS = ['tokens', 'cost'] as const;

export const UsageDistributionCard = memo(function UsageDistributionCard({
  title,
  description,
  rows,
  className,
}: {
  title: string;
  description: string;
  rows: DashboardDistributionRow[];
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  const [metric, setMetric] =
    useState<DashboardDistributionMetric>('tokens');
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [isAllOpen, setIsAllOpen] = useState(false);
  const tooltipContainerRef = useRef<HTMLDivElement>(null);

  const { chartConfig, chartRows } = useMemo(
    () => buildDistributionView(rows, metric),
    [metric, rows],
  );

  const visibleRows = useMemo(
    () => chartRows.filter((row) => !hiddenIds.has(row.id)),
    [chartRows, hiddenIds],
  );
  const visibleTotal = useMemo(
    () => visibleRows.reduce((sum, row) => sum + row.value, 0),
    [visibleRows],
  );

  const toggleRow = (id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card
      className={cn(
        'h-full min-w-0 overflow-hidden rounded-2xl',
        className,
      )}
    >
      <Card.Header className="flex-row flex-nowrap items-start justify-between gap-2 pb-0">
        <div className="min-w-0">
          <Card.Title>{title}</Card.Title>
          <Card.Description className="mt-1">
            {description}
          </Card.Description>
        </div>
        <DashboardMetricTabs
          ariaLabel={t('usage.distribution.metricAria', { title })}
          metrics={METRICS}
          selectedMetric={metric}
          onMetricChange={setMetric}
        />
      </Card.Header>

      <Card.Content className="flex flex-col sm:flex-row sm:items-center">
        {rows.length === 0 ? (
          <p className="w-full py-12 text-center text-sm text-muted">
            {t('usage.common.noData')}
          </p>
        ) : (
          <>
            <div className="relative mx-auto h-44 w-44 shrink-0 sm:mx-0">
              <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center text-center">
                <span className="text-[11px] text-muted">
                  {metric === 'tokens' ? 'Tokens' : t('usage.common.cost')}
                </span>
                <strong className="text-lg font-semibold tracking-tight tabular-nums">
                  {formatDashboardMetricCompact(metric, visibleTotal)}
                </strong>
              </div>

              <ChartContainer
                config={chartConfig}
                className="relative z-10 h-44 w-44"
                initialDimension={{ width: 176, height: 176 }}
              >
                <PieChart accessibilityLayer>
                  <ChartTooltip
                    allowEscapeViewBox={{ x: true, y: true }}
                    content={
                      <ChartTooltipContent
                        hideLabel
                        formatter={(value, _name, item) => (
                          <div className="flex min-w-36 items-center justify-between gap-4">
                            <span className="flex min-w-0 items-center gap-1.5 text-muted">
                              <span
                                aria-hidden="true"
                                className="size-2 shrink-0 rounded-full"
                                style={{
                                  backgroundColor:
                                    (item.payload as { fill?: string })?.fill ??
                                    item.color,
                                }}
                              />
                              {String(
                                (item.payload as { label?: string })?.label ??
                                  '',
                              )}
                            </span>
                            <span className="font-semibold tabular-nums">
                              {formatDashboardMetric(
                                metric,
                                Number(value),
                                locale,
                              )}
                            </span>
                          </div>
                        )}
                      />
                    }
                    wrapperStyle={{ zIndex: 20, outline: 'none' }}
                  />
                  <Pie
                    data={visibleRows}
                    dataKey="value"
                    innerRadius={57}
                    isAnimationActive={false}
                    nameKey="label"
                    outerRadius={80}
                    paddingAngle={1}
                    strokeWidth={0}
                  >
                    {visibleRows.map((row) => (
                      <Cell fill={row.color} key={row.id} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            </div>

            <div className="min-w-0 flex-1">
              <DistributionRowList
                metric={metric}
                rows={chartRows.slice(0, 5)}
                hiddenIds={hiddenIds}
                visibleTotal={visibleTotal}
                onToggle={toggleRow}
              />
              {chartRows.length > 5 ? (
                <Button
                  className="mt-2 w-full"
                  size="sm"
                  variant="ghost"
                  onPress={() => setIsAllOpen(true)}
                >
                  {t('usage.common.viewAllCount', { count: chartRows.length })}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </Card.Content>

      <Modal isOpen={isAllOpen} onOpenChange={setIsAllOpen}>
        <Modal.Backdrop>
          <Modal.Container size="md">
            {/* Keep tooltips inside the active modal, outside its clipped dialog. */}
            <div className="contents" ref={tooltipContainerRef}>
              <Modal.Dialog>
                <Modal.CloseTrigger aria-label={t('usage.common.close')} />
                <Modal.Header>
                  <Modal.Heading>{title}</Modal.Heading>
                </Modal.Header>
                <Modal.Body>
                  <UNSAFE_PortalProvider getContainer={() => tooltipContainerRef.current}>
                    <div className="max-h-[60vh] overflow-y-auto">
                      <DistributionRowList
                        showDetails
                        metric={metric}
                        rows={chartRows}
                        hiddenIds={hiddenIds}
                        visibleTotal={visibleTotal}
                        onToggle={toggleRow}
                      />
                    </div>
                  </UNSAFE_PortalProvider>
                </Modal.Body>
              </Modal.Dialog>
            </div>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </Card>
  );
});

function DistributionRowList({
  showDetails = false,
  metric,
  rows,
  hiddenIds,
  visibleTotal,
  onToggle,
}: {
  showDetails?: boolean;
  metric: DashboardDistributionMetric;
  rows: Array<DashboardDistributionRow & { value: number }>;
  hiddenIds: Set<string>;
  visibleTotal: number;
  onToggle: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  return (
    <div className="space-y-1">
      {rows.map((row) => {
        const hidden = hiddenIds.has(row.id);
        const percentage =
          visibleTotal > 0 && !hidden
            ? (row.value / visibleTotal) * 100
            : 0;

        return (
          <Tooltip
            closeDelay={120}
            delay={250}
            isDisabled={!showDetails}
            key={row.id}
          >
            <Tooltip.Trigger<'button'>
              render={(props) => <button {...props} />}
              aria-label={t(hidden ? 'usage.distribution.show' : 'usage.distribution.hide', { label: row.label })}
              aria-pressed={!hidden}
              className={cn(
                'grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-md px-1 py-1.5 text-left text-xs transition-opacity',
                hidden
                  ? 'opacity-40 text-muted'
                  : 'text-foreground hover:bg-surface-secondary',
              )}
              title={showDetails ? undefined : t(hidden ? 'usage.distribution.show' : 'usage.distribution.hide', { label: row.label })}
              type="button"
              onClick={() => onToggle(row.id)}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: hidden ? 'var(--muted)' : row.color }}
                />
                <span className={cn('truncate', hidden && 'line-through')}>
                  {row.label}
                </span>
              </div>
              <span className="text-right font-medium tabular-nums">
                {formatDashboardMetric(metric, row.value, locale)}
              </span>
              <span className="w-11 text-right text-muted tabular-nums">
                {hidden ? '—' : `${percentage.toFixed(1)}%`}
              </span>
            </Tooltip.Trigger>
            {showDetails ? (
              <Tooltip.Content
                className={cn(
                  'pointer-events-auto z-[100] w-64 max-w-[calc(100vw-24px)] p-3 text-xs',
                  CHART_TOOLTIP_SURFACE_CLASSNAME,
                )}
                containerPadding={12}
                offset={8}
                placement="top"
              >
                <DistributionRowDetails row={row} />
              </Tooltip.Content>
            ) : null}
          </Tooltip>
        );
      })}
    </div>
  );
}

function DistributionRowDetails({ row }: { row: DashboardDistributionRow }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'zh-CN') as SupportedLocale;
  const metrics = row.localMetrics;
  const details = [
    [t('usage.distribution.uncachedInput'), metrics?.uncachedInputTokens],
    [t('usage.distribution.cacheRead'), metrics?.cacheReadTokens],
    ...((metrics?.cacheWriteTokens ?? 0) > 0
      ? [[t('usage.distribution.cacheWrite'), metrics?.cacheWriteTokens] as const]
      : []),
    [t('usage.common.output'), metrics?.outputTokens],
    [t('usage.distribution.reasoning'), metrics?.reasoningOutputTokens],
  ] as const;

  return (
    <div className="space-y-2.5">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-1 size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: row.color }}
        />
        <span className="min-w-0 break-all font-semibold">{row.label}</span>
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-muted tabular-nums">
        <span>{formatDashboardMetric('tokens', row.tokens, locale)} Token</span>
        <span>·</span>
        <span>{t('usage.distribution.estimatedCost', { amount: formatDashboardMetric('cost', row.costUsd, locale) })}</span>
      </div>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5 border-t border-border/60 pt-2.5">
        {details.map(([label, value]) => (
          <div className="contents" key={label}>
            <dt className="text-muted">{label}</dt>
            <dd className="text-right font-medium tabular-nums">
              {value == null ? '—' : formatDashboardMetric('tokens', value, locale)}
            </dd>
          </div>
        ))}
      </dl>
      {details.some(([, value]) => value == null) ? (
        <p className="text-[10px] text-muted">{t('usage.distribution.missingDetail')}</p>
      ) : null}
    </div>
  );
}

function buildDistributionView(
  rows: DashboardDistributionRow[],
  metric: DashboardDistributionMetric,
) {
  const chartRows = rows.map((row) => ({
    ...row,
    value: metric === 'tokens' ? row.tokens : row.costUsd,
  }));
  const chartConfig = Object.fromEntries(
    chartRows.map((row) => [
      row.id,
      {
        label: row.label,
        color: row.color,
      },
    ]),
  ) satisfies ChartConfig;

  return {
    chartConfig,
    chartRows,
  };
}
