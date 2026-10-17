import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { ArrowLeft, Xmark } from '@gravity-ui/icons';
import { Check, Columns2, Info } from 'lucide-react';
import { Button, Label, ListBox, Popover, SearchField, Select, Skeleton } from '@heroui/react';
import { PricingList } from '../components/PricingList';
import { PricingCalculator, PricingProviderFilter, PricingSortSelect, formatPricingScenario } from '../components/PricingTools';
import { PricingComparison } from '../components/PricingComparison';
import { PricingMoreFilters, EMPTY_PRICING_FILTERS, type PricingAdvancedFilters } from '../components/PricingMoreFilters';
import { StatusBanner } from '../components/StatusBanner';
import { usePricingCurrency } from '../hooks/usePricingCurrency';
import { fetchModelBreakdown, type ModelBreakdownRow } from '../lib/api';
import { fetchPricingCatalog, type PricingCatalogResponse } from '../lib/pricing-data';
import { filterPricingCatalog, formatContextWindow } from '../lib/pricing-filters';
import { filterAndSortPricingGroups, getPrimaryPricingVariant, groupPricingCatalog } from '../lib/pricing-groups';
import {
  addPricingUsage, filterDirectPricingCatalog, getPricingModelName, getPricingProvider,
  DEFAULT_PRICING_SORT,
  type PricingSortDescriptor,
} from '../lib/pricing-catalog';
import { DEFAULT_PRICING_SCENARIO, MAX_COMPARISON_MODELS, togglePricingComparison } from '../lib/pricing-workbench';

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
  const [sort, setSort] = useState<PricingSortDescriptor>(DEFAULT_PRICING_SORT);
  const [usedOnly, setUsedOnly] = useState(false);
  const [scenario, setScenario] = useState(DEFAULT_PRICING_SCENARIO);
  const [estimateEnabled, setEstimateEnabled] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<Record<string, string>>({});
  const [comparisonOpen, setComparisonOpen] = useState(false);
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
  const providers = useMemo(() => {
    const unique = new Map<string, ReturnType<typeof getPricingProvider>>();
    for (const row of directModels) {
      const provider = getPricingProvider(row.model);
      unique.set(provider.key, provider);
    }
    return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [directModels]);
  const modelGroups = useMemo(() => groupPricingCatalog(directModels), [directModels]);
  const groups = useMemo(() => filterAndSortPricingGroups(groupPricingCatalog(filterPricingCatalog(directModels, { ...advancedFilters, providers: providerFilters })), debouncedQuery, sort, usedOnly), [directModels, debouncedQuery, sort, providerFilters, advancedFilters, usedOnly]);
  const selectedGroups = useMemo(() => selected.flatMap(id => modelGroups.find(group => group.id === id) ?? []), [selected, modelGroups]);
  const toggleComparison = (id: string) => {
    const group = groups.find(item => item.id === id);
    if (!selected.includes(id) && selected.length < MAX_COMPARISON_MODELS && group) {
      setSelectedChannels(current => ({ ...current, [id]: getPrimaryPricingVariant(group).id }));
    }
    setSelected(current => togglePricingComparison(current, id));
  };
  const channelCount = groups.reduce((sum, group) => sum + group.entries.length, 0);
  const hasFilterChips = Boolean(query.trim() || providerFilters.length > 1 || advancedFilters.minContext || advancedFilters.releasedAfter || advancedFilters.releasedBefore || usedOnly);
  const clearFilters = () => { setQuery(''); setDebouncedQuery(''); setProviderFilters([]); setAdvancedFilters(EMPTY_PRICING_FILTERS); setUsedOnly(false); };
  const sortKey = `${sort.column}:${sort.direction}`;
  const tableTimestamp = catalog?.generatedAt ?? catalog?.updatedAt;
  const dateLabel = tableTimestamp && Number.isFinite(Date.parse(tableTimestamp)) ? new Date(tableTimestamp).toLocaleString('zh-CN', { hour12: false }) : '未知';
  const shortDateLabel = tableTimestamp && Number.isFinite(Date.parse(tableTimestamp)) ? new Date(tableTimestamp).toLocaleDateString('zh-CN') : '未知';

  return (
    <section className="flex h-[calc(100dvh-5rem)] min-h-0 min-w-0 flex-col gap-3">
      <header className="flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0"><h1 className="text-xl font-semibold">模型价格</h1><p className="mt-1 text-xs text-muted">API 参考价 · {currency} / 百万 Token</p></div>
        <Link to="/dashboard" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-muted hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent"><ArrowLeft className="size-3.5" />返回用量</Link>
      </header>
      <div aria-label="价格筛选条件" className="flex shrink-0 flex-wrap items-center gap-2">
        <SearchField aria-label="搜索模型名称或 ID" value={query} onChange={setQuery} variant="secondary" className="min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-72">
          <Label className="sr-only">搜索模型名称或 ID</Label>
          <SearchField.Group className="!h-8 !min-h-8"><SearchField.SearchIcon /><SearchField.Input className="!text-xs" placeholder="搜索模型名称或 ID" /><SearchField.ClearButton /></SearchField.Group>
        </SearchField>
        <PricingProviderFilter providers={providers} value={providerFilters} onChange={setProviderFilters} />
        <Select aria-label="价格币种" value={currency} variant="secondary" onChange={key => { if (key === 'USD' || key === 'CNY') setCurrency(key); }} className="min-w-0 text-xs">
          <Label className="sr-only">价格币种</Label>
          <Select.Trigger className="!h-8 !min-h-8 !w-fit !text-xs"><Select.Value /><Select.Indicator /></Select.Trigger>
          <Select.Popover><ListBox aria-label="价格币种选项"><ListBox.Item id="USD" textValue="USD">USD · 美元<ListBox.ItemIndicator /></ListBox.Item><ListBox.Item id="CNY" textValue="CNY">CNY · 人民币<ListBox.ItemIndicator /></ListBox.Item></ListBox></Select.Popover>
        </Select>
        <PricingSortSelect value={sort} onChange={setSort} />
        <Button aria-pressed={usedOnly} isDisabled={usageStatus !== 'ready'} onPress={() => setUsedOnly(value => !value)} size="sm" variant={usedOnly ? 'secondary' : 'tertiary'} className={`!h-8 !min-h-8 shrink-0 !gap-1 !px-3 !text-xs ${usedOnly ? 'text-accent' : ''}`}>
          {usedOnly && <Check className="size-3" aria-hidden />}近 30 天用过
        </Button>
        <PricingMoreFilters filters={advancedFilters} onChange={setAdvancedFilters} currency={currency} exchangeRate={exchangeRate} exchangeStatus={exchangeStatus} onManualRate={setManualExchangeRate} onRefreshRate={() => { void refreshExchangeRate(); }} />
        <PricingCalculator scenario={scenario} onChange={setScenario} enabled={estimateEnabled} onEnabledChange={setEstimateEnabled} />
      </div>
      {hasFilterChips && <div className="flex shrink-0 flex-wrap items-center gap-1" aria-label="已选筛选条件">
        {query.trim() && <ActiveFilter label="搜索" onRemove={() => { setQuery(''); setDebouncedQuery(''); }}>搜索：{query.trim()}</ActiveFilter>}
        {usedOnly && <ActiveFilter label="用量" onRemove={() => setUsedOnly(false)}>近 30 天有匹配用量</ActiveFilter>}
        {providerFilters.length > 1 && providerFilters.map(key => <ActiveFilter key={key} label={providers.find(provider => provider.key === key)?.label ?? key} onRemove={() => setProviderFilters(providerFilters.filter(provider => provider !== key))}>{providers.find(provider => provider.key === key)?.label ?? key}</ActiveFilter>)}
        {advancedFilters.minContext > 0 && <ActiveFilter label="上下文" onRemove={() => setAdvancedFilters({ ...advancedFilters, minContext: 0 })}>上下文 ≥ {formatContextWindow(advancedFilters.minContext)}</ActiveFilter>}
        {(advancedFilters.releasedAfter || advancedFilters.releasedBefore) && <ActiveFilter label="发布时间" onRemove={() => setAdvancedFilters({ ...advancedFilters, releasedAfter: '', releasedBefore: '' })}>发布：{advancedFilters.releasedAfter || '不限'} ～ {advancedFilters.releasedBefore || '不限'}</ActiveFilter>}
        <Button className="!h-6 !min-h-6 !px-2 !text-[11px]" variant="tertiary" size="sm" onPress={clearFilters}>清空</Button>
      </div>}
      {catalog && !loading && <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span role="status" aria-live="polite">{groups.length} 个模型</span>
        {sort.column === 'usage' && <span>{usageStatus === 'loading' ? '用量加载中，暂按最新主推排序' : usageStatus === 'error' ? '用量暂不可用，暂按最新主推排序' : hasUsage ? '近 30 天 · 按 Token 用量排序' : '暂无近 30 天可匹配用量，暂按最新主推排序'}</span>}
        {sort.column === 'latest' && <span>主推型号优先 · 按发布日期排序</span>}
        {usageStatus !== 'ready' && sort.column !== 'usage' && <span>{usageStatus === 'error' ? '用量暂不可用' : '用量加载中'}</span>}
        <span title={dateLabel}>价格表{catalog.generatedAt ? '生成于' : '文件更新于'} {shortDateLabel}</span>
        <Popover>
          <Button variant="ghost" size="sm" className="!h-6 !min-h-6 !gap-1 !px-1 !text-[11px] text-muted"><Info className="size-3" aria-hidden />数据说明</Button>
          <Popover.Content placement="bottom start" className="max-w-80">
            <Popover.Dialog className="space-y-2 p-3 text-xs">
              <Popover.Heading>价格数据说明</Popover.Heading>
              <p>当前 {groups.length} / {modelGroups.length} 个模型，合并展示 {channelCount} 条渠道记录。</p>
              <p className="text-muted">{catalog.source === 'bundled' ? '内置价格表' : '已发布价格表'} · {catalog.generatedAt ? '生成于' : '文件更新于'} {dateLabel}</p>
              <p className="text-muted">来源：<a className="underline underline-offset-2" href="https://models.dev" target="_blank" rel="noreferrer">models.dev</a> 与人工补充</p>
              <p className="text-muted">服务提供商表示供应渠道，可能提供其他品牌的模型。后缀保留原始调用名，不代表已核实的性能差异。</p>
              <p className="text-muted">≈ 表示显示值已舍入，悬停或打开渠道详情可查看精确参考价。{currency === 'USD' ? '$0' : '¥0'} 表示 API 零价，— 表示未提供定价{currency === 'CNY' ? '或汇率暂不可用' : ''}。</p>
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
      </div>}
      {estimateEnabled && <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11px] text-muted" aria-label="当前试算用量">
        <span>试算：{formatPricingScenario(scenario)}</span><Button size="sm" variant="ghost" isIconOnly aria-label="关闭费用试算" className="!size-6 !min-h-6 !min-w-6 !p-0" onPress={() => setEstimateEnabled(false)}><Xmark className="size-3" /></Button>
      </div>}
      {selectedGroups.length > 0 && <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-accent/20 bg-accent-soft/30 px-2 py-1.5" aria-label="已选对比模型">
        <span className="shrink-0 text-xs" role="status">已选 {selectedGroups.length} / {MAX_COMPARISON_MODELS}</span>
        <div className="order-last flex w-full min-w-0 gap-1 overflow-x-auto sm:order-none sm:w-auto sm:flex-1">{selectedGroups.map(group => <Button key={group.id} variant="tertiary" size="sm" className="!h-6 !min-h-6 max-w-40 shrink-0 !gap-1 !px-1.5 !text-[11px]" aria-label={`移除对比 ${getPricingModelName(group.model, group.displayName)}`} onPress={() => setSelected(current => current.filter(id => id !== group.id))}><span className="truncate">{getPricingModelName(group.model, group.displayName)}</span><Xmark className="size-3 shrink-0" /></Button>)}</div>
        <Button variant="ghost" size="sm" className="ml-auto !h-7 !min-h-7 !px-2 !text-xs" onPress={() => setSelected([])}>清空对比</Button>
        <Button size="sm" className="!h-7 !min-h-7 shrink-0 !gap-1 !px-2 !text-xs" isDisabled={selectedGroups.length < 2} onPress={() => setComparisonOpen(true)}><Columns2 className="size-3.5" />{selectedGroups.length < 2 ? '再选一个' : '开始对比'}</Button>
      </div>}
      {currency === 'CNY' && <div className="shrink-0 text-[11px] text-muted" role="status" aria-live="polite">
        {exchangeRate ? <>$1 = ¥{exchangeRate.rate} · {exchangeRate.source === 'manual' ? '手动汇率' : <><a className="underline underline-offset-2" href="https://frankfurter.dev" target="_blank" rel="noreferrer">Frankfurter</a> · {exchangeRate.date}</>}{exchangeStatus === 'loading' ? ' · 更新中' : exchangeStatus === 'error' ? ' · 自动更新失败，保留当前汇率' : ''}</>
          : exchangeStatus === 'loading' ? '正在获取 USD/CNY 参考汇率…' : '汇率暂不可用，请在“更多筛选”中重试或手动设置'}
      </div>}
      {loading ? <div aria-label="模型价格加载中" className="min-h-0 flex-1 space-y-3 overflow-hidden">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
        : error ? <div className="flex flex-1 flex-col items-center justify-center gap-4"><StatusBanner tone="error" title="模型价格加载失败" description={error} /><Button variant="outline" onPress={() => setRetry(value => value + 1)}>重试</Button></div>
          : <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex shrink-0 flex-wrap justify-between gap-x-2 text-[10px] text-muted"><span>价格单位：{currency === 'USD' ? '$' : '¥'} / 百万 Token{estimateEnabled ? ' · 试算为总费用' : ''}</span><span>勾选 2～4 个模型对比</span></div>
            <PricingList key={`${providerFilters.join(',')}:${debouncedQuery}:${sortKey}:${JSON.stringify(advancedFilters)}:${usedOnly}`} groups={groups} sort={sort} hasUsage={hasUsage} onSortChange={setSort} currency={currency} exchangeRate={exchangeRate?.rate ?? null} query={debouncedQuery} selected={selected} onCompare={toggleComparison} scenario={estimateEnabled ? scenario : null} />
          </div>}
      <p className="shrink-0 text-[10px] text-muted">≈ 表示舍入 · — 表示未提供定价{currency === 'CNY' ? '或汇率暂不可用' : ''} · 订阅以渠道套餐为准</p>
      {comparisonOpen && selectedGroups.length >= 2 && <PricingComparison groups={selectedGroups} initialChannels={selectedChannels} onClose={() => setComparisonOpen(false)} scenario={scenario} onScenarioChange={value => { setScenario(value); setEstimateEnabled(true); }} currency={currency} exchangeRate={exchangeRate?.rate ?? null} usageStatus={usageStatus} />}
    </section>
  );
}
