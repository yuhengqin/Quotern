import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Label,
  ListBox,
  ListLayout,
  SearchField,
  Select,
  Skeleton,
  Table,
  TableLayout,
  Virtualizer,
  type SortDescriptor,
} from '@heroui/react';
import { ModelProviderIcon } from '@/components/ModelProviderIcon';
import { StatusBanner } from '@/components/StatusBanner';
import {
  fetchPricingCatalog,
  type PricingCatalogResponse,
} from '@/lib/api';
import { getModelProvider } from '@/lib/model-provider';
import {
  DEFAULT_PRICING_SORT,
  filterAndSortPricingCatalog,
  filterDirectPricingCatalog,
  getPricingModelName,
  type PricingSortDescriptor,
  type PricingSortKey,
} from '@/lib/pricing-catalog';

const FILTER_CONTROL_HEIGHT = '!h-8 !min-h-8';
const SEARCH_DEBOUNCE_MS = 160;
const TABLE_HEADER_HEIGHT = 32;
const TABLE_COLUMN_WIDTHS = {
  // Percentages keep the three-column grid aligned on narrow screens while
  // still giving the price columns predictable space on desktop.
  inputOutput: '24%',
  cache: '18%',
  modelMin: 104,
} as const;

const TABLE_COLUMN_MIN_WIDTHS = {
  inputOutput: 112,
  cache: 96,
} as const;

const SORTABLE_COLUMNS: ReadonlySet<PricingSortKey> = new Set([
  'model',
  'inputOutput',
  'cache',
]);

function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  return `$${new Intl.NumberFormat('en-US', {
    maximumSignificantDigits: 6,
  }).format(value)}`;
}

function ModelSearchField({ onQueryChange }: { onQueryChange: (value: string) => void }) {
  const [value, setValue] = useState('');

  useEffect(() => {
    const timeoutId = window.setTimeout(() => onQueryChange(value), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [onQueryChange, value]);

  return (
    <SearchField
      className="min-w-0 flex-1 text-xs sm:max-w-80"
      variant="secondary"
      onChange={setValue}
    >
      <Label className="sr-only">模糊查询模型</Label>
      <SearchField.Group
        className={`${FILTER_CONTROL_HEIGHT} focus-within:!border-border focus-within:!outline-none focus-within:!ring-0 focus-within:!shadow-none`}
      >
        <SearchField.SearchIcon />
        <SearchField.Input className="!text-xs" placeholder="模糊查询模型" />
        <SearchField.ClearButton />
      </SearchField.Group>
    </SearchField>
  );
}

function PricingTableSkeleton() {
  return (
    <section className="space-y-3">
      <div aria-label="价格筛选条件" className="flex min-w-0 flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-full rounded-xl sm:w-80" />
        <Skeleton className="h-8 w-28 rounded-xl" />
      </div>
      <div aria-label="模型价格加载中" className="space-y-3">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton className="h-11 w-full rounded-lg" key={index} />
        ))}
      </div>
    </section>
  );
}

function getProviderOptionKey(provider: ReturnType<typeof getModelProvider>): string {
  return `${provider.icon}:${provider.label.toLocaleLowerCase()}`;
}

function ProviderSelect({
  onChange,
  options,
  value,
}: {
  onChange: (value: string | null) => void;
  options: readonly ReturnType<typeof getModelProvider>[];
  value: string;
}) {
  const selected = options.find((provider) => provider.key === value);

  return (
    <Select
      aria-label="供应商筛选"
      className="min-w-0 max-w-36 shrink-0 text-xs sm:max-w-52"
      value={value || 'all'}
      variant="secondary"
      onChange={(key) => {
        onChange(key == null || Array.isArray(key) ? null : String(key));
      }}
    >
      <Label className="sr-only">供应商筛选</Label>
      <Select.Trigger
        className={`${FILTER_CONTROL_HEIGHT} !w-fit max-w-36 items-center leading-none ps-2.5 pe-7 !text-xs font-normal sm:max-w-52 sm:ps-3 sm:pe-8`}
      >
        <Select.Value className="min-w-0 max-w-24 !text-xs sm:max-w-40">
          {() =>
            selected ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <ModelProviderIcon provider={selected} size={14} />
                <span className="truncate">{selected.label}</span>
              </span>
            ) : (
              '全部供应商'
            )
          }
        </Select.Value>
        <Select.Indicator className="size-3.5 text-muted" />
      </Select.Trigger>
      <Select.Popover className="w-52 rounded-xl bg-surface shadow-md" placement="bottom start">
        <ListBox aria-label="供应商列表">
          <ListBox.Item id="all" textValue="全部供应商">
            全部供应商
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {options.map((provider) => (
            <ListBox.Item
              className="gap-2! rounded-lg px-1.5 py-1 text-xs"
              id={provider.key}
              key={provider.key}
              textValue={provider.label}
            >
              <span className="flex size-5 shrink-0 items-center justify-center">
                <ModelProviderIcon provider={provider} size={14} />
              </span>
              <span className="min-w-0 flex-1 truncate">{provider.label}</span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 639px)');
    const handleChange = () => setIsMobile(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return isMobile;
}

function MobilePricingList({ rows }: { rows: PricingCatalogResponse['models'] }) {
  if (rows.length === 0) {
    return (
      <div className="flex h-[calc(100vh-145px)] min-h-48 flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm font-medium">没有匹配的模型</p>
        <p className="text-xs text-muted">请尝试其他关键词</p>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden pb-2">
      <Virtualizer
        layout={ListLayout}
        layoutOptions={{ gap: 4, rowHeight: 132 }}
      >
        <ListBox
          aria-label="模型价格列表"
          className="box-border h-[calc(100vh-145px)] w-full min-w-0 max-w-full overflow-x-hidden overflow-y-auto !p-0"
          items={rows}
          selectionMode="none"
        >
        {(row) => {
          const provider = getModelProvider(row.model);

          return (
            <ListBox.Item
              className="box-border !h-[128px] !min-h-0 !w-full min-w-0 max-w-full !items-stretch rounded-xl border border-border/70 bg-surface !p-3 shadow-[rgba(0,0,0,0.08)_0px_1px_4px,rgba(0,0,0,0.04)_0px_0px_0px_1px] outline-none data-[focus-visible=true]:border-border data-[hovered=true]:bg-surface-secondary"
              id={row.model}
              textValue={`${getPricingModelName(row.model)} ${row.model}`}
            >
              <div className="flex min-w-0 flex-1 flex-col justify-between">
                <div className="flex h-9 min-w-0 shrink-0 items-center gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-surface-secondary">
                    <ModelProviderIcon provider={provider} size={20} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-sm font-medium text-foreground">
                      {getPricingModelName(row.model)}
                    </span>
                    {row.model.includes('/') ? (
                      <span className="block truncate text-xs text-muted" title={row.model}>
                        {row.model}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="grid min-w-0 grid-cols-2 gap-x-2 gap-y-1 border-t border-border/60 pt-2">
                  <span className="inline-flex items-baseline gap-1 whitespace-nowrap text-xs tabular-nums">
                    <span className="text-xs text-muted">输入</span>
                    <span>{formatPrice(row.input)}</span>
                    <span className="text-xs text-muted">/M</span>
                  </span>
                  <span className="inline-flex items-baseline gap-1 whitespace-nowrap text-xs tabular-nums">
                    <span className="text-xs text-muted">输出</span>
                    <span>{formatPrice(row.output)}</span>
                    <span className="text-xs text-muted">/M</span>
                  </span>
                  <span className="inline-flex items-baseline gap-1 whitespace-nowrap text-xs tabular-nums">
                    <span className="text-xs text-muted">缓存读</span>
                    <span>{row.cacheRead > 0 ? formatPrice(row.cacheRead) : '-'}</span>
                    <span className="text-xs text-muted">/M</span>
                  </span>
                  <span className="inline-flex items-baseline gap-1 whitespace-nowrap text-xs tabular-nums">
                    <span className="text-xs text-muted">缓存写</span>
                    <span>{row.cacheWrite > 0 ? formatPrice(row.cacheWrite) : '-'}</span>
                    <span className="text-xs text-muted">/M</span>
                  </span>
                </div>
              </div>
            </ListBox.Item>
          );
        }}
        </ListBox>
      </Virtualizer>
    </div>
  );
}

const MOBILE_SORT_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'inputOutput:descending', label: '输入价格：从高到低' },
  { key: 'inputOutput:ascending', label: '输入价格：从低到高' },
  { key: 'model:ascending', label: '模型名称：A → Z' },
  { key: 'model:descending', label: '模型名称：Z → A' },
  { key: 'cache:descending', label: '缓存价格：从高到低' },
  { key: 'cache:ascending', label: '缓存价格：从低到高' },
];

function MobileSortSelect({
  onChange,
  value,
}: {
  onChange: (sort: PricingSortDescriptor) => void;
  value: PricingSortDescriptor;
}) {
  const selectedKey = `${value.column}:${value.direction}`;
  return (
    <Select
      aria-label="模型价格排序"
      className="min-w-0 max-w-[9rem] shrink-0 text-xs sm:hidden"
      value={selectedKey}
      variant="secondary"
      onChange={(key) => {
        if (key == null || Array.isArray(key)) return;
        const [column, direction] = String(key).split(':');
        if (!SORTABLE_COLUMNS.has(column as PricingSortKey)) return;
        if (direction !== 'ascending' && direction !== 'descending') return;
        onChange({
          column: column as PricingSortKey,
          direction,
        });
      }}
    >
      <Label className="sr-only">模型价格排序</Label>
      <Select.Trigger className={`${FILTER_CONTROL_HEIGHT} !w-fit max-w-[9rem] ps-2.5 pe-7 !text-xs`}>
        <Select.Value className="truncate !text-xs">
          {() => MOBILE_SORT_OPTIONS.find((option) => option.key === selectedKey)?.label ?? '排序'}
        </Select.Value>
        <Select.Indicator className="size-3.5 text-muted" />
      </Select.Trigger>
      <Select.Popover className="w-52 rounded-xl bg-surface shadow-md" placement="bottom start">
        <ListBox aria-label="模型价格排序选项">
          {MOBILE_SORT_OPTIONS.map((option) => (
            <ListBox.Item id={option.key} key={option.key} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function PricingPage() {
  const [catalog, setCatalog] = useState<PricingCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const [query, setQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [sortDescriptor, setSortDescriptor] = useState(DEFAULT_PRICING_SORT);
  const isMobile = useIsMobile();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchPricingCatalog()
      .then((data) => {
        if (!cancelled) {
          setCatalog(data);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setCatalog(null);
          setError(reason instanceof Error ? reason.message : '模型价格加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [retryVersion]);

  const directModels = useMemo(
    () => filterDirectPricingCatalog(catalog?.models ?? []),
    [catalog?.models],
  );

  const providerOptions = useMemo(() => {
    const providers = new Map<string, ReturnType<typeof getModelProvider>>();
    for (const row of directModels) {
      const provider = getModelProvider(row.model);
      const optionKey = getProviderOptionKey(provider);
      if (!providers.has(optionKey)) {
        providers.set(optionKey, { ...provider, key: optionKey });
      }
    }

    return [...providers.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [directModels]);

  const rows = useMemo(
    () =>
      filterAndSortPricingCatalog(directModels, query, sortDescriptor).filter((row) => {
        if (!providerFilter) return true;
        return getProviderOptionKey(getModelProvider(row.model)) === providerFilter;
      }),
    [directModels, providerFilter, query, sortDescriptor],
  );
  const handleSortChange = (next: SortDescriptor) => {
    if (!SORTABLE_COLUMNS.has(next.column as PricingSortKey)) return;
    setSortDescriptor({
      column: next.column as PricingSortKey,
      direction: next.direction,
    });
  };

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
  }, []);

  const handleProviderChange = (key: string | null) => {
    setProviderFilter(key == null || key === 'all' ? '' : key);
  };

  if (loading) return <PricingTableSkeleton />;

  if (error) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-5 text-center">
        <StatusBanner description={error} title="模型价格加载失败" tone="error" />
        <Button onPress={() => setRetryVersion((value) => value + 1)} variant="outline">
          重试
        </Button>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div
        aria-label="价格筛选条件"
        className="flex w-full min-w-0 flex-wrap items-center gap-2"
      >
        <ModelSearchField onQueryChange={handleQueryChange} />
        <ProviderSelect
          options={providerOptions}
          value={providerFilter}
          onChange={handleProviderChange}
        />
        <MobileSortSelect onChange={setSortDescriptor} value={sortDescriptor} />
      </div>

      {isMobile ? <MobilePricingList rows={rows} /> : <Virtualizer
        layout={TableLayout}
        layoutOptions={{
          headingHeight: TABLE_HEADER_HEIGHT,
          rowHeight: 68,
        }}
      >
        <Table className="table-size-small w-full min-w-0">
          <Table.ScrollContainer className="min-w-0 overflow-x-hidden">
            <Table.Content
              aria-label="模型价格表"
              className="h-[calc(100vh-145px)] w-full min-w-0 overflow-x-hidden overflow-y-auto"
              sortDescriptor={sortDescriptor}
              onSortChange={handleSortChange}
            >
              <Table.Header className="h-8 w-full">
                <Table.Column
                  allowsSorting
                  className="align-middle px-1.5! py-2! sm:px-3!"
                  defaultWidth="1fr"
                  id="model"
                  isRowHeader
                  minWidth={TABLE_COLUMN_WIDTHS.modelMin}
                >
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader className="h-full !gap-1 items-center" sortDirection={sortDirection}>
                      模型
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                <Table.Column
                  allowsSorting
                  defaultWidth={TABLE_COLUMN_WIDTHS.inputOutput}
                  id="inputOutput"
                  minWidth={TABLE_COLUMN_MIN_WIDTHS.inputOutput}
                  className="align-middle !min-w-0 !px-1.5 !py-2 sm:!px-3"
                >
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader className="h-full !gap-1 items-center" sortDirection={sortDirection}>
                      输入 / 输出
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                <Table.Column
                  allowsSorting
                  className="align-middle !min-w-0 !px-1.5 !py-2 sm:!px-3"
                  defaultWidth={TABLE_COLUMN_WIDTHS.cache}
                  id="cache"
                  minWidth={TABLE_COLUMN_MIN_WIDTHS.cache}
                >
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader className="h-full !gap-1 items-center" sortDirection={sortDirection}>
                      缓存
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
              </Table.Header>
              <Table.Body
                items={rows}
                renderEmptyState={() => (
                  <div className="flex min-h-48 flex-col items-center justify-center gap-1 text-center">
                    <p className="text-sm font-medium">没有匹配的模型</p>
                    <p className="text-xs text-muted">请尝试其他关键词</p>
                  </div>
                )}
              >
                {(row) => {
                  const provider = getModelProvider(row.model);

                  return (
                    <Table.Row id={row.model}>
                      <Table.Cell>
                        <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-surface/70 sm:size-9">
                            <ModelProviderIcon provider={provider} size={20} />
                          </span>
                          <span className="min-w-0">
                            <span
                              className="block truncate font-mono text-sm font-medium text-foreground"
                              title={row.model}
                            >
                              {getPricingModelName(row.model)}
                            </span>
                            {row.model.includes('/') ? (
                              <span className="mt-0.5 block truncate text-xs text-muted" title={row.model}>
                                {row.model}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex flex-col items-start gap-1.5">
                          <span className="inline-flex items-baseline gap-1 whitespace-nowrap text-sm tabular-nums">
                            <span className="text-xs text-muted">输入</span>
                            <span>{formatPrice(row.input)}</span>
                            <span className="text-xs text-muted">/M</span>
                          </span>
                          <span className="inline-flex items-baseline gap-1 whitespace-nowrap text-sm tabular-nums">
                            <span className="text-xs text-muted">输出</span>
                            <span>{formatPrice(row.output)}</span>
                            <span className="text-xs text-muted">/M</span>
                          </span>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex flex-col items-start gap-1.5">
                          <span className="inline-flex items-baseline gap-1 whitespace-nowrap text-sm tabular-nums">
                            <span className="text-xs text-muted">缓存读</span>
                            <span>{row.cacheRead > 0 ? formatPrice(row.cacheRead) : '-'}</span>
                            <span className="text-xs text-muted">/M</span>
                          </span>
                          <span className="inline-flex items-baseline gap-1 whitespace-nowrap text-sm tabular-nums">
                            <span className="text-xs text-muted">缓存写</span>
                            <span>{row.cacheWrite > 0 ? formatPrice(row.cacheWrite) : '-'}</span>
                            <span className="text-xs text-muted">/M</span>
                          </span>
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  );
                }}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Virtualizer>}
    </section>
  );
}
