import { useRef, useState } from 'react';
import { Autocomplete, Button, ButtonGroup, Input, Label, ListBox, Popover, SearchField, Select, useFilter } from '@heroui/react';
import { ArrowDownUp, Calculator, ChevronDown, X } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';
import { ModelProviderIcon } from './ModelProviderIcon';
import type { ModelProvider } from '../lib/model-provider';
import type { PricingSortDescriptor, PricingSortKey } from '../lib/pricing-catalog';
import { DEFAULT_PRICING_SCENARIO, PRICING_TOKEN_FIELDS, type PricingScenario, type PricingTokenKind } from '../lib/pricing-workbench';
import { formatPricingTokens } from '../lib/pricing-display';

const FIELD_KEYS: Record<PricingTokenKind, string> = {
  input: 'pricing.calculator.fieldInput', output: 'pricing.calculator.fieldOutput',
  cacheRead: 'pricing.calculator.fieldCacheRead', cacheWrite: 'pricing.calculator.fieldCacheWrite',
};

export function PricingProviderFilter({ providers, value, onChange }: {
  providers: ModelProvider[]; value: string[]; onChange: (value: string[]) => void;
}) {
  const { t } = useTranslation();
  const trigger = useRef<HTMLDivElement>(null);
  const { contains } = useFilter({ sensitivity: 'base' });
  const selectedProvider = providers.find(provider => provider.key === value[0]);
  const label = value.length > 1 ? t('pricing.filters.selectedProviders', { count: value.length }) : selectedProvider?.key === 'unknown' ? t('pricing.provider.other') : selectedProvider?.label ?? t('pricing.filters.allProviders');
  return <ButtonGroup className="min-w-0 shrink-0 max-w-full">
    <Autocomplete aria-label={t('pricing.filters.provider')} selectionMode="multiple" value={value} onChange={keys => {
      if (Array.isArray(keys)) onChange(keys.map(String));
    }} placeholder={t('pricing.filters.allProviders')} variant="secondary" className="min-w-0 max-w-48">
      <Label className="sr-only">{t('pricing.filters.provider')}</Label>
      <Autocomplete.Trigger ref={trigger} className={`!h-8 !min-h-8 !w-fit max-w-48 !text-xs [&>button]:absolute [&>button]:inset-0 [&>button]:w-full [&>button]:rounded-[inherit] ${value.length ? '!rounded-r-none' : '!rounded-full'}`}>
        <Autocomplete.Value className="truncate">{() => label}</Autocomplete.Value><Autocomplete.Indicator />
      </Autocomplete.Trigger>
      <Autocomplete.Popover className="w-64 max-w-[calc(100vw-2rem)]" placement="bottom start">
        <Autocomplete.Filter filter={contains}>
          <SearchField aria-label={t('pricing.filters.searchProvider')} autoFocus variant="secondary">
            <SearchField.Group className="!h-8 !min-h-8"><SearchField.SearchIcon /><SearchField.Input className="!text-xs" placeholder={t('pricing.filters.searchProviderPlaceholder')} /><SearchField.ClearButton /></SearchField.Group>
          </SearchField>
          <ListBox aria-label={t('pricing.filters.providerList')} renderEmptyState={() => <p className="p-3 text-xs text-muted">{t('pricing.filters.noProvider')}</p>}>
            {providers.map(provider => <ListBox.Item id={provider.key} key={provider.key} textValue={`${provider.key === 'unknown' ? t('pricing.provider.other') : provider.label} ${provider.key}`} className="text-xs">
              <ModelProviderIcon provider={provider} size={16} /><span>{provider.key === 'unknown' ? t('pricing.provider.other') : provider.label}</span><ListBox.ItemIndicator />
            </ListBox.Item>)}
          </ListBox>
        </Autocomplete.Filter>
        {value.length > 0 && <Button slot={null} className="mt-1 !h-7 !min-h-7 w-full !text-xs" variant="tertiary" onPress={() => onChange([])}>{t('pricing.filters.clearProvider')}</Button>}
      </Autocomplete.Popover>
    </Autocomplete>
    {value.length > 0 && <Button aria-label={t('pricing.filters.clearProvider')} className="!h-8 !min-h-8 !w-8 !min-w-8 !rounded-l-none !rounded-r-full !p-0" size="sm" isIconOnly variant="tertiary" onPress={() => { onChange([]); trigger.current?.querySelector<HTMLButtonElement>('button')?.focus(); }}><ButtonGroup.Separator /><X className="size-3.5" /></Button>}
  </ButtonGroup>;
}

const SORT_FIELDS: Array<{ column: PricingSortKey; ascending: string; descending: string }> = [
  { column: 'model', ascending: 'pricing.sort.modelAsc', descending: 'pricing.sort.modelDesc' },
  { column: 'input', ascending: 'pricing.sort.inputAsc', descending: 'pricing.sort.inputDesc' },
  { column: 'output', ascending: 'pricing.sort.outputAsc', descending: 'pricing.sort.outputDesc' },
  { column: 'cacheRead', ascending: 'pricing.sort.cacheReadAsc', descending: 'pricing.sort.cacheReadDesc' },
  { column: 'cacheWrite', ascending: 'pricing.sort.cacheWriteAsc', descending: 'pricing.sort.cacheWriteDesc' },
  { column: 'contextWindow', ascending: 'pricing.sort.contextAsc', descending: 'pricing.sort.contextDesc' },
  { column: 'releaseDate', ascending: 'pricing.sort.releaseAsc', descending: 'pricing.sort.releaseDesc' },
];
const SORT_OPTIONS = [
  { id: 'usage:descending', labelKey: 'pricing.sort.usage', column: 'usage' as const, direction: 'descending' as const },
  { id: 'latest:descending', labelKey: 'pricing.sort.latest', column: 'latest' as const, direction: 'descending' as const },
  ...SORT_FIELDS.flatMap(field => (['ascending', 'descending'] as const).map(direction => ({ id: `${field.column}:${direction}`, labelKey: field[direction], column: field.column, direction }))),
];

export function PricingSortSelect({ value, onChange }: { value: PricingSortDescriptor; onChange: (sort: PricingSortDescriptor) => void }) {
  const { t } = useTranslation();
  return <Select aria-label={t('pricing.filters.sort')} value={`${value.column}:${value.direction}`} onChange={key => {
    const option = SORT_OPTIONS.find(option => option.id === key);
    if (option) onChange({ column: option.column, direction: option.direction });
  }} variant="secondary" className="min-w-0 max-w-52">
    <Label className="sr-only">{t('pricing.filters.sort')}</Label>
    <Select.Trigger className="!h-8 !min-h-8 !w-fit max-w-full !text-xs"><ArrowDownUp className="size-3.5 shrink-0" aria-hidden /><Select.Value className="truncate" /><Select.Indicator /></Select.Trigger>
    <Select.Popover className="w-52"><ListBox aria-label={t('pricing.filters.sortOptions')}>
      {SORT_OPTIONS.map(option => <ListBox.Item id={option.id} key={option.id} textValue={t(option.labelKey)} className="text-xs">{t(option.labelKey)}<ListBox.ItemIndicator /></ListBox.Item>)}
    </ListBox></Select.Popover>
  </Select>;
}

export function PricingScenarioSummary({ scenario, withPrefix = false }: { scenario: PricingScenario; withPrefix?: boolean }) {
  const { t, i18n } = useTranslation();
  const summary = PRICING_TOKEN_FIELDS.filter(([key]) => scenario[key] > 0)
    .map(([key]) => `${formatPricingTokens(scenario[key], i18n.language)} ${t(FIELD_KEYS[key])}`).join(' · ') || '0 Token';
  return <>{withPrefix ? t('pricing.calculator.summary', { summary }) : summary}</>;
}

export function PricingCalculator({ scenario, onChange, enabled, onEnabledChange, comparison = false }: {
  scenario: PricingScenario; onChange: (value: PricingScenario) => void; enabled: boolean;
  onEnabledChange: (value: boolean) => void; comparison?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [cacheOpen, setCacheOpen] = useState(false);
  const [draft, setDraft] = useState(() => Object.fromEntries(PRICING_TOKEN_FIELDS.map(([key]) => [key, String(scenario[key] / 1_000_000)])) as Record<keyof PricingScenario, string>);
  const values = Object.fromEntries(PRICING_TOKEN_FIELDS.map(([key]) => [key, Number(draft[key]) * 1_000_000])) as PricingScenario;
  const valid = PRICING_TOKEN_FIELDS.every(([key]) => draft[key].trim() !== '' && Number.isFinite(values[key]) && values[key] >= 0 && values[key] <= 1_000_000_000_000);
  const editField = ([key]: typeof PRICING_TOKEN_FIELDS[number]) => <label key={key} className="flex min-w-0 flex-col gap-1.5 text-xs">
    <span>{t(FIELD_KEYS[key])} <span className="text-muted">{t('pricing.metric.perMillion')}</span></span>
    <Input aria-label={t('pricing.calculator.fieldAria', { label: t(FIELD_KEYS[key]) })} type="number" inputMode="decimal" min="0" max="1000000" step="any" variant="secondary" className="!h-9 w-full min-w-0 !text-sm tabular-nums" value={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} />
  </label>;
  return <Popover isOpen={open} onOpenChange={next => {
    if (next) {
      setDraft(Object.fromEntries(PRICING_TOKEN_FIELDS.map(([key]) => [key, String(scenario[key] / 1_000_000)])) as Record<keyof PricingScenario, string>);
      setCacheOpen(scenario.cacheRead > 0 || scenario.cacheWrite > 0);
    }
    setOpen(next);
  }}>
    <Button size="sm" variant={enabled && !comparison ? 'secondary' : 'tertiary'} className={`!h-8 !min-h-8 shrink-0 !gap-1.5 !px-3 !text-xs ${enabled && !comparison ? 'text-accent' : ''}`} aria-label={t(comparison ? 'pricing.calculator.adjust' : 'pricing.calculator.title')}>
      <Calculator className="size-3.5" aria-hidden />{t(comparison ? 'pricing.calculator.adjustShort' : 'pricing.calculator.title')}{enabled && !comparison ? t('pricing.calculator.enabled') : ''}
    </Button>
    <Popover.Content placement="bottom end" className="w-88 max-w-[calc(100vw-2rem)]">
      <Popover.Dialog className="space-y-3 p-3" aria-label={t('pricing.calculator.settings')}>
        <Popover.Heading className="text-sm">{t('pricing.calculator.heading')}</Popover.Heading>
        <p className="text-[11px] leading-relaxed text-muted">{t('pricing.calculator.description')}</p>
        <div className="grid grid-cols-2 gap-3">{PRICING_TOKEN_FIELDS.slice(0, 2).map(editField)}</div>
        <Button slot={null} variant="ghost" size="sm" className="!h-7 !min-h-7 !gap-1 !px-0 !text-xs" aria-expanded={cacheOpen} onPress={() => setCacheOpen(!cacheOpen)}>{t('pricing.calculator.cacheUsage')}<ChevronDown className={`size-3 transition-transform ${cacheOpen ? 'rotate-180' : ''}`} aria-hidden /></Button>
        {cacheOpen && <div className="grid grid-cols-2 gap-3">{PRICING_TOKEN_FIELDS.slice(2).map(editField)}</div>}
        {!valid && <p role="alert" className="text-xs text-danger">{t('pricing.calculator.invalid')}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
          <Button slot={null} variant="ghost" size="sm" className="!h-8 !min-h-8 !px-2 !text-xs" onPress={() => { setDraft(Object.fromEntries(PRICING_TOKEN_FIELDS.map(([key]) => [key, String(DEFAULT_PRICING_SCENARIO[key] / 1_000_000)])) as Record<keyof PricingScenario, string>); }}>{t('pricing.calculator.restore')}</Button>
          <div className="flex gap-1">
            {enabled && !comparison && <Button slot={null} variant="tertiary" size="sm" className="!h-8 !min-h-8 !px-2 !text-xs" onPress={() => { onEnabledChange(false); setOpen(false); }}>{t('pricing.calculator.disable')}</Button>}
            <Button slot={null} size="sm" className="!h-8 !min-h-8 !text-xs" isDisabled={!valid} onPress={() => { onChange(values); onEnabledChange(true); setOpen(false); }}>{t('pricing.calculator.apply')}</Button>
          </div>
        </div>
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}
