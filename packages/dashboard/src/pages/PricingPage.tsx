import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { ArrowLeft, Xmark } from '@gravity-ui/icons';
import { Button, ButtonGroup, Label, ListBox, ListLayout, SearchField, Select, Skeleton, Table, TableLayout, Virtualizer } from '@heroui/react';
import { ModelProviderIcon } from '../components/ModelProviderIcon';
import { StatusBanner } from '../components/StatusBanner';
import { fetchModelBreakdown } from '../lib/api';
import { fetchPricingCatalog, type PricingCatalogResponse, type PricingCatalogRow } from '../lib/pricing-data';
import {
  addPricingUsage, filterAndSortPricingCatalog, filterDirectPricingCatalog,
  formatPricingRate, getPricingChannel, getPricingModelName, getPricingProvider,
  readPricingSort, writePricingSort, PRICING_SORT_OPTIONS,
  type PricingSortDescriptor, type PricingSortKey,
} from '../lib/pricing-catalog';

const SORT_CHOICES = PRICING_SORT_OPTIONS.map((option) => {
  const [column, direction] = option.key.split(':') as [PricingSortKey, 'ascending' | 'descending'];
  return { column, direction, key: option.key, text: option.label };
});

function ModelIdentity({ row, sort, hasUsage }: { row: PricingCatalogRow; sort: PricingSortDescriptor; hasUsage: boolean }) {
  const { model } = row;
  const provider = getPricingProvider(model);
  const channel = getPricingChannel(model);
  return (
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-surface">
        <ModelProviderIcon provider={provider} size={20} />
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-sm font-medium" title={model}>{getPricingModelName(model)}</span>
          {channel && <span className="shrink-0 rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] text-muted">{channel}</span>}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted" title={model}>{model}</p>
        {sort.column === 'usage' && hasUsage
          ? <p className="text-[10px] text-muted">近 30 天 {row.usageTokens?.toLocaleString('zh-CN') ?? 0} Token</p>
          : sort.column === 'latest' && (row.featured || row.releaseDate)
            ? <p className="text-[10px] text-muted">{row.featured ? '主推 · ' : ''}{row.releaseDate ?? '发布日期未收录'}</p>
            : null}
      </div>
    </div>
  );
}

function PricePair({ row, cache = false }: { row: PricingCatalogRow; cache?: boolean }) {
  return (
    <div className="grid w-fit grid-cols-[2.5rem_minmax(9ch,max-content)] items-baseline gap-x-2 gap-y-1.5 whitespace-nowrap text-xs tabular-nums sm:text-sm">
      <span className="text-xs text-muted">{cache ? '缓存读' : '输入'}</span>
      <span className="text-left font-mono">{formatPricingRate(cache ? row.cacheRead : row.input)}</span>
      <span className="text-xs text-muted">{cache ? '缓存写' : '输出'}</span>
      <span className="text-left font-mono">{formatPricingRate(cache ? row.cacheWrite : row.output)}</span>
    </div>
  );
}

function PricingList({ rows, sort, hasUsage }: { rows: PricingCatalogRow[]; sort: PricingSortDescriptor; hasUsage: boolean }) {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 639px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  if (rows.length === 0) return (
    <div className="flex min-h-48 flex-1 flex-col items-center justify-center gap-1 text-center">
      <p className="text-sm font-medium">没有匹配的模型</p>
      <p className="text-xs text-muted">请尝试其他关键词或提供商</p>
    </div>
  );

  if (isMobile) return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <Virtualizer layout={ListLayout} layoutOptions={{ gap: 8, rowHeight: 132 }}>
        <ListBox aria-label="模型价格列表" className="h-full overflow-x-hidden overflow-y-auto !p-0" items={rows} selectionMode="none">
          {(row) => (
            <ListBox.Item id={row.model} textValue={row.model} className="!h-[124px] !items-stretch rounded-xl border border-border/70 bg-surface !p-3">
              <div className="flex min-w-0 flex-1 flex-col justify-between">
                <ModelIdentity row={row} sort={sort} hasUsage={hasUsage} />
                <div className="grid grid-cols-2 gap-5 border-t border-border/60 pt-2">
                  <PricePair row={row} /><PricePair row={row} cache />
                </div>
              </div>
            </ListBox.Item>
          )}
        </ListBox>
      </Virtualizer>
    </div>
  );

  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/60">
      <Virtualizer layout={TableLayout} layoutOptions={{ headingHeight: 36, rowHeight: 72 }}>
        <Table className="table-size-small h-full w-full">
          <Table.ScrollContainer className="h-full min-w-0">
            <Table.Content aria-label="模型价格表" className="h-full w-full overflow-y-auto">
              <Table.Header>
                {/* Virtualized header rows have no layout height; fill each visible column. */}
                <Table.Column className="bg-surface-secondary" id="model" isRowHeader defaultWidth="1fr" minWidth={180}>模型</Table.Column>
                <Table.Column className="bg-surface-secondary" id="inputOutput" defaultWidth="24%" minWidth={160}>输入 / 输出</Table.Column>
                <Table.Column className="bg-surface-secondary" id="cache" defaultWidth="24%" minWidth={160}>缓存</Table.Column>
              </Table.Header>
              <Table.Body items={rows}>
                {(row) => (
                  <Table.Row id={row.model}>
                    <Table.Cell><ModelIdentity row={row} sort={sort} hasUsage={hasUsage} /></Table.Cell>
                    <Table.Cell><PricePair row={row} /></Table.Cell>
                    <Table.Cell><PricePair row={row} cache /></Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Virtualizer>
    </div>
  );
}

export function PricingPage() {
  const search = useSearch({ strict: false }) as { q?: string };
  const initialQuery = typeof search.q === 'string' ? search.q : '';
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [providerFilters, setProviderFilters] = useState<string[]>([]);
  const providerTriggerRef = useRef<HTMLButtonElement>(null);
  const [sort, setSort] = useState<PricingSortDescriptor>(readPricingSort);
  const [catalog, setCatalog] = useState<PricingCatalogResponse | null>(null);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof fetchModelBreakdown>>['models']>([]);
  const [usageStatus, setUsageStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => { setQuery(initialQuery); }, [initialQuery]);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 160);
    return () => window.clearTimeout(timeout);
  }, [query]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchPricingCatalog().then((data) => {
      if (!cancelled) setCatalog(data);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : '模型价格加载失败');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [retry]);

  useEffect(() => {
    let cancelled = false;
    setUsageStatus('loading');
    void fetchModelBreakdown(30).then((data) => {
      if (!cancelled) { setUsage(data.models); setUsageStatus('ready'); }
    }).catch(() => {
      if (!cancelled) { setUsage([]); setUsageStatus('error'); }
    });
    return () => { cancelled = true; };
  }, [retry]);

  const directModels = useMemo(() => addPricingUsage(filterDirectPricingCatalog(catalog?.models ?? []), usage, catalog?.matching), [catalog, usage]);
  const hasUsage = directModels.some((row) => (row.usageTokens ?? 0) > 0);
  const updateSort = (next: PricingSortDescriptor) => {
    setSort(next);
    writePricingSort(next);
  };
  const providers = useMemo(() => {
    const unique = new Map<string, ReturnType<typeof getPricingProvider>>();
    for (const row of directModels) {
      const provider = getPricingProvider(row.model);
      unique.set(provider.key, provider);
    }
    return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [directModels]);
  const rows = useMemo(() => filterAndSortPricingCatalog(directModels, debouncedQuery, sort)
    .filter((row) => providerFilters.length === 0 || providerFilters.includes(getPricingProvider(row.model).key)),
  [directModels, debouncedQuery, sort, providerFilters]);
  const updatedAt = catalog?.generatedAt ?? catalog?.updatedAt;
  const dateLabel = updatedAt && Number.isFinite(Date.parse(updatedAt))
    ? new Date(updatedAt).toISOString().slice(0, 10) : '未知';
  const providerLabel = providerFilters.length > 1 ? `已选 ${providerFilters.length} 家提供商`
    : providers.find((provider) => provider.key === providerFilters[0])?.label ?? '全部提供商';
  const sortKey = `${sort.column}:${sort.direction}`;

  return (
    <section className="flex h-[calc(100dvh-7rem)] min-h-96 flex-col gap-4">
      <header className="flex shrink-0 items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">模型价格</h1>
          <p className="mt-1 text-xs text-muted">API 参考价 · USD / 百万 Token</p>
        </div>
        <Link to="/dashboard" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-muted hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent">
          <ArrowLeft className="size-3.5" />返回用量
        </Link>
      </header>

      <div aria-label="价格筛选条件" className="flex shrink-0 flex-wrap items-center gap-2">
        <SearchField aria-label="搜索模型名称或 ID" value={query} onChange={setQuery} variant="secondary" className="min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-80">
          <Label className="sr-only">搜索模型名称或 ID</Label>
          <SearchField.Group className="!h-8 !min-h-8">
            <SearchField.SearchIcon /><SearchField.Input className="!text-xs" placeholder="搜索模型名称或 ID" /><SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <ButtonGroup className="shrink-0">
          <Select aria-label="提供商筛选" selectionMode="multiple" value={providerFilters.length ? providerFilters : ['all']} variant="secondary" onChange={(keys) => {
            if (Array.isArray(keys)) setProviderFilters(keys.includes('all') && providerFilters.length > 0
              ? [] : keys.filter((key) => key !== 'all').map(String));
          }} className="min-w-0 max-w-52 text-xs">
            <Label className="sr-only">提供商筛选</Label>
            <Select.Trigger ref={providerTriggerRef} className={`!h-8 !min-h-8 !w-fit max-w-52 !text-xs ${providerFilters.length ? '!rounded-r-none' : '!rounded-full'}`}>
              <Select.Value className="truncate">{() => providerLabel}</Select.Value><Select.Indicator />
            </Select.Trigger>
            <Select.Popover className="w-60" placement="bottom start">
              <ListBox aria-label="提供商列表">
                <ListBox.Item id="all" textValue="全部提供商">全部提供商<ListBox.ItemIndicator /></ListBox.Item>
                {providers.map((provider) => (
                  <ListBox.Item id={provider.key} key={provider.key} textValue={provider.label} className="text-xs">
                    <ModelProviderIcon provider={provider} size={16} /><span>{provider.label}</span><ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          {providerFilters.length > 0 && <Button
            aria-label="清空提供商筛选"
            className="!h-8 !min-h-8 !w-8 !min-w-8 !rounded-l-none !rounded-r-full p-0"
            size="sm"
            isIconOnly
            variant="tertiary"
            onPress={() => {
              setProviderFilters([]);
              providerTriggerRef.current?.focus();
            }}
          >
            <ButtonGroup.Separator /><Xmark className="size-3.5" />
          </Button>}
        </ButtonGroup>
        <Select aria-label="模型价格排序" value={sortKey} variant="secondary" onChange={(key) => {
          const choice = SORT_CHOICES.find((option) => option.key === key);
          if (choice) updateSort({ column: choice.column, direction: choice.direction });
        }} className="min-w-0 max-w-52 text-xs">
          <Label className="sr-only">模型价格排序</Label>
          <Select.Trigger className="!h-8 !min-h-8 !w-fit !text-xs">
            <Select.Value>{() => SORT_CHOICES.find((choice) => choice.key === sortKey)?.text}</Select.Value><Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="w-56" placement="bottom start">
            <ListBox aria-label="排序选项">{SORT_CHOICES.map((choice) => (
              <ListBox.Item id={choice.key} key={choice.key} textValue={choice.text} className="text-xs">{choice.text}<ListBox.ItemIndicator /></ListBox.Item>
            ))}</ListBox>
          </Select.Popover>
        </Select>
      </div>

      {catalog && !loading && <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span role="status">{rows.length} / {directModels.length} 条定价记录</span>
        {sort.column === 'usage' && <span>{usageStatus === 'loading' ? '用量加载中，暂按最新旗舰排序'
          : usageStatus === 'error' ? '用量暂不可用，暂按最新旗舰排序'
            : hasUsage ? '近 30 天 · 按 Token 用量排序' : '暂无近 30 天可匹配用量，暂按最新旗舰排序'}</span>}
        {sort.column === 'latest' && <span>主推型号优先 · 按发布日期排序</span>}
        <span>{catalog.source === 'bundled' ? '内置价格表' : '已发布价格表'} · 更新于 {dateLabel}</span>
        <span>来源：<a className="underline underline-offset-2" href="https://models.dev" target="_blank" rel="noreferrer">models.dev</a> 与人工补充</span>
      </div>}

      {loading ? <div aria-label="模型价格加载中" className="min-h-0 flex-1 space-y-3 overflow-hidden">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
        : error ? <div className="flex flex-1 flex-col items-center justify-center gap-4"><StatusBanner tone="error" title="模型价格加载失败" description={error} /><Button variant="outline" onPress={() => setRetry((value) => value + 1)}>重试</Button></div>
          : <PricingList key={`${providerFilters.join(',')}:${debouncedQuery}:${sortKey}`} rows={rows} sort={sort} hasUsage={hasUsage} />}
      <p className="shrink-0 text-[11px] text-muted">用于估算 Token 费用 · $0 表示零价，— 表示未提供定价</p>
    </section>
  );
}
