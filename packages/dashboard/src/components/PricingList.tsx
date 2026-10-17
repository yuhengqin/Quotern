import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { ChevronDown } from '@gravity-ui/icons';
import { Button, ListLayout, Table, TableLayout, Virtualizer, type SortDescriptor } from '@heroui/react';
import { GridList, GridListItem } from 'react-aria-components';
import { ModelProviderIcon } from './ModelProviderIcon';
import type { PricingCatalogRow } from '../lib/pricing-data';
import type { PricingCurrency } from '../lib/pricing-currency';
import { formatCatalogPricingRate, getPricingModelName, getPricingProvider, type PricingSortDescriptor, type PricingSortKey } from '../lib/pricing-catalog';
import { formatPricingContext, type PricingModelGroup, type PricingVariant } from '../lib/pricing-groups';
import { formatTokens } from '../lib/format';

type PriceDisplay = { currency: PricingCurrency; exchangeRate: number | null };
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
  return regions.length > 0 && <span className="shrink-0 rounded bg-surface-secondary px-1 py-0.5 text-[10px] text-muted">{regions.join(' / ')}</span>;
}

function ModelIdentity({ item, sort, hasUsage, expanded, onToggle }: {
  item: DisplayRow; sort: PricingSortDescriptor; hasUsage: boolean; expanded: boolean; onToggle: () => void;
}) {
  const { group, variant, kind } = item;
  const name = getPricingModelName(group.model, group.displayName);
  if (kind !== 'model') return <div className="ml-3 min-w-0 border-l-2 border-border/70 pl-3 sm:ml-4">
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="font-medium">{kind === 'subscription' ? '订阅' : 'API'} · {formatPricingContext(variant.row.contextWindow)}</span>
      <Regions regions={variant.regions} />
    </div>
    <div className="mt-1 truncate font-mono text-[10px] text-muted" title={variant.entries.map(entry => entry.model).join('\n')}>
      {variant.entries.map(entry => <div key={entry.model} className="truncate">{entry.model}</div>)}
    </div>
  </div>;

  const provider = getPricingProvider(group.model);
  const sameApiPrice = group.apiVariants.length === 1 && variant.regions.length > 1
    && [variant.row.input, variant.row.output, variant.row.cacheRead, variant.row.cacheWrite].every(value => value !== null);
  return <div className="flex min-w-0 items-center gap-2 sm:gap-3">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-surface sm:size-9">
      <ModelProviderIcon provider={provider} size={20} />
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="min-w-0 truncate font-mono text-sm font-medium" title={`${provider.label}\n${group.entries.map(entry => entry.model).join('\n')}`}>{name}</span>
        <Regions regions={variant.regions} />
        {group.featured && sort.column === 'latest' && <span className="shrink-0 rounded bg-accent-soft px-1 py-0.5 text-[10px] text-accent-soft-foreground">主推</span>}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
        <span title={`上下文 ${group.contextWindow?.toLocaleString() ?? '未收录'} Token`}>{formatPricingContext(group.contextWindow)}</span>
        {sameApiPrice && <span>API 同价</span>}
        {sort.column === 'usage' && hasUsage && <span>30 天 {formatTokens(group.usageTokens ?? 0)}</span>}
        {group.subscriptionVariants.length > 0 && <Button
          aria-label={`${provider.label} ${name}的订阅方案`} aria-expanded={expanded} variant="tertiary" size="sm"
          className="!h-5 !min-h-5 !gap-0.5 !rounded !px-1 !text-[11px]" onPress={onToggle}
        >订阅方案<ChevronDown aria-hidden className={`size-3 transition-transform ${expanded ? 'rotate-180' : ''}`} /></Button>}
      </div>
    </div>
  </div>;
}

function PricePair({ row, cache = false, currency, exchangeRate }: { row: PricingCatalogRow; cache?: boolean } & PriceDisplay) {
  if (row.billingMode === 'subscription') return <div className="text-xs text-muted">
    {cache ? '—' : <><span className="font-medium text-foreground">订阅制</span><span className="mt-1 block text-[11px]">按套餐额度使用</span></>}
  </div>;
  return <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-1.5 gap-y-1.5 text-xs tabular-nums sm:text-sm">
    <span className="whitespace-nowrap text-xs text-muted">{cache ? '缓存读' : '输入'}</span>
    <span className="min-w-0 break-all text-left font-mono">{formatCatalogPricingRate(row, cache ? 'cacheRead' : 'input', currency, exchangeRate)}</span>
    <span className="whitespace-nowrap text-xs text-muted">{cache ? '缓存写' : '输出'}</span>
    <span className="min-w-0 break-all text-left font-mono">{formatCatalogPricingRate(row, cache ? 'cacheWrite' : 'output', currency, exchangeRate)}</span>
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
    const primary = group.apiVariants[0] ?? group.subscriptionVariants.find(variant => variant.row.model === group.model)!;
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
  const identity = (item: DisplayRow) => <ModelIdentity item={item} sort={sort} hasUsage={hasUsage} expanded={expanded.has(item.group.id)} onToggle={() => toggle(item.group.id)} />;
  const mobile = width > 0 && width < 640;
  const wide = width >= 960;
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
    </div> : mobile ? <Virtualizer layout={ListLayout} layoutOptions={{ gap: 8, rowHeight: 180 }}>
      <GridList aria-label="模型价格列表" className="h-full overflow-x-hidden overflow-y-auto outline-none" items={rows} selectionMode="none" dependencies={[sort.column, hasUsage, currency, exchangeRate, expanded]}>
        {item => <GridListItem id={item.id} textValue={getPricingModelName(item.group.model, item.group.displayName)} data-pricing-row={item.kind} className={`h-[172px] rounded-xl border border-border/70 p-3 outline-none focus-visible:outline-2 focus-visible:outline-accent ${item.kind === 'model' ? 'bg-surface' : 'bg-surface-secondary/40'}`}>
          <div className="flex h-full min-w-0 flex-col justify-between gap-2">
            {identity(item)}
            <div className="grid min-w-0 grid-cols-2 gap-x-4 border-t border-border/60 pt-2">
              <PricePair row={item.variant.row} currency={currency} exchangeRate={exchangeRate} />
              <PricePair row={item.variant.row} cache currency={currency} exchangeRate={exchangeRate} />
            </div>
            <div className="flex gap-3 text-[11px] tabular-nums text-muted">
              <span>上下文 {formatPricingContext(item.variant.row.contextWindow)}</span><span>发布 {item.variant.row.releaseDate ?? '—'}</span>
            </div>
          </div>
        </GridListItem>}
      </GridList>
    </Virtualizer> : <div className="h-full overflow-hidden rounded-2xl border border-border/60">
      <Virtualizer key={wide ? 'wide' : 'compact'} layout={TableLayout} layoutOptions={{ headingHeight: 36, rowHeight: 84 }}>
        <Table className="table-size-small h-full w-full">
          <Table.ScrollContainer className="h-full min-w-0">
            <Table.Content aria-label="模型价格表" className="h-full w-full overflow-y-auto" sortDescriptor={sortDescriptor} onSortChange={handleSort}>
              <Table.Header>{columns.map(column => <Table.Column key={column.id} id={column.id} allowsSorting isRowHeader={column.id === 'model'} defaultWidth={column.width} minWidth={column.minWidth} className="bg-surface-secondary !text-left">
                {({ sortDirection }) => <Table.SortableColumnHeader className="!justify-start !gap-1" sortDirection={sortDirection}>{column.label}</Table.SortableColumnHeader>}
              </Table.Column>)}</Table.Header>
              <Table.Body items={rows} dependencies={[sort.column, hasUsage, currency, exchangeRate, wide, expanded]}>
                {item => <Table.Row id={item.id} data-pricing-row={item.kind} className={item.kind === 'model' ? '' : 'bg-surface-secondary/40'}>
                  {columns.map(column => <Table.Cell key={column.id} className="!text-left">
                    {column.id === 'model' ? identity(item)
                      : column.id === 'inputOutput' || column.id === 'cache' ? <PricePair row={item.variant.row} cache={column.id === 'cache'} currency={currency} exchangeRate={exchangeRate} />
                        : column.id === 'contextWindow' ? <span className="text-xs tabular-nums text-muted" title={item.variant.row.contextWindow ? `${item.variant.row.contextWindow.toLocaleString()} Token` : '上下文未收录'}>{formatPricingContext(item.variant.row.contextWindow)}</span>
                          : column.id === 'releaseDate' ? <span className="whitespace-nowrap text-xs tabular-nums text-muted">{item.variant.row.releaseDate ?? '—'}</span>
                            : <span className="whitespace-nowrap text-left font-mono text-[13px] tabular-nums" title={item.variant.row.billingMode === 'subscription' ? '按订阅套餐额度使用，不提供按 Token API 单价' : undefined}>{formatCatalogPricingRate(item.variant.row, column.id as 'input' | 'output' | 'cacheRead' | 'cacheWrite', currency, exchangeRate)}</span>}
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
