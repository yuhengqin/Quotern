import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Xmark } from '@gravity-ui/icons';
import { Check, Columns2, Info } from 'lucide-react';
import { Button, Label, ListBox, Popover, SearchField, Select, Skeleton, Toast, ToastQueue } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { registerMessages } from 'quotern-i18n';
import { PricingList } from '../components/PricingList';
import { pricingMessages } from '../i18n/pricing-messages';
import { BackToUsageLink } from '../components/BackToUsageLink';
import { PricingCalculator, PricingProviderFilter, PricingSortSelect, PricingScenarioSummary } from '../components/PricingTools';
import { PricingComparison } from '../components/PricingComparison';
import { FilterSelectPopover } from '../components/FilterMenu';
import { PricingMoreFilters, EMPTY_PRICING_FILTERS, type PricingAdvancedFilters } from '../components/PricingMoreFilters';
import { StatusBanner } from '../components/StatusBanner';
import { usePricingCurrency } from '../hooks/usePricingCurrency';
import { formatPricingExchangeRate } from '../lib/pricing-currency';
import { formatPricingReleaseDate } from '../lib/pricing-display';
import { fetchModelBreakdown, fetchPricingCatalog, type ModelBreakdownRow } from '../lib/api';
import type { PricingCatalogResponse } from '../lib/pricing-data';
import { DATA_SYNCED_EVENT } from '../lib/shell-events';
import { filterPricingCatalog, formatContextWindow } from '../lib/pricing-filters';
import { filterAndSortPricingGroups, getPrimaryPricingVariant, groupPricingCatalog } from '../lib/pricing-groups';
import {
  addPricingUsage, filterDirectPricingCatalog, getPricingModelName, getPricingProvider,
  DEFAULT_PRICING_SORT,
  type PricingSortDescriptor,
} from '../lib/pricing-catalog';
import { DEFAULT_PRICING_SCENARIO, MAX_COMPARISON_MODELS, togglePricingComparison } from '../lib/pricing-workbench';
import { filterSessionPricingGroups, parsePricingSearch } from '../lib/pricing-selection';
import { HelpPopover } from '../components/HelpPopover';

registerMessages(pricingMessages);

function ActiveFilter({ children, onRemove, label }: { children: ReactNode; onRemove: () => void; label: string }) {
  const { t } = useTranslation();
  return <Button className="!h-6 !min-h-6 max-w-full !gap-1 !px-2 !text-[11px]" variant="tertiary" size="sm" onPress={onRemove} aria-label={t('pricing.filters.remove', { label })}>
    <span className="min-w-0 truncate">{children}</span><Xmark className="size-3 shrink-0" aria-hidden />
  </Button>;
}

export function PricingPage({ loadUsage = fetchModelBreakdown, loadCatalog = fetchPricingCatalog }: {
  loadUsage?: (days: number) => Promise<{ models: ModelBreakdownRow[] }>;
  loadCatalog?: () => Promise<PricingCatalogResponse>;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const { q: initialQuery, models: sessionModels } = useMemo(() => parsePricingSearch(search), [search]);
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
  const comparisonStatusId = useId();
  const [toastQueue] = useState(() => new ToastQueue({ maxVisibleToasts: 1 }));
  const comparisonLimitToast = useRef<string | null>(null);
  const [catalog, setCatalog] = useState<PricingCatalogResponse | null>(null);
  const [usage, setUsage] = useState<ModelBreakdownRow[]>([]);
  const [usageStatus, setUsageStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const { currency, setCurrency, exchangeRate, exchangeStatus, refreshExchangeRate, setManualExchangeRate } = usePricingCurrency();

  useEffect(() => { setQuery(initialQuery); }, [initialQuery]);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 160);
    return () => window.clearTimeout(timeout);
  }, [query]);
  useEffect(() => {
    let cancelled = false;
    let sequence = 0;
    let pendingRefresh: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setError(false);
    const refresh = () => {
      clearTimeout(pendingRefresh);
      const request = ++sequence;
      void loadCatalog().then(data => {
        if (!cancelled && request === sequence) {
          setCatalog(data); setError(false);
          if (data.refreshing) pendingRefresh = setTimeout(refresh, 1_000);
        }
      }).catch(() => {
        if (!cancelled && request === sequence) setError(true);
      }).finally(() => { if (!cancelled && request === sequence) setLoading(false); });
    };
    refresh();
    window.addEventListener(DATA_SYNCED_EVENT, refresh);
    return () => { cancelled = true; clearTimeout(pendingRefresh); window.removeEventListener(DATA_SYNCED_EVENT, refresh); };
  }, [loadCatalog, retry]);
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
  const sessionFilter = useMemo(() => filterSessionPricingGroups(modelGroups, sessionModels ?? [], catalog?.matching), [modelGroups, sessionModels, catalog?.matching]);
  const scopedRows = useMemo(() => sessionFilter.groups.flatMap(group => group.entries), [sessionFilter]);
  const groups = useMemo(() => filterAndSortPricingGroups(groupPricingCatalog(filterPricingCatalog(scopedRows, { ...advancedFilters, providers: providerFilters })), debouncedQuery, sort, usedOnly), [scopedRows, debouncedQuery, sort, providerFilters, advancedFilters, usedOnly]);
  const selectedGroups = useMemo(() => selected.flatMap(id => modelGroups.find(group => group.id === id) ?? []), [selected, modelGroups]);
  const toggleComparison = (id: string) => {
    if (!selected.includes(id) && selected.length >= MAX_COMPARISON_MODELS) {
      const notice = { title: <strong className="font-semibold">{t('pricing.compare.limit', { count: MAX_COMPARISON_MODELS })}</strong>, variant: 'default' as const };
      if (!comparisonLimitToast.current) {
        comparisonLimitToast.current = toastQueue.add(notice, { timeout: 2500, onClose: () => { comparisonLimitToast.current = null; } });
      }
      return;
    }
    const group = groups.find(item => item.id === id);
    if (!selected.includes(id) && selected.length < MAX_COMPARISON_MODELS && group) {
      setSelectedChannels(current => ({ ...current, [id]: getPrimaryPricingVariant(group).id }));
    }
    setSelected(current => togglePricingComparison(current, id));
  };
  const channelCount = groups.reduce((sum, group) => sum + group.entries.length, 0);
  const hasFilterChips = Boolean(sessionModels?.length || query.trim() || providerFilters.length > 0 || advancedFilters.minContext || advancedFilters.releasedAfter || advancedFilters.releasedBefore || usedOnly);
  const providerName = (key: string) => {
    const provider = providers.find(item => item.key === key);
    return provider?.key === 'unknown' ? t('pricing.provider.other') : provider?.label ?? key;
  };
  const clearSessionModels = (q = query) => { void navigate({ to: '/pricing', search: { q } }); };
  const clearFilters = () => { setQuery(''); setDebouncedQuery(''); setProviderFilters([]); setAdvancedFilters(EMPTY_PRICING_FILTERS); setUsedOnly(false); if (sessionModels?.length) clearSessionModels(''); };
  const sortKey = `${sort.column}:${sort.direction}`;
  const tableTimestamp = catalog?.generatedAt ?? catalog?.updatedAt;
  const dateLabel = tableTimestamp && Number.isFinite(Date.parse(tableTimestamp)) ? new Date(tableTimestamp).toLocaleString(locale, { hour12: false }) : t('pricing.summary.unknownDate');
  const shortDateLabel = tableTimestamp && Number.isFinite(Date.parse(tableTimestamp)) ? new Date(tableTimestamp).toLocaleDateString(locale) : t('pricing.summary.unknownDate');
  const comparisonHint = selectedGroups.length === MAX_COMPARISON_MODELS ? ''
    : selectedGroups.length === 1 ? t('pricing.compare.needOne') : t('pricing.compare.hint');
  const tableDateKind = catalog?.generatedAt ? t('pricing.summary.generatedAt') : t('pricing.summary.updatedAt');
  const rateNote = currency === 'CNY' ? t('pricing.summary.rateNote') : '';

  return (
    <section className="flex h-[calc(100dvh-5rem)] min-h-0 min-w-0 flex-col gap-3">
      <Toast.Provider placement="top" queue={toastQueue} width={240} className="top-12 !w-60 !min-w-0 max-w-[calc(100vw-2rem)]" />
      <header className="shrink-0">
        <BackToUsageLink />
        <div className="min-w-0"><h1 className="text-xl font-semibold">{t('pricing.title')}</h1><p className="mt-1 text-xs text-muted">{t('pricing.subtitle', { currency })}</p></div>
      </header>
      <div aria-label={t('pricing.filters.aria')} className="flex shrink-0 flex-wrap items-center gap-2">
        <SearchField aria-label={t('pricing.filters.search')} value={query} onChange={setQuery} variant="secondary" className="min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-72">
          <Label className="sr-only">{t('pricing.filters.search')}</Label>
          <SearchField.Group className="!h-8 !min-h-8"><SearchField.SearchIcon /><SearchField.Input className="!text-xs" placeholder={t('pricing.filters.search')} /><SearchField.ClearButton /></SearchField.Group>
        </SearchField>
        <PricingProviderFilter providers={providers} value={providerFilters} onChange={setProviderFilters} />
        <Select aria-label={t('pricing.filters.currency')} value={currency} variant="secondary" onChange={key => { if (key === 'USD' || key === 'CNY') setCurrency(key); }} className="min-w-0 text-xs">
          <Label className="sr-only">{t('pricing.filters.currency')}</Label>
          <Select.Trigger className="!h-8 !min-h-8 !w-fit !text-xs"><Select.Value /><Select.Indicator /></Select.Trigger>
          <FilterSelectPopover><ListBox aria-label={t('pricing.filters.currencyOptions')}><ListBox.Item id="USD" textValue="USD">{t('pricing.filters.usd')}<ListBox.ItemIndicator /></ListBox.Item><ListBox.Item id="CNY" textValue="CNY">{t('pricing.filters.cny')}<ListBox.ItemIndicator /></ListBox.Item></ListBox></FilterSelectPopover>
        </Select>
        <PricingSortSelect value={sort} onChange={setSort} />
        <Button aria-pressed={usedOnly} isDisabled={usageStatus !== 'ready'} onPress={() => setUsedOnly(value => !value)} size="sm" variant={usedOnly ? 'secondary' : 'tertiary'} className={`!h-8 !min-h-8 shrink-0 !gap-1 !px-3 !text-xs ${usedOnly ? 'text-accent' : ''}`}>
          {usedOnly && <Check className="size-3" aria-hidden />}{t('pricing.filters.used')}
        </Button>
        <PricingMoreFilters filters={advancedFilters} onChange={setAdvancedFilters} currency={currency} exchangeRate={exchangeRate} exchangeStatus={exchangeStatus} onManualRate={setManualExchangeRate} onRefreshRate={() => { void refreshExchangeRate(); }} />
        <PricingCalculator scenario={scenario} onChange={setScenario} enabled={estimateEnabled} onEnabledChange={setEstimateEnabled} />
      </div>
      {hasFilterChips && <div className="flex shrink-0 flex-wrap items-center gap-1" aria-label={t('pricing.filters.selected')}>
        {sessionModels?.length && <ActiveFilter label={t('usage.detail.sessionModels')} onRemove={() => clearSessionModels()}>{t('usage.detail.sessionModelsCount', { count: sessionModels.length })}</ActiveFilter>}
        {query.trim() && <ActiveFilter label={t('pricing.filters.search')} onRemove={() => { setQuery(''); setDebouncedQuery(''); }}>{t('pricing.filters.searchChip', { query: query.trim() })}</ActiveFilter>}
        {usedOnly && <ActiveFilter label={t('pricing.filters.usage')} onRemove={() => setUsedOnly(false)}>{t('pricing.filters.usedChip')}</ActiveFilter>}
        {providerFilters.map(key => <ActiveFilter key={key} label={providerName(key)} onRemove={() => setProviderFilters(providerFilters.filter(provider => provider !== key))}>{providerName(key)}</ActiveFilter>)}
        {advancedFilters.minContext > 0 && <ActiveFilter label={t('pricing.filters.context')} onRemove={() => setAdvancedFilters({ ...advancedFilters, minContext: 0 })}>{t('pricing.filters.contextChip', { value: formatContextWindow(advancedFilters.minContext, locale) })}</ActiveFilter>}
        {(advancedFilters.releasedAfter || advancedFilters.releasedBefore) && <ActiveFilter label={t('pricing.filters.release')} onRemove={() => setAdvancedFilters({ ...advancedFilters, releasedAfter: '', releasedBefore: '' })}>{t('pricing.filters.releaseChip', { start: advancedFilters.releasedAfter ? formatPricingReleaseDate(advancedFilters.releasedAfter, locale) : t('pricing.filters.unlimited'), end: advancedFilters.releasedBefore ? formatPricingReleaseDate(advancedFilters.releasedBefore, locale) : t('pricing.filters.unlimited') })}</ActiveFilter>}
        <Button className="!h-6 !min-h-6 !px-2 !text-[11px]" variant="tertiary" size="sm" onPress={clearFilters}>{t('pricing.filters.clearAll')}</Button>
      </div>}
      {catalog && !loading && <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span role="status" aria-live="polite">{t('pricing.summary.count', { count: groups.length })}</span>
        {sessionFilter.unmatched.length > 0 && <span className="inline-flex items-center gap-1">{t('usage.detail.unmatchedModels', { count: sessionFilter.unmatched.length })}<HelpPopover title={t('usage.detail.sessionModels')}><p>{t('usage.detail.unmatchedNote')}</p><ul className="space-y-1">{sessionFilter.unmatched.map(item => <li key={JSON.stringify(item)} className="break-all">{item.model} · {item.source}</li>)}</ul></HelpPopover></span>}
        {sort.column === 'usage' && <span>{t(usageStatus === 'loading' ? 'pricing.summary.usageLoadingSort' : usageStatus === 'error' ? 'pricing.summary.usageErrorSort' : hasUsage ? 'pricing.summary.usageSort' : 'pricing.summary.noUsageSort')}</span>}
        {sort.column === 'latest' && <span>{t('pricing.summary.latestSort')}</span>}
        {usageStatus !== 'ready' && sort.column !== 'usage' && <span>{t(usageStatus === 'error' ? 'pricing.summary.usageError' : 'pricing.summary.usageLoading')}</span>}
        <span title={dateLabel}>{t('pricing.summary.tableDate', { kind: tableDateKind, date: shortDateLabel })}</span>
        <Popover>
          <Button variant="ghost" size="sm" className="!h-6 !min-h-6 !gap-1 !px-1 !text-[11px] text-muted"><Info className="size-3" aria-hidden />{t('pricing.summary.dataInfo')}</Button>
          <Popover.Content placement="bottom start" className="max-w-80">
            <Popover.Dialog className="space-y-2 p-3 text-xs">
              <Popover.Heading>{t('pricing.summary.dataHeading')}</Popover.Heading>
              <p>{t('pricing.summary.countDetails', { visible: groups.length, total: modelGroups.length, channels: channelCount })}</p>
              <p className="text-muted">{t(catalog.source === 'bundled' ? 'pricing.summary.bundled' : 'pricing.summary.published')} · {t('pricing.summary.tableDate', { kind: tableDateKind, date: dateLabel })}</p>
              <p className="text-muted"><a className="underline underline-offset-2" href="https://models.dev" target="_blank" rel="noreferrer">{t('pricing.summary.source')}</a></p>
              <p className="text-muted">{t('pricing.summary.providerMeaning')}</p>
              <p className="text-muted">{t('pricing.summary.priceMeaning', { zero: currency === 'USD' ? '$0' : '¥0', rateNote })}</p>
              {sessionModels?.length && <p className="text-muted">{t('usage.detail.referencePrices')}</p>}
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
      </div>}
      {estimateEnabled && <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11px] text-muted" aria-label={t('pricing.calculator.settings')}>
        <span><PricingScenarioSummary scenario={scenario} withPrefix /></span><Button size="sm" variant="ghost" isIconOnly aria-label={t('pricing.calculator.close')} className="!size-6 !min-h-6 !min-w-6 !p-0" onPress={() => setEstimateEnabled(false)}><Xmark className="size-3" /></Button>
      </div>}
      {currency === 'CNY' && <div className="shrink-0 text-[11px] text-muted" role="status" aria-live="polite">
        {exchangeRate ? <>$1 = ¥{formatPricingExchangeRate(exchangeRate.rate, locale)} · {exchangeRate.source === 'manual' ? t('pricing.exchange.manual') : <><a className="underline underline-offset-2" href="https://frankfurter.dev" target="_blank" rel="noreferrer">Frankfurter</a> · {formatPricingReleaseDate(exchangeRate.date ?? undefined, locale)}</>}{exchangeStatus === 'loading' ? ` · ${t('pricing.exchange.updating')}` : exchangeStatus === 'error' ? ` · ${t('pricing.exchange.updateFailed')}` : ''}</>
          : t(exchangeStatus === 'loading' ? 'pricing.exchange.loading' : 'pricing.exchange.unavailable')}
      </div>}
      {loading ? <div aria-label={t('pricing.loading')} className="min-h-0 flex-1 space-y-3 overflow-hidden">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
        : error ? <div className="flex flex-1 flex-col items-center justify-center gap-4"><StatusBanner tone="error" title={t('pricing.loadError')} /><Button variant="outline" onPress={() => setRetry(value => value + 1)}>{t('pricing.retry')}</Button></div>
          : <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
            <div role="group" aria-label={t('pricing.compare.operations')} className={`grid h-[72px] shrink-0 grid-rows-[32px_28px] gap-1 rounded-xl border px-2 py-1 sm:h-14 sm:grid-rows-[16px_28px] ${selectedGroups.length ? 'border-accent/20 bg-accent-soft/30' : 'border-border/60 bg-surface-secondary/40'}`}>
              <div id={comparisonStatusId} role="status" aria-live="polite" aria-atomic="true" className="min-w-0 text-[11px] leading-4">
                {selectedGroups.length > 0 && <span className="mr-2 whitespace-nowrap font-medium">{t('pricing.compare.selectedCount', { count: selectedGroups.length, max: MAX_COMPARISON_MODELS })}</span>}
                <span className="text-muted">{comparisonHint}</span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label={t('pricing.compare.selectedModels')}>
                  {selectedGroups.length ? selectedGroups.map(group => <Button key={group.id} variant="tertiary" size="sm" className="!h-6 !min-h-6 max-w-40 shrink-0 !gap-1 !px-1.5 !text-[11px]" aria-label={t('pricing.compare.remove', { name: getPricingModelName(group.model, group.displayName) })} onPress={() => setSelected(current => current.filter(id => id !== group.id))}><span className="truncate">{getPricingModelName(group.model, group.displayName)}</span><Xmark className="size-3 shrink-0" aria-hidden /></Button>)
                    : <span className="truncate text-[10px] text-muted">{t('pricing.compare.unitHint', { symbol: currency === 'USD' ? '$' : '¥', estimateNote: estimateEnabled ? t('pricing.compare.estimateNote') : '' })}</span>}
                </div>
                <Button variant="ghost" size="sm" className="!h-7 !min-h-7 shrink-0 !px-2 !text-xs" isDisabled={selectedGroups.length === 0} onPress={() => setSelected([])}>{t('pricing.compare.clear')}</Button>
                <Button size="sm" className="!h-7 !min-h-7 shrink-0 !gap-1 !px-2 !text-xs" aria-describedby={comparisonStatusId} isDisabled={selectedGroups.length < 2} onPress={() => setComparisonOpen(true)}><Columns2 className="size-3.5" aria-hidden />{t('pricing.compare.start')}</Button>
              </div>
            </div>
            <PricingList key={`${providerFilters.join(',')}:${debouncedQuery}:${sortKey}:${JSON.stringify(advancedFilters)}:${usedOnly}`} groups={groups} sort={sort} hasUsage={hasUsage} onSortChange={setSort} currency={currency} exchangeRate={exchangeRate?.rate ?? null} query={debouncedQuery} selected={selected} onCompare={toggleComparison} scenario={estimateEnabled ? scenario : null} />
          </div>}
      <p className="shrink-0 text-[10px] text-muted">{t('pricing.summary.footnote', { rateNote })}</p>
      {comparisonOpen && selectedGroups.length >= 2 && <PricingComparison groups={selectedGroups} initialChannels={selectedChannels} onClose={() => setComparisonOpen(false)} scenario={scenario} onScenarioChange={value => { setScenario(value); setEstimateEnabled(true); }} currency={currency} exchangeRate={exchangeRate?.rate ?? null} usageStatus={usageStatus} />}
    </section>
  );
}
