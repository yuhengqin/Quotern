import { useRef, useState } from 'react';
import { Autocomplete, Button, ButtonGroup, Input, Label, ListBox, Popover, SearchField, Select, useFilter } from '@heroui/react';
import { ArrowDownUp, Calculator, ChevronDown, X } from 'lucide-react';
import { ModelProviderIcon } from './ModelProviderIcon';
import type { ModelProvider } from '../lib/model-provider';
import type { PricingSortDescriptor, PricingSortKey } from '../lib/pricing-catalog';
import { DEFAULT_PRICING_SCENARIO, PRICING_TOKEN_FIELDS, type PricingScenario } from '../lib/pricing-workbench';
import { formatTokens } from '../lib/format';

export function PricingProviderFilter({ providers, value, onChange }: {
  providers: ModelProvider[]; value: string[]; onChange: (value: string[]) => void;
}) {
  const trigger = useRef<HTMLDivElement>(null);
  const { contains } = useFilter({ sensitivity: 'base' });
  const label = value.length > 1 ? `已选 ${value.length} 家提供商` : providers.find(provider => provider.key === value[0])?.label ?? '全部服务提供商';
  return <ButtonGroup className="min-w-0 shrink-0 max-w-full">
    <Autocomplete aria-label="服务提供商筛选" selectionMode="multiple" value={value} onChange={keys => {
      if (Array.isArray(keys)) onChange(keys.map(String));
    }} placeholder="全部服务提供商" variant="secondary" className="min-w-0 max-w-48">
      <Label className="sr-only">服务提供商筛选</Label>
      <Autocomplete.Trigger ref={trigger} className={`!h-8 !min-h-8 !w-fit max-w-48 !text-xs [&>button]:absolute [&>button]:inset-0 [&>button]:w-full [&>button]:rounded-[inherit] ${value.length ? '!rounded-r-none' : '!rounded-full'}`}>
        <Autocomplete.Value className="truncate">{() => label}</Autocomplete.Value><Autocomplete.Indicator />
      </Autocomplete.Trigger>
      <Autocomplete.Popover className="w-64 max-w-[calc(100vw-2rem)]" placement="bottom start">
        <Autocomplete.Filter filter={contains}>
          <SearchField aria-label="搜索服务提供商" autoFocus variant="secondary">
            <SearchField.Group className="!h-8 !min-h-8"><SearchField.SearchIcon /><SearchField.Input className="!text-xs" placeholder="搜索提供商…" /><SearchField.ClearButton /></SearchField.Group>
          </SearchField>
          <ListBox aria-label="提供商列表" renderEmptyState={() => <p className="p-3 text-xs text-muted">没有匹配的提供商</p>}>
            {providers.map(provider => <ListBox.Item id={provider.key} key={provider.key} textValue={`${provider.label} ${provider.key}`} className="text-xs">
              <ModelProviderIcon provider={provider} size={16} /><span>{provider.label}</span><ListBox.ItemIndicator />
            </ListBox.Item>)}
          </ListBox>
        </Autocomplete.Filter>
        {value.length > 0 && <Button slot={null} className="mt-1 !h-7 !min-h-7 w-full !text-xs" variant="tertiary" onPress={() => onChange([])}>清空提供商筛选</Button>}
      </Autocomplete.Popover>
    </Autocomplete>
    {value.length > 0 && <Button aria-label="清空提供商筛选" className="!h-8 !min-h-8 !w-8 !min-w-8 !rounded-l-none !rounded-r-full !p-0" size="sm" isIconOnly variant="tertiary" onPress={() => { onChange([]); trigger.current?.querySelector<HTMLButtonElement>('button')?.focus(); }}><ButtonGroup.Separator /><X className="size-3.5" /></Button>}
  </ButtonGroup>;
}

const SORT_FIELDS: Array<{ column: PricingSortKey; label: string; descending: string; ascending: string }> = [
  { column: 'model', label: '名称', ascending: '名称 A–Z', descending: '名称 Z–A' },
  { column: 'input', label: '输入价格', ascending: '输入价低 → 高', descending: '输入价高 → 低' },
  { column: 'output', label: '输出价格', ascending: '输出价低 → 高', descending: '输出价高 → 低' },
  { column: 'cacheRead', label: '缓存读取价格', ascending: '缓存读低 → 高', descending: '缓存读高 → 低' },
  { column: 'cacheWrite', label: '缓存写入价格', ascending: '缓存写低 → 高', descending: '缓存写高 → 低' },
  { column: 'contextWindow', label: '上下文', ascending: '上下文小 → 大', descending: '上下文大 → 小' },
  { column: 'releaseDate', label: '发布日期', ascending: '发布早 → 晚', descending: '最新发布' },
];
const SORT_OPTIONS = [
  { id: 'usage:descending', label: '近 30 天用量', column: 'usage' as const, direction: 'descending' as const },
  { id: 'latest:descending', label: '最新主推', column: 'latest' as const, direction: 'descending' as const },
  ...SORT_FIELDS.flatMap(field => (['ascending', 'descending'] as const).map(direction => ({ id: `${field.column}:${direction}`, label: field[direction], column: field.column, direction }))),
];

export function PricingSortSelect({ value, onChange }: { value: PricingSortDescriptor; onChange: (sort: PricingSortDescriptor) => void }) {
  return <Select aria-label="排序方式" value={`${value.column}:${value.direction}`} onChange={key => {
    const option = SORT_OPTIONS.find(option => option.id === key);
    if (option) onChange({ column: option.column, direction: option.direction });
  }} variant="secondary" className="min-w-0 max-w-52">
    <Label className="sr-only">排序方式</Label>
    <Select.Trigger className="!h-8 !min-h-8 !w-fit max-w-full !text-xs"><ArrowDownUp className="size-3.5 shrink-0" aria-hidden /><Select.Value className="truncate" /><Select.Indicator /></Select.Trigger>
    <Select.Popover className="w-52"><ListBox aria-label="排序选项">
      {SORT_OPTIONS.map(option => <ListBox.Item id={option.id} key={option.id} textValue={option.label} className="text-xs">{option.label}<ListBox.ItemIndicator /></ListBox.Item>)}
    </ListBox></Select.Popover>
  </Select>;
}

export function formatPricingScenario(scenario: PricingScenario): string {
  return PRICING_TOKEN_FIELDS.filter(([key]) => scenario[key] > 0).map(([key, label]) => `${formatTokens(scenario[key])} ${label}`).join(' · ') || '0 Token';
}

export function PricingCalculator({ scenario, onChange, enabled, onEnabledChange, comparison = false }: {
  scenario: PricingScenario; onChange: (value: PricingScenario) => void; enabled: boolean;
  onEnabledChange: (value: boolean) => void; comparison?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [cacheOpen, setCacheOpen] = useState(false);
  const [draft, setDraft] = useState(() => Object.fromEntries(PRICING_TOKEN_FIELDS.map(([key]) => [key, String(scenario[key] / 1_000_000)])) as Record<keyof PricingScenario, string>);
  const values = Object.fromEntries(PRICING_TOKEN_FIELDS.map(([key]) => [key, Number(draft[key]) * 1_000_000])) as PricingScenario;
  const valid = PRICING_TOKEN_FIELDS.every(([key]) => draft[key].trim() !== '' && Number.isFinite(values[key]) && values[key] >= 0 && values[key] <= 1_000_000_000_000);
  const editField = ([key, label]: typeof PRICING_TOKEN_FIELDS[number]) => <label key={key} className="flex min-w-0 flex-col gap-1.5 text-xs">
    <span>{label} <span className="text-muted">/ 百万 Token</span></span>
    <Input aria-label={`${label}百万 Token`} type="number" inputMode="decimal" min="0" max="1000000" step="any" variant="secondary" className="!h-9 w-full min-w-0 !text-sm tabular-nums" value={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} />
  </label>;
  return <Popover isOpen={open} onOpenChange={next => {
    if (next) {
      setDraft(Object.fromEntries(PRICING_TOKEN_FIELDS.map(([key]) => [key, String(scenario[key] / 1_000_000)])) as Record<keyof PricingScenario, string>);
      setCacheOpen(scenario.cacheRead > 0 || scenario.cacheWrite > 0);
    }
    setOpen(next);
  }}>
    <Button size="sm" variant={enabled && !comparison ? 'secondary' : 'tertiary'} className={`!h-8 !min-h-8 shrink-0 !gap-1.5 !px-3 !text-xs ${enabled && !comparison ? 'text-accent' : ''}`} aria-label={comparison ? '调整对比用量' : '费用试算'}>
      <Calculator className="size-3.5" aria-hidden />{comparison ? '调整用量' : '费用试算'}{enabled && !comparison ? ' · 已开启' : ''}
    </Button>
    <Popover.Content placement="bottom end" className="w-88 max-w-[calc(100vw-2rem)]">
      <Popover.Dialog className="space-y-3 p-3" aria-label="费用试算设置">
        <Popover.Heading className="text-sm">同等用量费用试算</Popover.Heading>
        <p className="text-[11px] leading-relaxed text-muted">普通输入不含缓存。四类 Token 分别计费，按各渠道 API 参考价估算。</p>
        <div className="grid grid-cols-2 gap-3">{PRICING_TOKEN_FIELDS.slice(0, 2).map(editField)}</div>
        <Button slot={null} variant="ghost" size="sm" className="!h-7 !min-h-7 !gap-1 !px-0 !text-xs" aria-expanded={cacheOpen} onPress={() => setCacheOpen(!cacheOpen)}>缓存用量<ChevronDown className={`size-3 transition-transform ${cacheOpen ? 'rotate-180' : ''}`} aria-hidden /></Button>
        {cacheOpen && <div className="grid grid-cols-2 gap-3">{PRICING_TOKEN_FIELDS.slice(2).map(editField)}</div>}
        {!valid && <p role="alert" className="text-xs text-danger">请输入 0～1,000,000 之间的有效数值（单位：百万 Token）。</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
          <Button slot={null} variant="ghost" size="sm" className="!h-8 !min-h-8 !px-2 !text-xs" onPress={() => { setDraft(Object.fromEntries(PRICING_TOKEN_FIELDS.map(([key]) => [key, String(DEFAULT_PRICING_SCENARIO[key] / 1_000_000)])) as Record<keyof PricingScenario, string>); }}>恢复默认</Button>
          <div className="flex gap-1">
            {enabled && !comparison && <Button slot={null} variant="tertiary" size="sm" className="!h-8 !min-h-8 !px-2 !text-xs" onPress={() => { onEnabledChange(false); setOpen(false); }}>关闭试算</Button>}
            <Button slot={null} size="sm" className="!h-8 !min-h-8 !text-xs" isDisabled={!valid} onPress={() => { onChange(values); onEnabledChange(true); setOpen(false); }}>应用试算</Button>
          </div>
        </div>
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}
