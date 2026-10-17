import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { ChevronDown } from '@gravity-ui/icons';
import { Button, ListLayout, Table, TableLayout, Virtualizer, type SortDescriptor } from '@heroui/react';
import { GridList, GridListItem } from 'react-aria-components';
import { ModelProviderIcon } from './ModelProviderIcon';
import { PricingChannelDetails, PricingRate, type PriceDisplay } from './PricingDetails';
import type { PricingCatalogRow } from '../lib/pricing-data';
import { getPricingModelName, getPricingProvider, type PricingSortDescriptor, type PricingSortKey } from '../lib/pricing-catalog';
import { formatPricingContext, type PricingModelGroup, type PricingVariant } from '../lib/pricing-groups';
import { getPricingVariantSuffixes } from '../lib/pricing-display';
import { formatTokens } from '../lib/format';

type TableColumn = { id: PricingSortKey; label: string; minWidth: number; width: NonNullable<ComponentProps<typeof Table.Column>['defaultWidth']> };
type DisplayRow = { id: string; kind: 'model' | 'api' | 'subscription'; group: PricingModelGroup; variant: PricingVariant };
const WIDE_COLUMNS: TableColumn[] = [
  { id: 'model', label: '模型', minWidth: 260, width: '1fr' },
  { id: 'input', label: '输入', minWidth: 118, width: 128 },
  { id: 'output', label: '输出', minWidth: 118, width: 128 },
  { id: 'cacheRead', label: '缓存读', minWidth: 118, width: 128 },
  { id: 'cacheWrite', label: '缓存写', minWidth: 118, width: 128 },
  { id: 'contextWindow', label: '上下文', minWidth: 88, width: 96 },
  { id: 'releaseDate', label: '发布时间', minWidth: 112, width: 124 },
];
const COMPACT_COLUMNS: TableColumn[] = [
  { id: 'model', label: '模型', minWidth: 190, width: '1fr' },
  { id: 'inputOutput', label: '输入 / 输出', minWidth: 144, width: '25%' },
  { id: 'cache', label: '缓存', minWidth: 144, width: '25%' },
];

function Regions({ regions }: { regions: string[] }) {
  return regions.length > 0 && <span className="shrink-0 rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] text-muted">{regions.join(' / ')}</span>;
}

function VariantSuffixes({ group, variant }: { group: PricingModelGroup; variant: PricingVariant }) {
  if (variant.row.billingMode === 'subscription') return null;
  const suffixes = getPricingVariantSuffixes(group.canonicalModelId ?? group.model, variant.entries.map(entry => entry.model));
  return suffixes.map(suffix => <span key={suffix} className="max-w-40 truncate rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] text-accent-soft-foreground" title={suffix}>{suffix}</span>);
}

function primaryVariant(group: PricingModelGroup) {
  return group.apiVariants[0] ?? group.subscriptionVariants.find(variant => variant.row.model === group.model)!;
}

function ModelIdentity({ item, sort, hasUsage, expanded, onToggle, compact, currency, exchangeRate }: {
  item: DisplayRow; sort: PricingSortDescriptor; hasUsage: boolean; expanded: boolean; onToggle: () => void; compact: boolean;
} & PriceDisplay) {
  const { group, variant, kind } = item;
  const name = getPricingModelName(group.model, group.displayName);
  const details = <PricingChannelDetails name={name} variant={variant} currency={currency} exchangeRate={exchangeRate} />;
  if (kind !== 'model') return <div className="ml-4 flex min-w-0 flex-1 items-center gap-2 border-l-2 border-border/70 pl-3 sm:ml-4">
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs">
      <span className="font-medium">{kind === 'subscription' ? '订阅' : 'API'}</span>
      <VariantSuffixes group={group} variant={variant} />
      <Regions regions={variant.regions} />
      {compact && (kind === 'subscription' || variant.row.contextWindow !== primaryVariant(group).row.contextWindow) && <span className="text-[11px] text-muted">{formatPricingContext(variant.row.contextWindow)}</span>}
      {kind === 'subscription' && group.subscriptionVariants.some(other => other !== variant && other.row.contextWindow === variant.row.contextWindow) && <span className="max-w-40 truncate font-mono text-[10px] text-muted" title={variant.row.model.split('/')[0]}>{variant.row.model.split('/')[0]}</span>}
    </div>
    {details}
  </div>;

  const provider = getPricingProvider(group.model);
  const suppliedModel = group.canonicalModelId && getPricingProvider(group.canonicalModelId).key !== provider.key;
  const sameApiPrice = group.apiVariants.length === 1 && variant.regions.length > 1
    && [variant.row.input, variant.row.output, variant.row.cacheRead, variant.row.cacheWrite].every(value => value !== null);
  return <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-surface sm:size-9">
      <ModelProviderIcon provider={provider} size={20} />
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="min-w-0 truncate font-mono text-sm font-medium" title={`${provider.label}\n${group.entries.map(entry => entry.model).join('\n')}`}>{name}</span>
        <VariantSuffixes group={group} variant={variant} />
        <Regions regions={variant.regions} />
        {group.featured && sort.column === 'latest' && <span className="shrink-0 rounded bg-accent-soft px-1 py-0.5 text-[10px] text-accent-soft-foreground">主推</span>}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
        {compact && <span>{formatPricingContext(variant.row.contextWindow)} · {variant.row.releaseDate ?? '日期未收录'}</span>}
        {sameApiPrice && <span>API 同价</span>}
        {sort.column === 'usage' && hasUsage && (group.usageTokens ?? 0) > 0 && <span>30 天 {formatTokens(group.usageTokens!)}</span>}
        {suppliedModel && <span>由 {provider.label} 提供</span>}
        {group.subscriptionVariants.length > 0 && <Button
          aria-label={`${provider.label} ${name}的订阅渠道`} aria-expanded={expanded} variant="ghost" size="sm"
          className="!h-6 !min-h-6 !gap-0.5 !rounded !px-1 !text-[11px] text-muted" onPress={onToggle}
        >{group.apiVariants.length ? '支持订阅' : '查看渠道'}<ChevronDown aria-hidden className={`size-3 transition-transform ${expanded ? '' : '-rotate-90'}`} /></Button>}
      </div>
    </div>
    {group.apiVariants.length > 0 && details}
  </div>;
}

function PricePair({ row, cache = false, subscriptionLabel = '按套餐额度使用', currency, exchangeRate }: { row: PricingCatalogRow; cache?: boolean; subscriptionLabel?: string } & PriceDisplay) {
  if (row.billingMode === 'subscription') return <div className="text-xs text-muted">
    {cache ? <span className="sr-only">订阅不适用 API 单价</span> : <span>{subscriptionLabel}</span>}
  </div>;
  return <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5 text-xs tabular-nums">
    <span className="whitespace-nowrap text-xs text-muted">{cache ? '缓存读' : '输入'}</span>
    <span className="min-w-0 text-right"><PricingRate value={row[cache ? 'cacheRead' : 'input']} currency={currency} exchangeRate={exchangeRate} /></span>
    <span className="whitespace-nowrap text-xs text-muted">{cache ? '缓存写' : '输出'}</span>
    <span className="min-w-0 text-right"><PricingRate value={row[cache ? 'cacheWrite' : 'output']} currency={currency} exchangeRate={exchangeRate} /></span>
  </div>;
}

export function PricingList({ groups, sort, hasUsage, onSortChange, currency, exchangeRate }: {
  groups: PricingModelGroup[]; sort: PricingSortDescriptor; hasUsage: boolean;
  onSortChange: (sort: PricingSortDescriptor) => void;
} & PriceDisplay) {
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
  const wide = width >= 960;
  const identity = (item: DisplayRow) => <ModelIdentity item={item} sort={sort} hasUsage={hasUsage} expanded={expanded.has(item.group.id)} onToggle={() => toggle(item.group.id)} compact={!wide} currency={currency} exchangeRate={exchangeRate} />;
  const columns = wide ? WIDE_COLUMNS : COMPACT_COLUMNS;
  const handleSort = (descriptor: SortDescriptor) => {
    const column = columns.find(column => column.id === descriptor.column)?.id;
    if (column) onSortChange({ column: column === 'inputOutput' ? 'input' : column === 'cache' ? 'cacheRead' : column, direction: descriptor.direction });
  };
  const displayedSort = !wide && sort.column === 'input' ? { ...sort, column: 'inputOutput' }
    : !wide && sort.column === 'cacheRead' ? { ...sort, column: 'cache' } : sort;
  const sortDescriptor = columns.some(column => column.id === displayedSort.column) ? displayedSort : undefined;

  return <div ref={containerRef} className="min-h-0 min-w-0 flex-1 overflow-hidden" data-pricing-layout={mobile ? 'mobile' : wide ? 'wide' : 'compact'}>
    {groups.length === 0 ? <div className="flex h-full min-h-48 flex-col items-center justify-center gap-1 text-center">
      <p className="text-sm font-medium">没有匹配的模型</p><p className="text-xs text-muted">请调整或清空筛选条件</p>
    </div> : mobile ? <Virtualizer layout={ListLayout} layoutOptions={{ gap: 8, estimatedRowHeight: 180 }} shouldObserveItemSize>
      <GridList aria-label="模型价格列表" className="h-full overflow-x-hidden overflow-y-auto outline-none" items={groups} selectionMode="none" dependencies={[sort.column, hasUsage, currency, exchangeRate, expanded]}>
        {group => <GridListItem id={group.id} textValue={getPricingModelName(group.model, group.displayName)} className="rounded-xl border border-border/70 bg-surface p-3 outline-none focus-visible:outline-2 focus-visible:outline-accent">
          <div className="min-w-0 space-y-2">
            {identity({ id: group.id, kind: 'model', group, variant: primaryVariant(group) })}
            {primaryVariant(group).row.billingMode === 'subscription' ? <p className="text-xs text-muted">订阅制 · 按套餐额度使用</p> : <div className="grid min-w-0 grid-cols-2 gap-x-4 border-t border-border/40 pt-2">
              <PricePair row={primaryVariant(group).row} currency={currency} exchangeRate={exchangeRate} />
              <PricePair row={primaryVariant(group).row} cache currency={currency} exchangeRate={exchangeRate} />
            </div>}
            {rows.filter(row => row.group.id === group.id && row.kind !== 'model').map(item => <div key={item.id} className="space-y-1.5 border-t border-border/40 pt-2">
              {identity(item)}
              {item.kind === 'api' && <div className="grid min-w-0 grid-cols-2 gap-x-4">
                <PricePair row={item.variant.row} currency={currency} exchangeRate={exchangeRate} />
                <PricePair row={item.variant.row} cache currency={currency} exchangeRate={exchangeRate} />
              </div>}
              {item.variant.row.releaseDate !== primaryVariant(group).row.releaseDate && <p className="text-[11px] text-muted">发布 {item.variant.row.releaseDate ?? '—'}</p>}
            </div>)}
          </div>
        </GridListItem>}
      </GridList>
    </Virtualizer> : <div className="h-full overflow-hidden rounded-2xl border border-border/60">
      <Virtualizer key={wide ? 'wide' : 'compact'} layout={TableLayout} layoutOptions={{ headingHeight: 36, estimatedRowHeight: 56 }} shouldObserveItemSize>
        <Table className="table-size-small h-full w-full">
          <Table.ScrollContainer className="h-full min-w-0">
            <Table.Content aria-label="模型价格表" className="h-full w-full overflow-y-auto" sortDescriptor={sortDescriptor} onSortChange={handleSort}>
              <Table.Header>{columns.map(column => <Table.Column key={column.id} id={column.id} allowsSorting isRowHeader={column.id === 'model'} defaultWidth={column.width} minWidth={column.minWidth} className={`bg-surface-secondary ${column.id === 'model' ? '!text-left' : '!text-right'}`}>
                {({ sortDirection }) => <Table.SortableColumnHeader className={`${column.id === 'model' ? '!justify-start' : '!justify-end'} !gap-1`} sortDirection={sortDirection}>{column.label}</Table.SortableColumnHeader>}
              </Table.Column>)}</Table.Header>
              <Table.Body items={rows} dependencies={[sort.column, hasUsage, currency, exchangeRate, wide, expanded]}>
                {item => <Table.Row id={item.id} data-pricing-row={item.kind} className="!border-0">
                  {columns.map(column => <Table.Cell key={column.id} className={`!px-3 !py-0 !border-b-0 ${item.kind === 'model' ? 'border-t border-border/70' : '!border-t-0'} ${column.id === 'model' ? '!text-left' : '!text-right'}`}>
                    <div className={`flex min-w-0 items-center ${column.id === 'model' ? '' : 'justify-end'} ${item.kind === 'model' ? wide ? 'min-h-16 py-1.5' : 'min-h-[72px] py-1.5' : wide ? 'min-h-10 py-1' : 'min-h-12 py-1'}`}>
                    {column.id === 'model' ? identity(item)
                      : column.id === 'inputOutput' || column.id === 'cache' ? <PricePair row={item.variant.row} cache={column.id === 'cache'} subscriptionLabel={item.kind === 'model' ? '订阅制' : '套餐额度'} currency={currency} exchangeRate={exchangeRate} />
                        : column.id === 'contextWindow' ? <span className={`text-xs tabular-nums text-muted ${item.kind === 'api' && item.variant.row.contextWindow === primaryVariant(item.group).row.contextWindow ? 'sr-only' : ''}`} title={item.variant.row.contextWindow ? `${item.variant.row.contextWindow.toLocaleString()} Token` : '上下文未收录'}>{formatPricingContext(item.variant.row.contextWindow)}</span>
                          : column.id === 'releaseDate' ? <span className={`whitespace-nowrap text-xs tabular-nums text-muted ${item.kind !== 'model' && item.variant.row.releaseDate === primaryVariant(item.group).row.releaseDate ? 'sr-only' : ''}`}>{item.variant.row.releaseDate ?? '—'}</span>
                            : item.variant.row.billingMode === 'subscription' ? <span className="text-xs text-muted">{column.id === 'input' ? item.kind === 'model' ? '订阅制' : '套餐额度' : <span className="sr-only">不适用</span>}</span>
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
