import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { ArrowLeft, Xmark } from '@gravity-ui/icons';
import { Button, ButtonGroup, Label, ListBox, ListLayout, SearchField, Select, Skeleton, Table, TableLayout, Virtualizer, type SortDescriptor } from '@heroui/react';
import { ModelProviderIcon } from '../components/ModelProviderIcon';
import { PricingMoreFilters, EMPTY_PRICING_FILTERS, type PricingAdvancedFilters } from '../components/PricingMoreFilters';
import { StatusBanner } from '../components/StatusBanner';
import { usePricingCurrency } from '../hooks/usePricingCurrency';
import { fetchModelBreakdown, type ModelBreakdownRow } from '../lib/api';
import { fetchPricingCatalog, type PricingCatalogResponse, type PricingCatalogRow } from '../lib/pricing-data';
import { formatTokens } from '../lib/format';
import { filterPricingCatalog, formatContextWindow } from '../lib/pricing-filters';
import type { PricingCurrency } from '../lib/pricing-currency';
import {
  addPricingUsage, filterAndSortPricingCatalog, filterDirectPricingCatalog,
  formatPricingRate, getPricingChannel, getPricingModelName, getPricingProvider,
  readPricingSort, writePricingSort, PRICING_SORT_OPTIONS,
  type PricingSortDescriptor, type PricingSortKey,
} from '../lib/pricing-catalog';

const SORT_CHOICES = PRICING_SORT_OPTIONS.map(option => {
  const [column, direction] = option.key.split(':') as [PricingSortKey, 'ascending' | 'descending'];
  return { column, direction, key: option.key, text: option.label };
});
type PriceDisplay = { currency: PricingCurrency; exchangeRate: number | null };
type TableColumn = { id: PricingSortKey; label: string; minWidth: number; width: NonNullable<ComponentProps<typeof Table.Column>['defaultWidth']> };
const WIDE_COLUMNS: TableColumn[] = [
  { id: 'model', label: '模型', minWidth: 220, width: '1fr' },
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

function ModelIdentity({ row, sort, hasUsage, compact = false }: {
  row: PricingCatalogRow; sort: PricingSortDescriptor; hasUsage: boolean; compact?: boolean;
}) {
  const provider = getPricingProvider(row.model);
  const channel = getPricingChannel(row.model);
  return (
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-surface sm:size-9">
        <ModelProviderIcon provider={provider} size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-sm font-medium" title={row.model}>{getPricingModelName(row.model)}</span>
          {channel && <span className="shrink-0 rounded bg-surface-secondary px-1 py-0.5 text-[10px] text-muted">{channel}</span>}
          {row.featured && sort.column === 'latest' && <span className="shrink-0 rounded bg-accent-soft px-1 py-0.5 text-[10px] text-accent-soft-foreground">主推</span>}
        </div>
        <div className="mt-0.5 flex min-w-0 items-baseline gap-x-2 text-[11px] text-muted">
          <span className="min-w-0 truncate" title={`${provider.label} · ${row.model}`}>{row.model}</span>
          {sort.column === 'usage' && hasUsage
            ? <span className="shrink-0">30 天 {formatTokens(row.usageTokens ?? 0)}</span>
            : compact && <span className="shrink-0 tabular-nums" title={`上下文 ${row.contextWindow?.toLocaleString() ?? '未收录'} Token · 发布时间 ${row.releaseDate ?? '未收录'}`}>{formatContextWindow(row.contextWindow)} · {row.releaseDate ?? '—'}</span>}
        </div>
      </div>
    </div>
  );
}

function PricePair({ row, cache = false, currency, exchangeRate }: { row: PricingCatalogRow; cache?: boolean } & PriceDisplay) {
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-1.5 gap-y-1.5 text-xs tabular-nums sm:text-sm">
      <span className="whitespace-nowrap text-xs text-muted">{cache ? '缓存读' : '输入'}</span>
      <span className="min-w-0 break-all text-left font-mono">{formatPricingRate(cache ? row.cacheRead : row.input, currency, exchangeRate)}</span>
      <span className="whitespace-nowrap text-xs text-muted">{cache ? '缓存写' : '输出'}</span>
      <span className="min-w-0 break-all text-left font-mono">{formatPricingRate(cache ? row.cacheWrite : row.output, currency, exchangeRate)}</span>
    </div>
  );
}

function PricingList({ rows, sort, hasUsage, onSortChange, currency, exchangeRate }: {
  rows: PricingCatalogRow[]; sort: PricingSortDescriptor; hasUsage: boolean;
  onSortChange: (sort: PricingSortDescriptor) => void;
} & PriceDisplay) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0]!.contentRect.width));
    observer.observe(container);
    setWidth(container.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);
  const mobile = width > 0 && width < 640;
  const wide = width >= 960;
  const columns = wide ? WIDE_COLUMNS : COMPACT_COLUMNS;
  const handleSort = (descriptor: SortDescriptor) => {
    if (PRICING_SORT_OPTIONS.some(option => option.key === `${descriptor.column}:${descriptor.direction}`)) {
      onSortChange({ column: descriptor.column as PricingSortKey, direction: descriptor.direction });
    } else if (descriptor.column === 'inputOutput' || descriptor.column === 'cache') {
      onSortChange({ column: descriptor.column === 'inputOutput' ? 'input' : 'cacheRead', direction: descriptor.direction });
    }
  };
  const displayedSort = !wide && sort.column === 'input' ? { ...sort, column: 'inputOutput' }
    : !wide && sort.column === 'cacheRead' ? { ...sort, column: 'cache' } : sort;
  const sortDescriptor = columns.some(column => column.id === displayedSort.column) ? displayedSort : undefined;

  return (
    <div ref={containerRef} className="min-h-0 min-w-0 flex-1 overflow-hidden" data-pricing-layout={mobile ? 'mobile' : wide ? 'wide' : 'compact'}>
      {rows.length === 0 ? <div className="flex h-full min-h-48 flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm font-medium">没有匹配的模型</p>
        <p className="text-xs text-muted">请调整或清空筛选条件</p>
      </div> : mobile ? <Virtualizer layout={ListLayout} layoutOptions={{ gap: 8, rowHeight: 164 }}>
        <ListBox aria-label="模型价格列表" className="h-full overflow-x-hidden overflow-y-auto !p-0" items={rows} selectionMode="none" dependencies={[sort.column, hasUsage, currency, exchangeRate]}>
          {row => <ListBox.Item id={row.model} textValue={row.model} className="!h-[156px] !items-stretch rounded-xl border border-border/70 bg-surface !p-3">
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
              <ModelIdentity row={row} sort={sort} hasUsage={hasUsage} />
              <div className="grid min-w-0 grid-cols-2 gap-x-4 border-t border-border/60 pt-2">
                <PricePair row={row} currency={currency} exchangeRate={exchangeRate} />
                <PricePair row={row} cache currency={currency} exchangeRate={exchangeRate} />
              </div>
              <div className="flex gap-3 text-[11px] tabular-nums text-muted">
                <span title={row.contextWindow ? `${row.contextWindow.toLocaleString()} Token` : undefined}>上下文 {formatContextWindow(row.contextWindow)}</span>
                <span>发布 {row.releaseDate ?? '—'}</span>
              </div>
            </div>
          </ListBox.Item>}
        </ListBox>
      </Virtualizer> : <div className="h-full overflow-hidden rounded-2xl border border-border/60">
        <Virtualizer key={wide ? 'wide' : 'compact'} layout={TableLayout} layoutOptions={{ headingHeight: 36, rowHeight: wide ? 64 : 76 }}>
          <Table className="table-size-small h-full w-full">
            <Table.ScrollContainer className="h-full min-w-0">
              <Table.Content aria-label="模型价格表" className="h-full w-full overflow-y-auto" sortDescriptor={sortDescriptor} onSortChange={handleSort}>
                <Table.Header>
                  {columns.map(column => <Table.Column key={column.id} id={column.id} allowsSorting isRowHeader={column.id === 'model'} defaultWidth={column.width} minWidth={column.minWidth} className="bg-surface-secondary !text-left">
                    {({ sortDirection }) => <Table.SortableColumnHeader className="!justify-start !gap-1" sortDirection={sortDirection}>{column.label}</Table.SortableColumnHeader>}
                  </Table.Column>)}
                </Table.Header>
                <Table.Body items={rows} dependencies={[sort.column, hasUsage, currency, exchangeRate, wide]}>
                  {row => <Table.Row id={row.model}>
                    {columns.map(column => <Table.Cell key={column.id} className="!text-left">
                      {column.id === 'model' ? <ModelIdentity row={row} sort={sort} hasUsage={hasUsage} compact={!wide} />
                        : column.id === 'inputOutput' || column.id === 'cache' ? <PricePair row={row} cache={column.id === 'cache'} currency={currency} exchangeRate={exchangeRate} />
                          : column.id === 'contextWindow' ? <span className="text-xs tabular-nums text-muted" title={row.contextWindow ? `${row.contextWindow.toLocaleString()} Token` : '上下文未收录'}>{formatContextWindow(row.contextWindow)}</span>
                            : column.id === 'releaseDate' ? <span className="whitespace-nowrap text-xs tabular-nums text-muted">{row.releaseDate ?? '—'}</span>
                              : <span className="whitespace-nowrap text-left font-mono text-[13px] tabular-nums">{formatPricingRate(row[column.id as 'input' | 'output' | 'cacheRead' | 'cacheWrite'], currency, exchangeRate)}</span>}
                    </Table.Cell>)}
                  </Table.Row>}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Virtualizer>
      </div>}
    </div>
  );
}

function ActiveFilter({ children, onRemove, label }: { children: ReactNode; onRemove: () => void; label: string }) {
  return <Button className="!h-6 !min-h-6 max-w-full !gap-1 !px-2 !text-[11px]" variant="tertiary" size="sm" onPress={onRemove} aria-label={`清除${label}筛选`}>
    <span className="min-w-0 truncate">{children}</span><Xmark className="size-3 shrink-0" aria-hidden />
  </Button>;
}

export function PricingPage({ loadUsage = fetchModelBreakdown }: { loadUsage?: (days: number) => Promise<{ models: ModelBreakdownRow[] }> }) {
  const search = useSearch({ strict: false }) as { q?: string };
  const initialQuery = typeof search.q === 'string' ? search.q : '';
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [providerFilters, setProviderFilters] = useState<string[]>([]);
  const [advancedFilters, setAdvancedFilters] = useState<PricingAdvancedFilters>(EMPTY_PRICING_FILTERS);
  const providerTriggerRef = useRef<HTMLButtonElement>(null);
  const [sort, setSort] = useState<PricingSortDescriptor>(readPricingSort);
  const [catalog, setCatalog] = useState<PricingCatalogResponse | null>(null);
  const [usage, setUsage] = useState<ModelBreakdownRow[]>([]);
  const [usageStatus, setUsageStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const { currency, setCurrency, exchangeRate, exchangeStatus, refreshExchangeRate, setManualExchangeRate } = usePricingCurrency();

  useEffect(() => { setQuery(initialQuery); }, [initialQuery]);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 160);
    return () => window.clearTimeout(timeout);
  }, [query]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchPricingCatalog().then(data => {
      if (!cancelled) setCatalog(data);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : '模型价格加载失败');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [retry]);
  useEffect(() => {
    let cancelled = false;
    setUsageStatus('loading');
    void loadUsage(30).then(data => {
      if (!cancelled) { setUsage(data.models); setUsageStatus('ready'); }
    }).catch(() => {
      if (!cancelled) { setUsage([]); setUsageStatus('error'); }
    });
    return () => { cancelled = true; };
  }, [loadUsage, retry]);

  const directModels = useMemo(() => addPricingUsage(filterDirectPricingCatalog(catalog?.models ?? []), usage, catalog?.matching), [catalog, usage]);
  const hasUsage = directModels.some(row => (row.usageTokens ?? 0) > 0);
  const updateSort = (next: PricingSortDescriptor) => { setSort(next); writePricingSort(next); };
  const providers = useMemo(() => {
    const unique = new Map<string, ReturnType<typeof getPricingProvider>>();
    for (const row of directModels) {
      const provider = getPricingProvider(row.model);
      unique.set(provider.key, provider);
    }
    return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [directModels]);
  const rows = useMemo(() => filterPricingCatalog(filterAndSortPricingCatalog(directModels, debouncedQuery, sort), { ...advancedFilters, providers: providerFilters }), [directModels, debouncedQuery, sort, providerFilters, advancedFilters]);
  const hasFilters = Boolean(query.trim() || providerFilters.length || advancedFilters.minContext || advancedFilters.releasedAfter || advancedFilters.releasedBefore);
  const clearFilters = () => { setQuery(''); setDebouncedQuery(''); setProviderFilters([]); setAdvancedFilters(EMPTY_PRICING_FILTERS); };
  const providerLabel = providerFilters.length > 1 ? `已选 ${providerFilters.length} 家提供商`
    : providers.find(provider => provider.key === providerFilters[0])?.label ?? '全部提供商';
  const sortKey = `${sort.column}:${sort.direction}`;
  const tableTimestamp = catalog?.generatedAt ?? catalog?.updatedAt;
  const dateLabel = tableTimestamp && Number.isFinite(Date.parse(tableTimestamp)) ? new Date(tableTimestamp).toLocaleString('zh-CN', { hour12: false }) : '未知';

  return (
    <section className="flex h-[calc(100dvh-5rem)] min-h-0 min-w-0 flex-col gap-3">
      <header className="flex shrink-0 items-center justify-between gap-3">
        <div><h1 className="text-xl font-semibold">模型价格</h1><p className="mt-1 text-xs text-muted">API 参考价 · {currency} / 百万 Token</p></div>
        <Link to="/dashboard" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-muted hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent"><ArrowLeft className="size-3.5" />返回用量</Link>
      </header>
      <div aria-label="价格筛选条件" className="flex shrink-0 flex-wrap items-center gap-2">
        <SearchField aria-label="搜索模型名称或 ID" value={query} onChange={setQuery} variant="secondary" className="min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-72">
          <Label className="sr-only">搜索模型名称或 ID</Label>
          <SearchField.Group className="!h-8 !min-h-8"><SearchField.SearchIcon /><SearchField.Input className="!text-xs" placeholder="搜索模型名称或 ID" /><SearchField.ClearButton /></SearchField.Group>
        </SearchField>
        <ButtonGroup className="shrink-0">
          <Select aria-label="提供商筛选" selectionMode="multiple" value={providerFilters.length ? providerFilters : ['all']} variant="secondary" onChange={keys => {
            if (Array.isArray(keys)) setProviderFilters(keys.includes('all') && providerFilters.length > 0 ? [] : keys.filter(key => key !== 'all').map(String));
          }} className="min-w-0 max-w-48 text-xs">
            <Label className="sr-only">提供商筛选</Label>
            <Select.Trigger ref={providerTriggerRef} className={`!h-8 !min-h-8 !w-fit max-w-48 !text-xs ${providerFilters.length ? '!rounded-r-none' : '!rounded-full'}`}><Select.Value className="truncate">{() => providerLabel}</Select.Value><Select.Indicator /></Select.Trigger>
            <Select.Popover className="w-60" placement="bottom start"><ListBox aria-label="提供商列表">
              <ListBox.Item id="all" textValue="全部提供商">全部提供商<ListBox.ItemIndicator /></ListBox.Item>
              {providers.map(provider => <ListBox.Item id={provider.key} key={provider.key} textValue={provider.label} className="text-xs"><ModelProviderIcon provider={provider} size={16} /><span>{provider.label}</span><ListBox.ItemIndicator /></ListBox.Item>)}
            </ListBox></Select.Popover>
          </Select>
          {providerFilters.length > 0 && <Button aria-label="清空提供商筛选" className="!h-8 !min-h-8 !w-8 !min-w-8 !rounded-l-none !rounded-r-full p-0" size="sm" isIconOnly variant="tertiary" onPress={() => { setProviderFilters([]); providerTriggerRef.current?.focus(); }}><ButtonGroup.Separator /><Xmark className="size-3.5" /></Button>}
        </ButtonGroup>
        <Select aria-label="模型价格排序" value={sortKey} variant="secondary" onChange={key => {
          const choice = SORT_CHOICES.find(option => option.key === key);
          if (choice) updateSort({ column: choice.column, direction: choice.direction });
        }} className="min-w-0 max-w-48 text-xs">
          <Label className="sr-only">模型价格排序</Label>
          <Select.Trigger className="!h-8 !min-h-8 !w-fit !text-xs"><Select.Value>{() => SORT_CHOICES.find(choice => choice.key === sortKey)?.text}</Select.Value><Select.Indicator /></Select.Trigger>
          <Select.Popover className="w-56 max-h-80" placement="bottom start"><ListBox aria-label="排序选项">{SORT_CHOICES.map(choice => <ListBox.Item id={choice.key} key={choice.key} textValue={choice.text} className="text-xs">{choice.text}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover>
        </Select>
        <Select aria-label="价格币种" value={currency} variant="secondary" onChange={key => { if (key === 'USD' || key === 'CNY') setCurrency(key); }} className="min-w-0 text-xs">
          <Label className="sr-only">价格币种</Label>
          <Select.Trigger className="!h-8 !min-h-8 !w-fit !text-xs"><Select.Value /><Select.Indicator /></Select.Trigger>
          <Select.Popover><ListBox aria-label="价格币种选项"><ListBox.Item id="USD" textValue="USD">USD · 美元<ListBox.ItemIndicator /></ListBox.Item><ListBox.Item id="CNY" textValue="CNY">CNY · 人民币<ListBox.ItemIndicator /></ListBox.Item></ListBox></Select.Popover>
        </Select>
        <PricingMoreFilters filters={advancedFilters} onChange={setAdvancedFilters} currency={currency} exchangeRate={exchangeRate} exchangeStatus={exchangeStatus} onManualRate={setManualExchangeRate} onRefreshRate={() => { void refreshExchangeRate(); }} />
      </div>
      {hasFilters && <div className="flex shrink-0 flex-wrap items-center gap-1" aria-label="已选筛选条件">
        {query.trim() && <ActiveFilter label="搜索" onRemove={() => { setQuery(''); setDebouncedQuery(''); }}>搜索：{query.trim()}</ActiveFilter>}
        {providerFilters.map(key => <ActiveFilter key={key} label={providers.find(provider => provider.key === key)?.label ?? key} onRemove={() => setProviderFilters(providerFilters.filter(provider => provider !== key))}>{providers.find(provider => provider.key === key)?.label ?? key}</ActiveFilter>)}
        {advancedFilters.minContext > 0 && <ActiveFilter label="上下文" onRemove={() => setAdvancedFilters({ ...advancedFilters, minContext: 0 })}>上下文 ≥ {formatContextWindow(advancedFilters.minContext)}</ActiveFilter>}
        {(advancedFilters.releasedAfter || advancedFilters.releasedBefore) && <ActiveFilter label="发布时间" onRemove={() => setAdvancedFilters({ ...advancedFilters, releasedAfter: '', releasedBefore: '' })}>发布：{advancedFilters.releasedAfter || '不限'} ～ {advancedFilters.releasedBefore || '不限'}</ActiveFilter>}
        <Button className="!h-6 !min-h-6 !px-2 !text-[11px]" variant="tertiary" size="sm" onPress={clearFilters}>清空</Button>
      </div>}
      {catalog && !loading && <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span role="status" aria-live="polite">{rows.length} / {directModels.length} 条定价记录</span>
        {sort.column === 'usage' && <span>{usageStatus === 'loading' ? '用量加载中，暂按最新旗舰排序' : usageStatus === 'error' ? '用量暂不可用，暂按最新旗舰排序' : hasUsage ? '近 30 天 · 按 Token 用量排序' : '暂无近 30 天可匹配用量，暂按最新旗舰排序'}</span>}
        {sort.column === 'latest' && <span>主推型号优先 · 按发布日期排序</span>}
        <span>{catalog.source === 'bundled' ? '内置价格表' : '已发布价格表'} · {catalog.generatedAt ? '生成于' : '文件更新于'} {dateLabel}</span>
        <span>来源：<a className="underline underline-offset-2" href="https://models.dev" target="_blank" rel="noreferrer">models.dev</a> 与人工补充</span>
      </div>}
      {currency === 'CNY' && <div className="shrink-0 text-[11px] text-muted" role="status" aria-live="polite">
        {exchangeRate ? <>$1 = ¥{exchangeRate.rate} · {exchangeRate.source === 'manual' ? '手动汇率' : <><a className="underline underline-offset-2" href="https://frankfurter.dev" target="_blank" rel="noreferrer">Frankfurter</a> · {exchangeRate.date}</>}{exchangeStatus === 'loading' ? ' · 更新中' : exchangeStatus === 'error' ? ' · 自动更新失败，保留当前汇率' : ''}</>
          : exchangeStatus === 'loading' ? '正在获取 USD/CNY 参考汇率…' : '汇率暂不可用，请在“更多筛选”中重试或手动设置'}
      </div>}
      {loading ? <div aria-label="模型价格加载中" className="min-h-0 flex-1 space-y-3 overflow-hidden">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
        : error ? <div className="flex flex-1 flex-col items-center justify-center gap-4"><StatusBanner tone="error" title="模型价格加载失败" description={error} /><Button variant="outline" onPress={() => setRetry(value => value + 1)}>重试</Button></div>
          : <PricingList key={`${providerFilters.join(',')}:${debouncedQuery}:${sortKey}:${JSON.stringify(advancedFilters)}`} rows={rows} sort={sort} hasUsage={hasUsage} onSortChange={updateSort} currency={currency} exchangeRate={exchangeRate?.rate ?? null} />}
      <p className="shrink-0 text-[11px] text-muted">所有价格均按百万 Token 计 · {currency === 'USD' ? '$0' : '¥0'} 表示零价，— 表示未提供定价{currency === 'CNY' ? '或汇率暂不可用 · 人民币为参考换算' : ''}</p>
    </section>
  );
}
