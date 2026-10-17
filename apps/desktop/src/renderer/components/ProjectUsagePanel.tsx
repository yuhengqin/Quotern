import { memo, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleQuestion, Folder } from '@gravity-ui/icons';
import { Button, Card, Modal, Switch, Tooltip } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { CHART_TOOLTIP_SURFACE_CLASSNAME } from '@/components/ChartPrimitives';
import { ProviderIcon } from '@/components/ProviderIcon';
import type { DashboardProjectUsageRow } from '@/lib/dashboard-mock-data';
import {
  buildProjectModelStackedChart,
  type ProjectModelChartSegment,
  type ProjectModelChartSeries,
  type ProjectModelStackedChartRow,
} from '@/lib/chart-data';
import { formatPct, formatTokens, formatUsd } from '@/lib/format';
import { sourceLabel } from '@/lib/tokens';
import { cn } from '@/lib/utils';

const PROJECT_ROW_HEIGHT = 56;
const MAX_VISIBLE_PROJECT_ROWS = 5;
function percentage(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1_000) / 10;
}

function isUnknownProject(row: Pick<DashboardProjectUsageRow, 'project' | 'label'>): boolean {
  return row.project === 'unknown' || row.label === '未知项目';
}

export const ProjectUsagePanel = memo(function ProjectUsagePanel({
  rows,
}: {
  rows: DashboardProjectUsageRow[];
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const [isAllOpen, setIsAllOpen] = useState(false);
  const [showUnknown, setShowUnknown] = useState(false);
  const hasUnknown = useMemo(() => rows.some(isUnknownProject), [rows]);

  const filteredRows = useMemo(
    () => (showUnknown ? rows : rows.filter((row) => !isUnknownProject(row))),
    [rows, showUnknown],
  );

  const viewTotalTokens = useMemo(
    () => filteredRows.reduce((sum, row) => sum + row.tokens, 0),
    [filteredRows],
  );

  const viewRows = useMemo(
    () =>
      filteredRows.map((row) => ({
        ...row,
        pct: percentage(row.tokens, viewTotalTokens),
      })),
    [filteredRows, viewTotalTokens],
  );

  const chart = useMemo(
    () => buildProjectModelStackedChart(viewRows),
    [viewRows],
  );
  const chartMaximum = Math.max(
    1,
    viewTotalTokens,
    ...chart.rows.map((row) => row.tokens),
  );
  const hasMoreRows = chart.rows.length > MAX_VISIBLE_PROJECT_ROWS;
  const visibleRows = hasMoreRows
    ? chart.rows.slice(0, MAX_VISIBLE_PROJECT_ROWS)
    : chart.rows;

  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl">
      <Card.Header className="flex-row flex-nowrap items-start justify-between gap-3 pb-0">
        <div className="min-w-0 flex-1">
          <Card.Title className="flex items-center gap-1.5" id={headingId}>
            <span>{t('usage.project.heading')}</span>
            <ProjectHelpTooltip />
          </Card.Title>
          <Card.Description className="mt-1">
            {t('usage.project.description')}
          </Card.Description>
        </div>
        {hasUnknown ? (
          <Switch
            className="shrink-0"
            isSelected={showUnknown}
            size="sm"
            onChange={setShowUnknown}
          >
            <Switch.Content className="gap-1.5 text-xs font-normal text-muted">
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              {t('usage.project.unknown')}
            </Switch.Content>
          </Switch>
        ) : null}
      </Card.Header>

      <Card.Content className="pt-2">
        {rows.length === 0 ? (
          <p className="flex min-h-52 items-center justify-center px-4 text-center text-sm text-muted">
            {t('usage.project.empty')}
          </p>
        ) : filteredRows.length === 0 || chart.rows.length === 0 ? (
          <p className="mt-4 flex min-h-40 items-center justify-center px-4 text-center text-sm text-muted">
            {hasUnknown && !showUnknown
              ? t('usage.project.onlyUnknown')
              : t('usage.project.filteredEmpty')}
          </p>
        ) : (
          <div aria-labelledby={headingId} className="min-w-0" role="region">
            <ProjectStackedList
              chartMaximum={chartMaximum}
              headingId={headingId}
              rows={visibleRows}
              series={chart.series}
            />
            {hasMoreRows ? (
              <Button
                className="mt-3 w-full"
                size="sm"
                variant="ghost"
                onPress={() => setIsAllOpen(true)}
              >
                {t('usage.common.viewAllCount', { count: chart.rows.length })}
              </Button>
            ) : null}
            <AccessibleProjectDetails rows={chart.rows} series={chart.series} />
          </div>
        )}
      </Card.Content>

      <Modal isOpen={isAllOpen} onOpenChange={setIsAllOpen}>
        <Modal.Backdrop>
          <Modal.Container size="lg">
            <Modal.Dialog>
              <Modal.CloseTrigger aria-label={t('usage.common.close')} />
              <Modal.Header>
                <Modal.Heading>{t('usage.project.heading')}</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <div className="max-h-[60vh] overflow-y-auto pr-1">
                  <ProjectStackedList
                    chartMaximum={chartMaximum}
                    headingId={`${headingId}-all`}
                    rows={chart.rows}
                    series={chart.series}
                  />
                </div>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </Card>
  );
});

function ProjectStackedList({
  chartMaximum,
  headingId,
  rows,
  series,
}: {
  chartMaximum: number;
  headingId: string;
  rows: ProjectModelStackedChartRow[];
  series: ProjectModelChartSeries[];
}) {
  return (
    <div
      aria-labelledby={headingId}
      className="grid w-full min-w-0 grid-cols-[minmax(0,7rem)_minmax(0,1fr)_50px] gap-x-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_50px] sm:gap-x-3"
      role="img"
    >
      <ProjectLabelColumn rows={rows} />
      <ProjectStackedBars
        chartMaximum={chartMaximum}
        rows={rows}
        series={series}
      />
      <ProjectValueColumn rows={rows} />
    </div>
  );
}

function ProjectHelpTooltip() {
  const { t } = useTranslation();
  return (
    <Tooltip closeDelay={80} delay={100}>
      <Button
        aria-label={t('usage.project.helpAria')}
        className="h-5 min-h-5 w-5 min-w-5 rounded-full p-0 text-muted"
        isIconOnly
        size="sm"
        variant="ghost"
      >
        <CircleQuestion className="h-3.5 w-3.5" />
      </Button>
      <Tooltip.Content className="max-w-64 p-3" placement="top" showArrow>
        <p className="text-xs leading-relaxed text-foreground">{t('usage.project.help')}</p>
      </Tooltip.Content>
    </Tooltip>
  );
}

function ProjectLabelColumn({
  rows,
}: {
  rows: ProjectModelStackedChartRow[];
}) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0">
      {rows.map((row) => (
        <div
          className="flex min-w-0 items-center gap-1.5 sm:gap-2"
          key={row.project}
          style={{ height: PROJECT_ROW_HEIGHT }}
        >
          <span
            aria-hidden="true"
            className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-tertiary text-muted sm:size-8 sm:rounded-lg"
          >
            <Folder className="size-3.5 sm:size-4" />
          </span>
          <span className="min-w-0">
            <Tooltip closeDelay={80} delay={200}>
              <button
                aria-label={isUnknownProject(row) ? t('usage.project.unknown') : row.label}
                className="block max-w-full truncate text-left text-xs font-normal text-foreground sm:text-sm"
                type="button"
              >
                {isUnknownProject(row) ? t('usage.project.unknown') : row.label}
              </button>
              <Tooltip.Content className="max-w-72 p-2" placement="top" showArrow>
                <p className="break-all text-xs text-foreground">{isUnknownProject(row) ? t('usage.project.unknown') : row.label}</p>
              </Tooltip.Content>
            </Tooltip>
            <span
              aria-hidden="true"
              className="mt-0.5 block truncate text-[9px] text-muted tabular-nums sm:text-[11px]"
            >
              {t('usage.common.modelCount', { count: row.modelCount })} · {formatUsd(row.costUsd)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

interface HoveredSegment {
  color: string;
  row: ProjectModelStackedChartRow;
  segment: ProjectModelChartSegment;
  x: number;
  y: number;
}

function ProjectStackedBars({
  chartMaximum,
  rows,
  series,
}: {
  chartMaximum: number;
  rows: ProjectModelStackedChartRow[];
  series: ProjectModelChartSeries[];
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<HoveredSegment | null>(null);

  return (
    <div className="relative min-w-0">
      {rows.map((row) => {
        const barWidthPct = Math.min(100, (row.tokens / chartMaximum) * 100);
        const activeSegments = series.flatMap((item) => {
          const segment = row.segments[item.key];
          if (!segment || segment.tokens <= 0) return [];
          return [{ item, segment }];
        });

        return (
          <div
            className="flex items-center"
            key={row.project}
            style={{ height: PROJECT_ROW_HEIGHT }}
          >
            <div className="relative h-7 w-full overflow-hidden rounded-[6px] bg-surface-tertiary">
              <div
                className="absolute inset-y-0 left-0 flex overflow-hidden"
                style={{
                  borderRadius:
                    barWidthPct >= 99.95 ? '6px' : '6px 0 0 6px',
                  width: `${barWidthPct}%`,
                }}
              >
                {activeSegments.map(({ item, segment }) => {
                  const modelWidthPct =
                    row.tokens > 0 ? (segment.tokens / row.tokens) * 100 : 0;

                  return (
                    <div
                      className="h-full cursor-default"
                      key={item.key}
                      onMouseEnter={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setHovered({
                          color: item.color,
                          row,
                          segment,
                          x: rect.left + rect.width / 2,
                          y: rect.top,
                        });
                      }}
                      onMouseLeave={() => setHovered(null)}
                      onMouseMove={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setHovered({
                          color: item.color,
                          row,
                          segment,
                          x: rect.left + rect.width / 2,
                          y: rect.top,
                        });
                      }}
                      style={{
                        backgroundColor: item.color,
                        flex: `0 0 ${modelWidthPct}%`,
                        opacity: item.isUnattributed ? 0.55 : 1,
                      }}
                      title={`${segment.source ? `${sourceLabel(segment.source)} · ` : ''}${segment.model} · ${formatTokens(segment.tokens)}`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}

      {hovered &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            aria-live="polite"
            className="pointer-events-none fixed z-9999"
            role="status"
            style={{ left: hovered.x, top: hovered.y }}
          >
            <div
              className={cn(
                'grid min-w-52 -translate-x-1/2 -translate-y-[calc(100%+8px)] gap-2 px-3 py-2.5 text-xs',
                CHART_TOOLTIP_SURFACE_CLASSNAME,
              )}
            >
              {hovered.segment.source ? (
                <div className="flex min-w-0 items-center gap-2">
                  <ProviderIcon provider={hovered.segment.source} size={15} />
                  <span className="truncate font-semibold">
                    {sourceLabel(hovered.segment.source)}
                  </span>
                </div>
              ) : null}
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: hovered.color }}
                />
                <span
                  className="truncate font-normal"
                  title={hovered.segment.model}
                >
                  {hovered.segment.model}
                </span>
              </div>
              <span className="text-muted tabular-nums">
                {formatTokens(hovered.segment.tokens)} ·{' '}
                {formatUsd(hovered.segment.costUsd)} ·{' '}
                {formatPct(hovered.segment.pct)}
              </span>
              <span className="text-[10px] text-muted">
                {t('usage.project.shareOfProject', { project: isUnknownProject(hovered.row) ? t('usage.project.unknown') : hovered.row.label })}
              </span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function ProjectValueColumn({
  rows,
}: {
  rows: ProjectModelStackedChartRow[];
}) {
  return (
    <div aria-hidden="true" className="min-w-0">
      {rows.map((row) => (
        <div
          className="flex min-w-0 flex-col items-end justify-center text-right"
          key={row.project}
          style={{ height: PROJECT_ROW_HEIGHT }}
        >
          <strong className="text-xs font-semibold text-foreground tabular-nums sm:text-sm">
            {formatPct(row.pct)}
          </strong>
          <span className="mt-0.5 max-w-full truncate text-[9px] text-muted tabular-nums sm:text-[11px]">
            {formatTokens(row.tokens)}
          </span>
        </div>
      ))}
    </div>
  );
}

function AccessibleProjectDetails({
  rows,
  series,
}: {
  rows: ProjectModelStackedChartRow[];
  series: ProjectModelChartSeries[];
}) {
  const { t } = useTranslation();
  return (
    <div className="sr-only">
      <h4>{t('usage.project.accessibleHeading')}</h4>
      <ol>
        {rows.map((row) => (
          <li key={row.project}>
            {t('usage.project.accessibleRow', {
              project: isUnknownProject(row) ? t('usage.project.unknown') : row.label,
              tokens: formatTokens(row.tokens), cost: formatUsd(row.costUsd),
              percent: formatPct(row.pct),
              models: t('usage.common.modelCount', { count: row.modelCount }),
            })}
            <ul>
              {series.map((item) => {
                const segment = row.segments[item.key];
                if (!segment) return null;

                return (
                  <li key={item.key}>
                    {t('usage.project.accessibleModelRow', {
                      model: segment.source
                        ? `${sourceLabel(segment.source)} · ${segment.model}`
                        : segment.model,
                      tokens: formatTokens(segment.tokens),
                      cost: formatUsd(segment.costUsd), percent: formatPct(segment.pct),
                    })}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
