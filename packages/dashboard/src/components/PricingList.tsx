import { useEffect, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { ChevronDown } from '@gravity-ui/icons';
import { Button, Checkbox, ListLayout, Table, TableLayout, Virtualizer, type SortDescriptor } from '@heroui/react';
import { GridList, GridListItem } from 'react-aria-components';
import { useTranslation } from 'quotern-i18n/react';
import { pricingRegionMessageKeys } from '../i18n/pricing-messages';
import { ModelProviderIcon } from './ModelProviderIcon';
import { CopyPricingId, PricingAliases, PricingChannelDetails, PricingEstimatedCost, PricingHighlight, PricingRate, type PriceDisplay } from './PricingDetails';
import type { PricingCatalogRow } from '../lib/pricing-data';
import { getPricingModelName, getPricingProvider, type PricingSortDescriptor, type PricingSortKey } from '../lib/pricing-catalog';
import { formatPricingContext, getPrimaryPricingVariant as primaryVariant, type PricingModelGroup, type PricingVariant } from '../lib/pricing-groups';
import type { PricingScenario } from '../lib/pricing-workbench';
import { formatPricingReleaseDate, formatPricingTokens } from '../lib/pricing-display';

type TableColumn = { id: PricingSortKey | 'estimate'; labelKey: string; minWidth: number; width: NonNullable<ComponentProps<typeof Table.Column>['defaultWidth']> };
type DisplayRow = { id: string; kind: 'model' | 'api' | 'subscription'; group: PricingModelGroup; variant: PricingVariant };
const WIDE_COLUMNS: TableColumn[] = [
  { id: 'model', labelKey: 'pricing.list.model', minWidth: 280, width: '1fr' },
  { id: 'input', labelKey: 'pricing.metric.input', minWidth: 88, width: 96 },
  { id: 'output', labelKey: 'pricing.metric.output', minWidth: 88, width: 96 },
  { id: 'cacheRead', labelKey: 'pricing.metric.cacheRead', minWidth: 88, width: 96 },
  { id: 'cacheWrite', labelKey: 'pricing.metric.cacheWrite', minWidth: 88, width: 96 },
  { id: 'contextWindow', labelKey: 'pricing.metric.context', minWidth: 80, width: 88 },
  { id: 'releaseDate', labelKey: 'pricing.metric.releaseDate', minWidth: 108, width: 116 },
];
const COMPACT_COLUMNS: TableColumn[] = [
  { id: 'model', labelKey: 'pricing.list.model', minWidth: 256, width: '1fr' },
  { id: 'inputOutput', labelKey: 'pricing.list.inputOutput', minWidth: 144, width: '25%' },
  { id: 'cache', labelKey: 'pricing.list.cache', minWidth: 144, width: '25%' },
];

function Regions({ regions }: { regions: string[] }) {
  const { t } = useTranslation();
  return regions.length > 0 && <span className="shrink-0 rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] text-muted">{regions.map(region => t(pricingRegionMessageKeys[region] ?? region)).join(' / ')}</span>;
}

function getComparisonRow(event: { target: EventTarget | null; currentTarget: HTMLElement }, includeSubrows = false): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element) || target.closest('button, a, input, label, select, textarea, [role="button"], [role="link"], [contenteditable="true"]')) return null;
  if (!includeSubrows && target.closest('[data-pricing-subrow]')) return null;
  const row = target.closest<HTMLElement>('[data-pricing-selectable]');
  return row && event.currentTarget.contains(row) ? row : null;
}

function ModelIdentity({ item, sort, hasUsage, expanded, onToggle, compact, currency, exchangeRate, query, selected, selectionStarted, onCompare }: {
  item: DisplayRow; sort: PricingSortDescriptor; hasUsage: boolean; expanded: boolean; onToggle: () => void; compact: boolean;
  query: string; selected: boolean; selectionStarted: boolean; onCompare: () => void;
} & PriceDisplay) {
  const { t, i18n } = useTranslation();
  const { group, variant, kind } = item;
  const name = getPricingModelName(group.model, group.displayName);
  const details = <PricingChannelDetails name={name} variant={variant} currency={currency} exchangeRate={exchangeRate} query={query} />;
  if (kind !== 'model') return <div className="ml-4 flex min-w-0 flex-1 items-center gap-2 border-l-2 border-border/70 pl-3 sm:ml-4">
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs">
      <span className="font-medium">{kind === 'subscription' ? t('pricing.list.subscription') : 'API'}</span>
      <PricingAliases group={group} variant={variant} query={query} />
      <Regions regions={variant.regions} />
      {compact && (kind === 'subscription' || variant.row.contextWindow !== primaryVariant(group).row.contextWindow) && <span className="text-[11px] text-muted">{formatPricingContext(variant.row.contextWindow, i18n.language)}</span>}
      {kind === 'subscription' && group.subscriptionVariants.some(other => other !== variant && other.row.contextWindow === variant.row.contextWindow) && <span className="max-w-40 truncate font-mono text-[10px] text-muted" title={variant.row.model.split('/')[0]}>{variant.row.model.split('/')[0]}</span>}
    </div>
      {details}
  </div>;

  const provider = getPricingProvider(group.model);
  const providerLabel = provider.key === 'unknown' ? t('pricing.provider.other') : provider.label;
  const suppliedModel = group.canonicalModelId && getPricingProvider(group.canonicalModelId).key !== provider.key;
  const sameApiPrice = group.apiVariants.length === 1 && variant.regions.length > 1
    && [variant.row.input, variant.row.output, variant.row.cacheRead, variant.row.cacheWrite].every(value => value !== null);
  return <div className="flex min-w-0 flex-1 items-start gap-2">
    <Checkbox aria-label={t('pricing.list.compare', { name, provider: providerLabel })} isSelected={selected} onChange={onCompare} className={`mt-1 shrink-0 ${selectionStarted ? '' : '[@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover/pricing-row:opacity-100 group-focus-within/pricing-row:opacity-100'}`}>
      <Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content>
    </Checkbox>
    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-surface sm:size-8">
      <ModelProviderIcon provider={provider} size={20} />
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="min-w-0 truncate [font-family:system-ui,sans-serif] text-sm font-semibold" title={`${providerLabel}\n${group.entries.map(entry => entry.model).join('\n')}`}><PricingHighlight text={name} query={query} /></span>
        {variant.entries.length === 1 && <CopyPricingId model={variant.row.model} />}
        <Regions regions={variant.regions} />
        {group.featured && sort.column === 'latest' && <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent-soft-foreground">{t('pricing.list.featured')}</span>}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1"><PricingAliases group={group} variant={variant} query={query} /></div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
        {compact && <><span>{t('pricing.details.contextValue', { value: formatPricingContext(variant.row.contextWindow, i18n.language) })}</span><span>{variant.row.releaseDate ? formatPricingReleaseDate(variant.row.releaseDate, i18n.language) : t('pricing.list.dateMissing')}</span></>}
        {sameApiPrice && <span>{t('pricing.list.sameApiPrice')}</span>}
        {hasUsage && (group.usageTokens ?? 0) > 0 && <span className="text-accent">{t('pricing.list.usage30', { count: formatPricingTokens(group.usageTokens!, i18n.language) })}</span>}
        {suppliedModel && <span>{t('pricing.list.suppliedBy', { provider: providerLabel })}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {details}
        {group.subscriptionVariants.length > 0 && <Button
          aria-label={t('pricing.list.subscriptionChannelsAria', { provider: providerLabel, name })} aria-expanded={expanded} variant="ghost" size="sm"
          className="!h-6 !min-h-6 !gap-0.5 !rounded-md bg-accent-soft/60 !px-1.5 !text-[11px] text-accent-soft-foreground" onPress={onToggle}
        >{t('pricing.list.subscriptionChannels')}<ChevronDown aria-hidden className={`size-3 transition-transform ${expanded ? '' : '-rotate-90'}`} /></Button>}
      </div>
    </div>
  </div>;
}

function PricePair({ row, cache = false, subscriptionLabelKey = 'pricing.list.planQuota', currency, exchangeRate }: { row: PricingCatalogRow; cache?: boolean; subscriptionLabelKey?: string } & PriceDisplay) {
  const { t } = useTranslation();
  if (row.billingMode === 'subscription') return <div className="text-xs text-muted">
    {cache ? <span className="sr-only">{t('pricing.list.subscriptionNoApi')}</span> : <span>{t(subscriptionLabelKey)}</span>}
  </div>;
  return <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5 text-xs tabular-nums">
    <span className="whitespace-nowrap text-xs text-muted">{t(cache ? 'pricing.metric.cacheRead' : 'pricing.metric.input')}</span>
    <span className="min-w-0 text-right"><PricingRate value={row[cache ? 'cacheRead' : 'input']} currency={currency} exchangeRate={exchangeRate} /></span>
    <span className="whitespace-nowrap text-xs text-muted">{t(cache ? 'pricing.metric.cacheWrite' : 'pricing.metric.output')}</span>
    <span className="min-w-0 text-right"><PricingRate value={row[cache ? 'cacheWrite' : 'output']} currency={currency} exchangeRate={exchangeRate} /></span>
  </div>;
}

export function PricingList({ groups, sort, hasUsage, onSortChange, currency, exchangeRate, query, selected, onCompare, scenario }: {
  groups: PricingModelGroup[]; sort: PricingSortDescriptor; hasUsage: boolean;
  onSortChange: (sort: PricingSortDescriptor) => void;
  query: string; selected: string[]; onCompare: (id: string) => void; scenario: PricingScenario | null;
} & PriceDisplay) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0]!.contentRect.width));
    observer.observe(container);
    setWidth(container.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);
  const rows = useMemo<DisplayRow[]>(() => groups.flatMap(group => {
    const primary = primaryVariant(group);
    return [
      { id: group.id, kind: 'model' as const, group, variant: primary },
      ...group.apiVariants.slice(1).map(variant => ({ id: `${group.id}:api:${variant.id}`, kind: 'api' as const, group, variant })),
      ...(expanded.has(group.id) ? group.subscriptionVariants.map(variant => ({ id: `${group.id}:subscription:${variant.id}`, kind: 'subscription' as const, group, variant })) : []),
    ];
  }), [groups, expanded]);
  const toggle = (id: string) => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const mobile = width > 0 && width < 640;
  const wide = width >= (scenario ? 1040 : 960);
  const identity = (item: DisplayRow) => <ModelIdentity item={item} sort={sort} hasUsage={hasUsage} expanded={expanded.has(item.group.id)} onToggle={() => toggle(item.group.id)} compact={!wide} currency={currency} exchangeRate={exchangeRate} query={query} selected={selected.includes(item.group.id)} selectionStarted={selected.length > 0} onCompare={() => onCompare(item.group.id)} />;
  const columns: TableColumn[] = [...(wide ? WIDE_COLUMNS : COMPACT_COLUMNS), ...(wide && scenario ? [{ id: 'estimate' as const, labelKey: 'pricing.list.estimate', minWidth: 112, width: 120 }] : [])];
  const handleSort = (descriptor: SortDescriptor) => {
    const column = columns.find(column => column.id === descriptor.column)?.id;
    if (column && column !== 'estimate') onSortChange({ column: column === 'inputOutput' ? 'input' : column === 'cache' ? 'cacheRead' : column, direction: descriptor.direction });
  };
  const displayedSort = !wide && sort.column === 'input' ? { ...sort, column: 'inputOutput' }
    : !wide && sort.column === 'cacheRead' ? { ...sort, column: 'cache' } : sort;
  const sortDescriptor = columns.some(column => column.id === displayedSort.column) ? displayedSort : undefined;
  // Keep native row selection semantics, but select on click so dragging text remains possible.
  const onRowPointerDown = (event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>) => {
    if (event.button === 0 && getComparisonRow(event, true)) event.stopPropagation();
  };
  const onRowClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.defaultPrevented) return;
    const row = getComparisonRow(event);
    const textSelection = event.currentTarget.ownerDocument.getSelection();
    if (!row || (textSelection && !textSelection.isCollapsed)) return;
    onCompare(row.dataset.pricingSelectable!);
  };
  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.repeat || (event.key !== ' ' && event.key !== 'Enter')) return;
    const row = getComparisonRow(event);
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    onCompare(row.dataset.pricingSelectable!);
  };

  return <div ref={containerRef} className="min-h-0 min-w-0 flex-1 overflow-hidden" data-pricing-layout={mobile ? 'mobile' : wide ? 'wide' : 'compact'} onPointerDownCapture={onRowPointerDown} onMouseDownCapture={onRowPointerDown} onClickCapture={onRowClick} onKeyDownCapture={onRowKeyDown}>
    {groups.length === 0 ? <div className="flex h-full min-h-48 flex-col items-center justify-center gap-1 text-center">
      <p className="text-sm font-medium">{t('pricing.list.empty')}</p><p className="text-xs text-muted">{t('pricing.list.emptyHint')}</p>
    </div> : mobile ? <Virtualizer layout={ListLayout} layoutOptions={{ gap: 8, estimatedRowHeight: 180 }} shouldObserveItemSize>
      <GridList aria-label={t('pricing.list.aria')} className="h-full w-full min-w-0 max-w-full overflow-x-hidden overflow-y-auto outline-none" items={groups} selectedKeys={selected} selectionMode="multiple" selectionBehavior="toggle" dependencies={[sort.column, hasUsage, currency, exchangeRate, expanded, query, selected, scenario, i18n.language]}>
        {group => <GridListItem id={group.id} data-pricing-selectable={group.id} textValue={getPricingModelName(group.model, group.displayName)} className={`group/pricing-row w-full min-w-0 max-w-full cursor-pointer rounded-xl border border-border/70 p-3 outline-none focus-visible:outline-2 focus-visible:outline-accent ${selected.includes(group.id) ? 'bg-accent-soft/50 hover:bg-accent-soft/70' : 'bg-surface hover:bg-surface-secondary/70'}`}>
          <div className="min-w-0 space-y-2">
            {identity({ id: group.id, kind: 'model', group, variant: primaryVariant(group) })}
            {primaryVariant(group).row.billingMode === 'subscription' ? <p className="text-xs text-muted">{t('pricing.list.subscriptionPlan')}</p> : <div className="grid min-w-0 grid-cols-2 gap-x-4 border-t border-border/40 pt-2">
              <PricePair row={primaryVariant(group).row} currency={currency} exchangeRate={exchangeRate} />
              <PricePair row={primaryVariant(group).row} cache currency={currency} exchangeRate={exchangeRate} />
            </div>}
            {scenario && <div className="flex items-baseline justify-between gap-2 border-t border-border/40 pt-2 text-xs"><span className="text-muted">{t('pricing.list.estimate')}</span><PricingEstimatedCost row={primaryVariant(group).row} scenario={scenario} currency={currency} exchangeRate={exchangeRate} /></div>}
            {rows.filter(row => row.group.id === group.id && row.kind !== 'model').map(item => <div key={item.id} data-pricing-subrow className="space-y-1.5 border-t border-border/40 pt-2">
              {identity(item)}
              {item.kind === 'api' && <div className="grid min-w-0 grid-cols-2 gap-x-4">
                <PricePair row={item.variant.row} currency={currency} exchangeRate={exchangeRate} />
                <PricePair row={item.variant.row} cache currency={currency} exchangeRate={exchangeRate} />
              </div>}
              {scenario && item.kind === 'api' && <div className="flex justify-between gap-2 text-xs"><span className="text-muted">{t('pricing.list.estimate')}</span><PricingEstimatedCost row={item.variant.row} scenario={scenario} currency={currency} exchangeRate={exchangeRate} /></div>}
              {item.variant.row.releaseDate !== primaryVariant(group).row.releaseDate && <p className="text-[11px] text-muted">{t('pricing.list.released', { date: formatPricingReleaseDate(item.variant.row.releaseDate, i18n.language) })}</p>}
            </div>)}
          </div>
        </GridListItem>}
      </GridList>
    </Virtualizer> : <div className="h-full overflow-hidden rounded-2xl border border-border/60 bg-surface-secondary p-1">
      <Virtualizer key={wide ? 'wide' : 'compact'} layout={TableLayout} layoutOptions={{ headingHeight: 56, estimatedRowHeight: 56 }} shouldObserveItemSize>
        <Table className="table-size-small h-full w-full">
          <Table.ScrollContainer className="h-full min-w-0 rounded-xl">
            <Table.Content aria-label={t('pricing.list.tableAria')} className="h-full w-full overflow-y-auto [scrollbar-gutter:stable]" selectedKeys={selected} selectionMode="multiple" selectionBehavior="toggle" disabledKeys={rows.filter(item => item.kind !== 'model').map(item => item.id)} disabledBehavior="selection" sortDescriptor={sortDescriptor} onSortChange={handleSort}>
              <Table.Header>{columns.map(column => <Table.Column key={column.id} id={column.id} allowsSorting={column.id !== 'estimate'} isRowHeader={column.id === 'model'} defaultWidth={column.width} minWidth={column.minWidth} className={`bg-surface-secondary ${column.id === 'model' ? '!text-left' : '!text-right'}`}>
                {({ sortDirection }) => column.id === 'estimate' ? <span>{t(column.labelKey)}</span> : <Table.SortableColumnHeader className={`${column.id === 'model' ? '!justify-start' : '!justify-end'} !gap-1`} sortDirection={sortDirection}>{t(column.labelKey)}</Table.SortableColumnHeader>}
              </Table.Column>)}</Table.Header>
              <Table.Body items={rows} dependencies={[sort.column, hasUsage, currency, exchangeRate, wide, expanded, query, selected, scenario, i18n.language]}>
                {item => <Table.Row id={item.id} data-pricing-row={item.kind} data-pricing-selectable={item.kind === 'model' ? item.group.id : undefined} className={`group/pricing-row !border-0 ${item.kind === 'model' ? 'cursor-pointer' : ''}`}>
                  {columns.map(column => <Table.Cell key={column.id} className={`!px-3 !py-0 !border-b-0 ${item.kind === 'model' ? `border-t border-border/70 ${selected.includes(item.group.id) ? 'bg-accent-soft/50 group-hover/pricing-row:bg-accent-soft/70' : 'group-hover/pricing-row:bg-surface-secondary/70'}` : '!border-t-0'} ${column.id === 'model' ? '!text-left' : '!text-right'}`}>
                    <div className={`flex min-w-0 items-center ${column.id === 'model' ? '' : 'justify-end'} ${item.kind === 'model' ? wide ? 'min-h-16 py-1.5' : 'min-h-[72px] py-1.5' : wide ? 'min-h-10 py-1' : 'min-h-12 py-1'}`}>
                    {column.id === 'model' ? <div className="min-w-0 flex-1">{identity(item)}{scenario && !wide && <div className="ml-7 mt-1 flex flex-wrap items-baseline gap-x-2 text-[11px]"><span className="text-muted">{t('pricing.list.estimate')}</span><PricingEstimatedCost row={item.variant.row} scenario={scenario} currency={currency} exchangeRate={exchangeRate} /></div>}</div>
                      : column.id === 'estimate' && scenario ? <PricingEstimatedCost row={item.variant.row} scenario={scenario} currency={currency} exchangeRate={exchangeRate} />
                      : column.id === 'inputOutput' || column.id === 'cache' ? <PricePair row={item.variant.row} cache={column.id === 'cache'} subscriptionLabelKey={item.kind === 'model' ? 'pricing.list.subscriptionOnly' : 'pricing.list.planQuotaShort'} currency={currency} exchangeRate={exchangeRate} />
                        : column.id === 'contextWindow' ? <span className={`text-xs tabular-nums text-muted ${item.kind === 'api' && item.variant.row.contextWindow === primaryVariant(item.group).row.contextWindow ? 'sr-only' : ''}`} title={item.variant.row.contextWindow ? `${new Intl.NumberFormat(i18n.language).format(item.variant.row.contextWindow)} Token` : t('pricing.list.contextMissing')}>{formatPricingContext(item.variant.row.contextWindow, i18n.language)}</span>
                          : column.id === 'releaseDate' ? <span className={`whitespace-nowrap text-xs tabular-nums text-muted ${item.kind !== 'model' && item.variant.row.releaseDate === primaryVariant(item.group).row.releaseDate ? 'sr-only' : ''}`}>{formatPricingReleaseDate(item.variant.row.releaseDate, i18n.language)}</span>
                            : item.variant.row.billingMode === 'subscription' ? <span className="text-xs text-muted">{column.id === 'input' ? t(item.kind === 'model' ? 'pricing.list.subscriptionOnly' : 'pricing.list.planQuotaShort') : <span className="sr-only">{t('pricing.list.notApplicable')}</span>}</span>
                              : <span className="text-[13px]"><PricingRate value={item.variant.row[column.id as 'input' | 'output' | 'cacheRead' | 'cacheWrite']} currency={currency} exchangeRate={exchangeRate} /></span>}
                    </div>
                  </Table.Cell>)}
                </Table.Row>}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Virtualizer>
    </div>}
  </div>;
}
