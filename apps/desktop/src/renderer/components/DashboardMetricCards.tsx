import { CircleQuestion } from '@gravity-ui/icons';
import { Button, Card, Chip, Tooltip } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { formatTokens, formatTokensExact, formatUsd } from '@/lib/format';
import { formatCompactTokenCount, getTokenUnitMode, usesEastAsianTokenUnits } from '@/lib/utils';
import type {
  DashboardMetricChanges,
  DashboardUsageSummary,
} from '@/lib/dashboard-mock-data';

/** Responsive demo metrics for the dashboard's primary usage summary. */
export function DashboardMetricCards({
  changes,
  summary,
}: {
  changes: DashboardMetricChanges;
  summary: DashboardUsageSummary;
}) {
  const { t } = useTranslation();
  const metrics = [
    {
      label: t('usage.common.estimatedCost'),
      value: summary.totalCostUsd,
      changePct: changes.totalCostUsd,
      format: formatUsd,
      exactFormat: formatUsd,
      showTokenHelp: false,
    },
    {
      label: t('usage.common.totalTokens'),
      value: summary.totalTokens,
      changePct: changes.totalTokens,
      format: formatTokens,
      exactFormat: formatTokensExact,
      showTokenHelp: true,
    },
    {
      label: t('usage.common.inputTokens'),
      value: summary.inputTokens,
      changePct: changes.inputTokens,
      format: formatTokens,
      exactFormat: formatTokensExact,
      showTokenHelp: true,
    },
    {
      label: t('usage.common.outputTokens'),
      value: summary.outputTokens,
      changePct: changes.outputTokens,
      format: formatTokens,
      exactFormat: formatTokensExact,
      showTokenHelp: true,
    },
  ] as const;

  return (
    <section
      aria-label={t('usage.page.overview')}
      className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      {metrics.map((metric) => (
        <Card
          key={metric.label}
          className="min-h-28 min-w-0 rounded-2xl p-4"
        >
          <Card.Content className="flex h-full flex-col justify-between gap-4 p-0">
            <div className="flex items-center gap-1">
              <p className="text-sm font-medium text-muted">
                {metric.label}
              </p>
              {metric.showTokenHelp && <TokenFormatHelp />}
            </div>
            <AnimatedMetricValue
              changePct={metric.changePct}
              exactFormat={metric.exactFormat}
              format={metric.format}
              label={metric.label}
              value={metric.value}
            />
          </Card.Content>
        </Card>
      ))}
    </section>
  );
}

function TokenFormatHelp() {
  const { t } = useTranslation();
  const eastAsian = getTokenUnitMode() === 'localized' && usesEastAsianTokenUnits();
  return (
    <Tooltip closeDelay={80} delay={100}>
      <Button
        aria-label={t('usage.metric.formatHelpAria')}
        className="h-5 min-h-5 w-5 min-w-5 rounded-full p-0 text-muted"
        isIconOnly
        size="sm"
        variant="ghost"
      >
        <CircleQuestion className="h-3.5 w-3.5" />
      </Button>
      <Tooltip.Content
        className="max-w-64 p-3"
        placement="top"
        showArrow
      >
        <p className="text-xs font-semibold text-foreground">
          {t('usage.metric.formatHelp')}
        </p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {eastAsian ? (
            <>
              <dt className="font-medium tabular-nums">{formatCompactTokenCount(10_000, 'localized')}</dt>
              <dd>{t('usage.metric.equalTokens', { count: '10,000' })}</dd>
              <dt className="font-medium tabular-nums">{formatCompactTokenCount(100_000_000, 'localized')}</dt>
              <dd>{t('usage.metric.equalTokens', { count: '100,000,000' })}</dd>
              <dt className="font-medium tabular-nums">{formatCompactTokenCount(1_000_000_000_000, 'localized')}</dt>
              <dd>{t('usage.metric.equalTokens', { count: '1,000,000,000,000' })}</dd>
            </>
          ) : (
            <>
              <dt className="font-medium tabular-nums">1K</dt>
              <dd>{t('usage.metric.equalTokens', { count: '1,000' })}</dd>
              <dt className="font-medium tabular-nums">1M</dt>
              <dd>{t('usage.metric.equalTokens', { count: '1,000,000' })}</dd>
              <dt className="font-medium tabular-nums">1B</dt>
              <dd>{t('usage.metric.equalTokens', { count: '1,000,000,000' })}</dd>
              <dt className="font-medium tabular-nums">1T</dt>
              <dd>{t('usage.metric.equalTokens', { count: '1,000,000,000,000' })}</dd>
            </>
          )}
        </dl>
        <p className="mt-2 text-[11px] text-muted">
          {eastAsian
            ? t('usage.metric.localizedPrecision')
            : t('usage.metric.internationalPrecision')}
        </p>
      </Tooltip.Content>
    </Tooltip>
  );
}

function AnimatedMetricValue({
  changePct,
  exactFormat,
  format,
  label,
  value,
}: {
  changePct: number;
  exactFormat: (value: number) => string;
  format: (value: number) => string;
  label: string;
  value: number;
}) {
  const animatedValue = useAnimatedNumber(value);
  const formattedValue = format(animatedValue);

  return (
    <div className="flex min-w-0 items-end justify-between gap-3">
      <p
        aria-label={`${label} ${exactFormat(value)}`}
        className="min-w-0 whitespace-nowrap text-2xl font-semibold tracking-tight text-foreground tabular-nums 2xl:text-3xl"
        title={exactFormat(value)}
      >
        {formattedValue}
      </p>
      <MetricTrend changePct={changePct} />
    </div>
  );
}

function MetricTrend({ changePct }: { changePct: number }) {
  const { t } = useTranslation();
  const isIncrease = changePct >= 0;

  return (
    <Chip
      aria-label={t(isIncrease ? 'usage.overview.increaseAria' : 'usage.overview.decreaseAria', { value: `${Math.abs(changePct).toFixed(2)}%` })}
      className="shrink-0"
      color={isIncrease ? 'success' : 'danger'}
      size="sm"
      variant="soft"
    >
      <span aria-hidden="true">{isIncrease ? '↑' : '↓'}</span>
      <Chip.Label className="tabular-nums">
        {Math.abs(changePct).toFixed(2)}%
      </Chip.Label>
    </Chip>
  );
}
